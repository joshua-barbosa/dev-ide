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
  app.use('/api/notebook', createNotebookRouter(gerente, pool, () => 'sqlite', () =>
    sqliteDriver.connect({ id: 'c1', type: 'sqlite', label: 'e', readOnly: false, fields: { file: banco } })));
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
async function rodar(
  pedir: Awaited<ReturnType<typeof servidor>>['pedir'], codigo: string, linguagem = 'python', nb = caminho,
  conexao: unknown = { connectionId: 'c1', database: 'main' }
) {
  const { data, error } = await pedir('POST', '/kernel/executar', { caminho: nb, linguagem, codigo, conexao });
  if (data === null) throw new Error(error ?? 'executar falhou');
  let saidas: any[] = [];
  for (let i = 0; i < 200; i++) {
    const q = (await pedir('GET', `/kernel/execucao?caminho=${encodeURIComponent(nb)}&linguagem=${linguagem}&exec=${data.exec}&desde=${saidas.length}`)).data;
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
      const fim = await rodar(pedir, codigo, linguagem, nb);
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
    const fim = await rodar(pedir, '$laravel_subiu', 'php', nb);
    assert.equal(fim.saidas.map((x: any) => x.texto ?? '').join(''), "'sim'\n");
  } finally {
    await fechar();
  }
});

test('{{nome}}: o valor do kernel vai como PARÂMETRO — aspas não quebram, injeção não passa', async () => {
  const { pedir, fechar } = await servidor();
  try {
    await pedir('POST', '/kernel', { caminho, linguagem: 'python', raiz: pasta });
    // Um valor que, colado no texto, quebraria o SQL — e tentaria apagar a tabela.
    await rodar(pedir, 'nome = "Bia\'; DROP TABLE pedidos; --"\nminimo = 1000\nclientes = ["Ana", "Caio"]');
    const ruim = await pedir('POST', '/kernel/sql', {
      caminho, connectionId: 'c1', database: 'main', nome: 'r',
      statement: 'SELECT cliente FROM pedidos WHERE cliente = {{nome}}',
    });
    assert.equal(ruim.success, true, ruim.error ?? '');
    assert.equal(ruim.data.tabela.total, 0, 'o texto é comparado como TEXTO, não executado');
    const aindaLa = await pedir('POST', '/kernel/sql', {
      caminho, connectionId: 'c1', database: 'main', nome: null, statement: 'SELECT count(*) FROM pedidos',
    });
    assert.equal(aindaLa.data.tabela.linhas[0][0], 3, 'a tabela continua lá');

    const filtro = await pedir('POST', '/kernel/sql', {
      caminho, connectionId: 'c1', database: 'main', nome: 'r',
      statement: 'SELECT cliente FROM pedidos WHERE total > {{minimo}} OR cliente IN {{clientes}} ORDER BY id',
    });
    assert.deepEqual(filtro.data.tabela.linhas, [['Ana'], ['Bia'], ['Caio']]);
  } finally {
    await fechar();
  }
});

test('{{nome}} que o kernel não tem: erro claro, nada roda', async () => {
  const { pedir, fechar } = await servidor();
  try {
    await pedir('POST', '/kernel', { caminho, linguagem: 'python', raiz: pasta });
    const r = await pedir('POST', '/kernel/sql', {
      caminho, connectionId: 'c1', database: 'main', nome: null,
      statement: 'SELECT * FROM pedidos WHERE id = {{nao_existe}}',
    });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /nao_existe.*não existe no kernel/);
  } finally {
    await fechar();
  }
});

// ---- Várias linguagens no mesmo notebook (spec 113) ----

