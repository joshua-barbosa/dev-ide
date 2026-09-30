// As rotas do kernel, por HTTP de verdade (spec 112, etapa 2).
//
// O caminho que ele pediu, inteiro: *"se eu fizesse um bloco SQL que retorne
// uns resultados e no próximo bloco eu faço em python, eu poderia pegar o
// resultado e trabalhar com ele?"*
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createNotebookRouter } from '../routes/notebook';
import { GerenteDeKernels } from '../notebook/gerente';
import { sqliteDriver } from '../connections/drivers/sqlite';
import { errorEnvelope } from '../http/handlers';
import type { SessionPool } from '../connections/pool';
import { plataformaAtual } from '../../shared/plataforma';

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-nb-rotas-'));
const banco = path.join(pasta, 'exemplo.db');
const db = new DatabaseSync(banco);
db.exec("CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente TEXT, total REAL); INSERT INTO pedidos (cliente, total) VALUES ('Ana', 50), ('Bia', 1500), ('Caio', 2500);");
db.close();

const gerente = new GerenteDeKernels(plataformaAtual());
after(() => gerente.encerrarTodos());

async function servidor() {
  const sessao = await sqliteDriver.connect({ id: 'c1', type: 'sqlite', label: 'e', readOnly: false, fields: { file: banco } });
  const pool = { acquire: async () => sessao } as unknown as SessionPool;
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/notebook', createNotebookRouter(gerente, pool));
  app.use(errorEnvelope);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/notebook`;
  const pedir = async (metodo: string, rota: string, corpo?: unknown) => {
    const r = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return (await r.json()) as { success: boolean; data: any; error: string | null };
  };
  return { pedir, fechar: () => new Promise((r) => s.close(r)) };
}

const caminho = path.join(pasta, 'analise.brnb');

/** Executa e pergunta até terminar, como a tela faz. */
async function rodar(pedir: Awaited<ReturnType<typeof servidor>>['pedir'], codigo: string) {
  const { data } = await pedir('POST', '/kernel/executar', { caminho, codigo });
  let saidas: any[] = [];
  for (let i = 0; i < 200; i++) {
    const q = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(caminho)}&exec=${data.exec}&desde=${saidas.length}`)).data;
    saidas = [...saidas.slice(0, q.inicio), ...q.saidas];
    if (q.terminou) return { saidas, ok: q.ok };
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('não terminou');
}

test('SQL vira variável, e a célula Python seguinte trabalha com ela', async () => {
  const { pedir, fechar } = await servidor();
  try {
    const k = await pedir('POST', '/kernel', { caminho, linguagem: 'python', raiz: pasta });
    assert.equal(k.success, true, k.error ?? '');
    assert.equal(k.data.interpretador.origem, 'sistema');

    const sql = await pedir('POST', '/kernel/sql', {
      caminho, connectionId: 'c1', database: 'main', nome: 'pedidos',
      statement: 'SELECT cliente, total FROM pedidos ORDER BY id',
    });
    assert.equal(sql.success, true, sql.error ?? '');
    assert.equal(sql.data.tabela.total, 3);
    assert.equal(sql.data.variavel.nome, 'pedidos');
    assert.equal(sql.data.variavel.linhas, 3);

    const codigo = sql.data.variavel.forma === 'DataFrame'
      ? 'grandes = pedidos[pedidos.total > 1000]\nlist(grandes.cliente)'
      : 'grandes = [p for p in pedidos if p["total"] > 1000]\n[p["cliente"] for p in grandes]';
    const r = await rodar(pedir, codigo);
    assert.equal(r.ok, true);
    assert.equal(r.saidas.map((s) => s.texto ?? '').join(''), "['Bia', 'Caio']\n");
  } finally {
    await fechar();
  }
});

test('print que cresce aos poucos chega inteiro, sem duplicar', async () => {
  const { pedir, fechar } = await servidor();
  try {
    await pedir('POST', '/kernel', { caminho, linguagem: 'python', raiz: pasta });
    const r = await rodar(pedir, 'import time\nfor i in range(5):\n    print(i)\n    time.sleep(0.05)');
    assert.equal(r.saidas.map((s) => s.texto ?? '').join(''), '0\n1\n2\n3\n4\n');
  } finally {
    await fechar();
  }
});

