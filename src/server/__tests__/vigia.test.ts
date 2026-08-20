// O vigia de disco (spec 037).
//
// Testes com relógio de verdade: `fs.watch` é do sistema operacional, e um
// duble aqui provaria só que o duble funciona. Em troca, cada espera tem um
// teto generoso — lento é aceitável, intermitente não.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Vigia, type Mudanca } from '../vigia';

/** Espera até `condicao` valer, ou desiste. */
async function ate(condicao: () => boolean, limite = 4_000): Promise<void> {
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    if (condicao()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function comVigia(
  fn: (raiz: string, vistas: Mudanca[]) => Promise<void>
): Promise<void> {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-vigia-')));
  const vistas: Mudanca[] = [];
  const vigia = new Vigia(raiz, { aoMudar: (m) => vistas.push(...m) });
  try {
    await fn(raiz, vistas);
  } finally {
    vigia.parar();
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

const nomes = (vistas: readonly Mudanca[]): string[] =>
  [...new Set(vistas.map((m) => path.basename(m.caminho)))].sort();

test('avisa quando um arquivo é criado', async () => {
  await comVigia(async (raiz, vistas) => {
    fs.writeFileSync(path.join(raiz, 'novo.txt'), 'oi');
    await ate(() => vistas.length > 0);
    assert.deepEqual(nomes(vistas), ['novo.txt']);
    assert.equal(vistas[0]?.tipo, 'alterado');
    assert.equal(vistas[0]?.pasta, raiz, 'a pasta é o que a árvore precisa recarregar');
  });
});

test('avisa quando um arquivo é REMOVIDO', async () => {
  await comVigia(async (raiz, vistas) => {
    const alvo = path.join(raiz, 'some.txt');
    fs.writeFileSync(alvo, 'oi');
    await ate(() => vistas.length > 0);
    vistas.length = 0;

    fs.rmSync(alvo);
    await ate(() => vistas.length > 0);
    assert.equal(vistas.at(-1)?.tipo, 'removido');
  });
});

test('avisa em SUBPASTA, e em pasta criada depois', async () => {
  await comVigia(async (raiz, vistas) => {
    const sub = path.join(raiz, 'sub');
    fs.mkdirSync(sub);
    await ate(() => vistas.length > 0);
    vistas.length = 0;

    // A pasta nasceu depois do vigia: só é observada se ele a adotar sozinho.
    fs.writeFileSync(path.join(sub, 'dentro.txt'), 'oi');
    await ate(() => nomes(vistas).includes('dentro.txt'));
    assert.ok(nomes(vistas).includes('dentro.txt'), 'pasta nova precisa ser adotada');
  });
});

test('o que o .gitignore ignora NÃO gera aviso', async () => {
  // Sem isto, um `npm install` viraria uma tempestade sobre arquivos que a IDE
  // nem indexa — e comeria os observadores do sistema pelo caminho.
  await comVigia(async (raiz, vistas) => {
    fs.mkdirSync(path.join(raiz, 'node_modules'));
    await ate(() => vistas.length > 0, 500);
    vistas.length = 0;

    fs.writeFileSync(path.join(raiz, 'node_modules', 'dep.js'), 'x');
    fs.mkdirSync(path.join(raiz, '.venv'));
    await new Promise((r) => setTimeout(r, 600));

    fs.writeFileSync(path.join(raiz, 'conta.txt'), 'x');
    await ate(() => nomes(vistas).includes('conta.txt'));
    assert.deepEqual(nomes(vistas), ['conta.txt'], 'só o que a IDE indexa');
  });
});

test('vários eventos seguidos viram UM aviso só', async () => {
  await comVigia(async (raiz, vistas) => {
    let lotes = 0;
    const vigia = new Vigia(raiz, { aoMudar: () => { lotes += 1; } });
    try {
      for (let i = 0; i < 30; i += 1) fs.writeFileSync(path.join(raiz, `a${i}.txt`), 'x');
      await ate(() => lotes > 0);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(lotes, 1, `um git checkout não pode virar 30 avisos (foram ${lotes})`);
    } finally {
      vigia.parar();
    }
    assert.ok(vistas.length >= 0);
  });
});

test('parar solta os observadores e cala o vigia', async () => {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-vigia-')));
  const vistas: Mudanca[] = [];
  const vigia = new Vigia(raiz, { aoMudar: (m) => vistas.push(...m) });
  try {
    assert.ok(vigia.tamanho > 0);
    vigia.parar();
    assert.equal(vigia.tamanho, 0);

    fs.writeFileSync(path.join(raiz, 'depois.txt'), 'x');
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(vistas, [], 'vigia parado não avisa mais nada');
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