test('o caso dele, de verdade: SQL → Node altera → Python recebe e altera → Node e PHP recebem', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'misto.brnb');
  try {
    for (const linguagem of ['javascript', 'python', 'php']) {
      const k = await pedir('POST', '/kernel', { caminho: nb, linguagem, raiz: pasta });
      assert.equal(k.success, true, k.error ?? '');
    }
    const sql = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: 'pedidos', raiz: pasta,
      linguagens: ['javascript', 'python', 'php'],
      statement: 'SELECT id, total FROM pedidos ORDER BY id',
    });
    assert.equal(sql.success, true, sql.error ?? '');
    assert.deepEqual([...sql.data.variavel.linguagens].sort(), ['Node', 'PHP', 'Python']);

    // Node: altera POR DENTRO (não reatribui).
    const n1 = await rodar(pedir, 'pedidos.forEach((p) => { p.desconto = p.total / 10 }); pedidos.length', 'javascript', nb);
    assert.equal(n1.ok, true, JSON.stringify(n1.saidas));
    // Python: recebe com desconto e cria liquido.
    const p1 = await rodar(pedir,
      'for p in pedidos:\n    p["liquido"] = p["total"] - p["desconto"]\n[p["liquido"] for p in pedidos]', 'python', nb);
    // 45, e não 45.0: o REAL do banco passou pelo Node, onde 50.0 é 50 — o
    // "tipo exato" que se perde na viagem, aceito pelo usuário (spec 113, P2).
    assert.equal(p1.saidas.map((x) => x.texto ?? x.mensagem).join(''), '[45, 1350, 2250]\n');
    // Node de novo: recebe o liquido do Python.
    const n2 = await rodar(pedir, 'pedidos.map((p) => p.liquido).join(",")', 'javascript', nb);
    assert.equal(n2.saidas.map((x) => x.texto ?? x.mensagem).join(''), "'45,1350,2250'\n");
    // PHP: recebe tudo o que veio do Node e do Python.
    const h1 = await rodar(pedir, 'implode(",", array_column($pedidos, "liquido"))', 'php', nb);
    assert.equal(h1.saidas.map((x) => x.texto ?? x.mensagem).join(''), "'45,1350,2250'\n");
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('variável criada no Node chega ao Python; {{nome}} usa a mais recente', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'misto2.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'python', raiz: pasta });
    await rodar(pedir, 'const ids = [1, 2]', 'javascript', nb);
    const p = await rodar(pedir, 'ids = ids + [3]\nlen(ids)', 'python', nb);
    assert.equal(p.saidas.map((x) => x.texto ?? x.mensagem).join(''), '3\n');
    const sql = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null,
      statement: 'SELECT cliente FROM pedidos WHERE id IN {{ids}} ORDER BY id',
    });
    assert.equal(sql.success, true, sql.error ?? '');
    assert.equal(sql.data.tabela.total, 3, 'o ids do Python (3 itens), não o do Node (2)');
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('função, módulo e classe não atravessam; o dado sim', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'misto3.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'python', raiz: pasta });
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
    await rodar(pedir, 'import json\nfrom datetime import date\ndef dobro(n):\n    return n * 2\nquando = date(2026, 9, 30)\nconfig = {"a": 1}', 'python', nb);
    const j = await rodar(pedir, '[typeof json, typeof dobro, quando, config.a].join("|")', 'javascript', nb);
    assert.equal(j.saidas.map((x) => x.texto ?? x.mensagem).join(''), "'undefined|undefined|2026-09-30|1'\n");
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('reiniciar UM kernel: o resto continua, e o reiniciado não recebe de volta o que era dele', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'misto4.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'python', raiz: pasta });
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
    await rodar(pedir, 'x = 1', 'python', nb);
    await rodar(pedir, 'const y = x + 1', 'javascript', nb);
    const r = await pedir('POST', '/kernel/reiniciar', { caminho: nb, linguagem: 'python' });
    assert.equal(r.success, true, r.error ?? '');
    const p = await rodar(pedir, "'x' in dir(), y", 'python', nb);
    assert.equal(p.saidas.map((s) => s.texto ?? s.mensagem).join(''), '(False, 2)\n');
    const kernels = await pedir('GET', `/kernels?caminho=${encodeURIComponent(nb)}`);
    assert.deepEqual(kernels.data.map((k: any) => k.familia).sort(), ['node', 'python']);
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

// ---- sql() dentro do kernel (spec 114, C) ----
// O caso dele: "uma lista de ids… rodar … para cada uma delas", e "um update
// … rodando uma construção de SQL". Banco: o SQLite de exemplo, de verdade.

const texto = (r: { saidas: any[] }) => r.saidas.map((x) => x.texto ?? x.mensagem).join('');

test('sql() no Python, no JS e no PHP: lê pela conexão do notebook, com ? como parâmetro', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'sql-kernel.brnb');
  try {
    for (const linguagem of ['python', 'javascript', 'php']) {
      await pedir('POST', '/kernel', { caminho: nb, linguagem, raiz: pasta });
    }
    const p = await rodar(pedir, "[r['cliente'] for r in sql('SELECT cliente FROM pedidos WHERE total > ? ORDER BY id', [1000])]", 'python', nb);
    assert.equal(texto(p), "['Bia', 'Caio']\n");
    const j = await rodar(pedir, "(await sql('SELECT cliente FROM pedidos WHERE id = ?', [1]))[0].cliente", 'javascript', nb);
    assert.equal(texto(j), "'Ana'\n");
    const h = await rodar(pedir, "sql('SELECT count(*) AS n FROM pedidos WHERE cliente <> ?', ['Ana'])[0]['n']", 'php', nb);
    assert.equal(texto(h), '2\n');
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('sql() num laço de UPDATE: cada um vale sozinho, e conta as linhas', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'sql-laco.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
    await rodar(pedir, "await sql('CREATE TABLE IF NOT EXISTS marcas (id INTEGER, code TEXT, visto INTEGER DEFAULT 0)')", 'javascript', nb);
    await rodar(pedir, "await sql('DELETE FROM marcas'); for (const [i, c] of [[1, 'a'], [2, 'b'], [3, 'c']]) await sql('INSERT INTO marcas (id, code) VALUES (?, ?)', [i, c])", 'javascript', nb);
    const r = await rodar(pedir, [
      'const alvo = [{ id: 1, code: "a" }, { id: 3, code: "c" }]',
      'let total = 0',
      'for (const p of alvo) total += (await sql("UPDATE marcas SET visto = 1 WHERE id = ? AND code = ?", [p.id, p.code])).linhasAfetadas',
      'total',
    ].join('\n'), 'javascript', nb);
    assert.equal(texto(r), '2\n');
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('sql.transacao: confirma o bloco inteiro; com erro no meio, NADA fica gravado', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'sql-transacao.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'python', raiz: pasta });
    await rodar(pedir, "sql('CREATE TABLE IF NOT EXISTS lote (n INTEGER)')\nsql('DELETE FROM lote')", 'python', nb);
    const ok = await rodar(pedir, "with sql.transacao():\n    for n in [1, 2, 3]: sql('INSERT INTO lote (n) VALUES (?)', [n])", 'python', nb);
    assert.equal(ok.ok, true, texto(ok));
    const falhou = await rodar(pedir, [
      'with sql.transacao():',
      "    sql('INSERT INTO lote (n) VALUES (?)', [4])",
      "    sql('INSERT INTO tabela_que_nao_existe (n) VALUES (?)', [5])",
    ].join('\n'), 'python', nb);
    assert.equal(falhou.ok, false);
    assert.match(texto(falhou), /no such table/);
    const n = await rodar(pedir, "[r['n'] for r in sql('SELECT n FROM lote ORDER BY n')]", 'python', nb);
    assert.equal(texto(n), '[1, 2, 3]\n', 'o 4 foi desfeito junto com o erro');
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('sql() sem conexão no notebook: a exceção diz o que fazer', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'sql-sem-conexao.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
    const r = await rodar(pedir, "await sql('SELECT 1')", 'javascript', nb, null);
    assert.equal(r.ok, false);
    assert.match(texto(r), /escolha uma na barra de cima/);
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('{{nome}} com um dicionário do Python vai como JSON (e não como repr do Python)', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'dict-param.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'python', raiz: pasta });
    await rodar(pedir, "filtro = {'cliente': 'Bia'}", 'python', nb);
    const r = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null,
      // O TEXTO que chega: o json_extract do SQLite aceita JSON5 (aspas
      // simples) e leria até o repr do Python — não serviria de prova.
      statement: 'SELECT {{filtro}} AS t',
    });
    assert.equal(r.success, true, r.error ?? '');
    assert.equal(r.data.tabela.linhas[0][0], '{"cliente": "Bia"}');
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

// ---- Pares no {{ }} (spec 114, A) ----
test('o caso dele: UPDATE … WHERE (id, code) IN {{pedidos(id, code)}}, com a lista vinda do kernel', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'pares.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
    await rodar(pedir, [
      "await sql('CREATE TABLE IF NOT EXISTS pares (id INTEGER, code TEXT, visto INTEGER DEFAULT 0)')",
      "await sql('DELETE FROM pares')",
      "for (const [i, c] of [[1, 'a'], [2, 'b'], [3, 'c'], [1, 'z']]) await sql('INSERT INTO pares (id, code) VALUES (?, ?)', [i, c])",
      "const pedidos = [{ id: 1, code: 'a' }, { id: 3, code: 'c' }]",
    ].join('\n'), 'javascript', nb);
    const up = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null,
      statement: 'UPDATE pares SET visto = 1 WHERE (id, code) IN {{pedidos(id, code)}}',
    });
    assert.equal(up.success, true, up.error ?? '');
    const vistos = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null,
      statement: 'SELECT id, code FROM pares WHERE visto = 1 ORDER BY id',
    });
    // (1, 'z') tem o id certo e o code errado: não entra. É o "id AND code".
    assert.deepEqual(vistos.data.tabela.linhas, [[1, 'a'], [3, 'c']]);
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('Python: uma lista de dicionários nos pares; uma coluna só vira o IN simples', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'pares-py.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'python', raiz: pasta });
    await rodar(pedir, "alvo = [{'cliente': 'Bia', 'total': 1500}, {'cliente': 'Caio', 'total': 1}]", 'python', nb);
    const r = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null,
      statement: 'SELECT cliente FROM pedidos WHERE (cliente, total) IN {{alvo(cliente, total)}} ORDER BY id',
    });
    assert.equal(r.success, true, r.error ?? '');
    assert.deepEqual(r.data.tabela.linhas, [['Bia']], 'Caio com total 1 não casa');
    const s = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null,
      statement: 'SELECT count(*) FROM pedidos WHERE cliente IN {{alvo(cliente)}}',
    });
    assert.equal(s.data.tabela.linhas[0][0], 2);
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