test('reiniciar ZERA as variáveis', async () => {
  const { pedir, fechar } = await servidor();
  try {
    await pedir('POST', '/kernel', { caminho, linguagem: 'python', raiz: pasta });
    await rodar(pedir, 'antes = 1');
    const k = await pedir('POST', '/kernel/reiniciar', { caminho });
    assert.equal(k.success, true);
    const r = await rodar(pedir, 'antes');
    assert.equal(r.ok, false);
    assert.ok(r.saidas.some((s) => /NameError/.test(s.mensagem ?? '')));
  } finally {
    await fechar();
  }
});

test('SQL sem kernel rodando roda do mesmo jeito, e AVISA que a variável não foi criada', async () => {
  const { pedir, fechar } = await servidor();
  try {
    const outro = path.join(pasta, 'sem-kernel.brnb');
    const sql = await pedir('POST', '/kernel/sql', {
      caminho: outro, connectionId: 'c1', database: 'main', nome: 'x', statement: 'SELECT 1 AS um',
    });
    assert.equal(sql.success, true);
    assert.equal(sql.data.variavel, null);
    assert.match(sql.data.aviso, /não está rodando/);
  } finally {
    await fechar();
  }
});

test('PHP e JS pelas rotas: o SQL vira variável nos dois', async () => {
  const { pedir, fechar } = await servidor();
  try {
    for (const [linguagem, codigo, esperado] of [
      ['php', 'implode(",", array_column($pedidos, "cliente"))', "'Ana,Bia,Caio'\n"],
      ['typescript', 'const nomes: string[] = pedidos.map((p) => p.cliente)\nnomes.join(",")', "'Ana,Bia,Caio'\n"],
    ] as const) {
      const nb = path.join(pasta, `${linguagem}.brnb`);
      const k = await pedir('POST', '/kernel', { caminho: nb, linguagem, raiz: pasta });
      assert.equal(k.success, true, k.error ?? '');
      const sql = await pedir('POST', '/kernel/sql', {
        caminho: nb, connectionId: 'c1', database: 'main', nome: 'pedidos',
        statement: 'SELECT cliente FROM pedidos ORDER BY id',
      });
      assert.equal(sql.data.variavel.forma, 'array', linguagem);
      const { data } = await pedir('POST', '/kernel/executar', { caminho: nb, codigo });
      let fim: any;
      for (let i = 0; i < 200 && !fim?.terminou; i++) {
        fim = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(nb)}&exec=${data.exec}&desde=0`)).data;
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.equal(fim.saidas.map((x: any) => x.texto ?? x.mensagem).join(''), esperado, linguagem);
    }
  } finally {
    await fechar();
  }
});

test('Laravel: só sobe quando o notebook PEDE', async () => {
  const projeto = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-nb-laravel-'));
  fs.writeFileSync(path.join(projeto, 'artisan'), '');
  fs.mkdirSync(path.join(projeto, 'bootstrap'));
  // Um bootstrap FALSO: só registra que foi chamado, como o `tinker` chamaria.
  fs.writeFileSync(path.join(projeto, 'bootstrap', 'app.php'),
    "<?php class FakeK { function bootstrap() { $GLOBALS['laravel_subiu'] = 'sim'; } } " +
    "class FakeA { function make($c) { return new FakeK(); } } return new FakeA();");
  const nb = path.join(projeto, 'analise.brnb');
  const { pedir, fechar } = await servidor();
  try {
    const sem = await pedir('POST', '/kernel', { caminho: nb, linguagem: 'php', raiz: projeto });
    assert.equal(sem.data.laravelDisponivel, true);
    assert.equal(sem.data.laravel, false, 'desligado por padrão');
    const com = await pedir('POST', '/kernel', { caminho: nb, linguagem: 'php', raiz: projeto, laravel: true });
    assert.equal(com.data.laravel, true);
    const { data } = await pedir('POST', '/kernel/executar', { caminho: nb, codigo: '$laravel_subiu' });
    let fim: any;
    for (let i = 0; i < 200 && !fim?.terminou; i++) {
      fim = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(nb)}&exec=${data.exec}&desde=0`)).data;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(fim.saidas.map((x: any) => x.texto ?? '').join(''), "'sim'\n");
  } finally {
    await fechar();
  }
});