// ---- "Para cada item" (spec 114, B) ----
test('para cada id: a função roda por item, e o resultado vira UMA tabela com a coluna item', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'para-cada.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'javascript', raiz: pasta });
    await rodar(pedir, 'const ids = [1, 3]', 'javascript', nb);
    const r = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: 'busca', paraCada: 'ids',
      linguagens: ['javascript'], raiz: pasta,
      // No SQLite, upper() faz o papel da "function ModoBusca" do caso dele.
      statement: 'SELECT upper(cliente) AS r FROM pedidos WHERE id = {{item}}',
    });
    assert.equal(r.success, true, r.error ?? '');
    assert.deepEqual(r.data.tabela.colunas, ['item', 'r']);
    assert.deepEqual(r.data.tabela.linhas, [[1, 'ANA'], [2, 'CAIO']]);
    assert.equal(r.data.paraCada.comandos, 2);
    const k = await rodar(pedir, 'busca.map((b) => b.r).join(",")', 'javascript', nb);
    assert.equal(k.saidas.map((x) => x.texto).join(''), "'ANA,CAIO'\n");
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('para cada objeto: UPDATE com {{item.id}} e {{item.code}}; um item com erro PARA ali', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'para-cada-update.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'python', raiz: pasta });
    await rodar(pedir, [
      "sql('CREATE TABLE IF NOT EXISTS pc (id INTEGER, code TEXT, visto INTEGER DEFAULT 0)')",
      "sql('DELETE FROM pc')",
      "for i, c in [(1, 'a'), (2, 'b'), (3, 'c')]: sql('INSERT INTO pc (id, code) VALUES (?, ?)', [i, c])",
      "lote = [{'id': 1, 'code': 'a'}, {'id': 2, 'code': 'b'}]",
      "ruim = [{'id': 1}, {'id': 1}, {'id': 3}]",
    ].join('\n'), 'python', nb);
    const up = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null, paraCada: 'lote',
      statement: 'UPDATE pc SET visto = 1 WHERE id = {{item.id}} AND code = {{item.code}}',
    });
    assert.equal(up.success, true, up.error ?? '');
    assert.deepEqual(up.data.paraCada, { total: 2, comandos: 2, escritas: 2, linhasAfetadas: 2, falha: null, parado: false });

    // O segundo item quebra de verdade, na hora de rodar: chave repetida.
    await rodar(pedir, "sql('CREATE TABLE IF NOT EXISTS pk (id INTEGER PRIMARY KEY)')\nsql('DELETE FROM pk')", 'python', nb);
    const falha = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null, paraCada: 'ruim',
      statement: 'INSERT INTO pk (id) VALUES ({{item.id}})',
    });
    assert.equal(falha.success, true, falha.error ?? '');
    assert.equal(falha.data.paraCada.comandos, 1);
    assert.equal(falha.data.paraCada.falha.item, 2);
    assert.match(falha.data.paraCada.falha.mensagem, /UNIQUE/);
    const ids = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null, statement: 'SELECT id FROM pk ORDER BY id',
    });
    // O 1º valeu; o 3º não rodou.
    assert.deepEqual(ids.data.tabela.linhas, [[1]]);
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

// ---- {{lista}} como TABELA (spec 114, D) ----
test('o pedido dele: select * from {{messages}} m — e cruzando com uma tabela do banco', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'tabela-var.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'typescript', raiz: pasta });
    await rodar(pedir, "const messages = [{ id: 1, message: 'olá' }, { id: 3, message: 'tchau' }]", 'typescript', nb);
    const r = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null,
      statement: 'select m.id, m.message, p.cliente from {{messages}} m join pedidos p on p.id = m.id order by m.id',
    });
    assert.equal(r.success, true, r.error ?? '');
    assert.deepEqual(r.data.tabela.linhas, [[1, 'olá', 'Ana'], [3, 'tchau', 'Caio']]);
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});

test('{{filters.ano}}: o campo de um (object)[…] do PHP vira parâmetro (pergunta de 01/10)', async () => {
  const { pedir, fechar } = await servidor();
  const nb = path.join(pasta, 'filtros-php.brnb');
  try {
    await pedir('POST', '/kernel', { caminho: nb, linguagem: 'php', raiz: pasta });
    await rodar(pedir, "$filters = (object) ['cliente' => 'Bia', 'minimo' => 1000];", 'php', nb);
    const r = await pedir('POST', '/kernel/sql', {
      caminho: nb, connectionId: 'c1', database: 'main', nome: null,
      statement: 'SELECT cliente FROM pedidos WHERE cliente = {{filters.cliente}} AND total > {{filters.minimo}}',
    });
    assert.equal(r.success, true, r.error ?? '');
    assert.deepEqual(r.data.tabela.linhas, [['Bia']]);
  } finally {
    gerente.encerrar(nb);
    await fechar();
  }
});
