// O histórico local em disco (T010, T035).
//
// Contra o disco de verdade, numa pasta temporária: o que este arquivo faz é
// justamente mexer em arquivo, e um mock provaria só que o mock funciona.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HistoricoStore } from '../historico';
import { POLITICA_PADRAO } from '../../shared/historico-local';

/** Um store novo numa pasta temporária, com relógio controlado. */
function comStore(
  o: (
    store: HistoricoStore,
    raiz: string,
    relogio: { agora: number }
  ) => void
): void {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-hist-'));
  const relogio = { agora: Date.UTC(2026, 8, 1, 12, 0, 0) };
  try {
    o(new HistoricoStore(raiz, POLITICA_PADRAO, () => relogio.agora), raiz, relogio);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

const ARQ = '/casa/projeto/src/index.ts';

test('guardar e ler de volta devolve o mesmo texto', () => {
  comStore((store) => {
    const v = store.guardar(ARQ, 'const a = 1;', 'salvo');
    assert.ok(v !== null);
    assert.equal(store.ler(ARQ, v.id)?.conteudo, 'const a = 1;');
  });
});

test('salvar de novo SEM MUDAR não cria versão', () => {
  comStore((store, _raiz, relogio) => {
    store.guardar(ARQ, 'igual', 'salvo');
    relogio.agora += 60_000;
    assert.equal(store.guardar(ARQ, 'igual', 'salvo'), null);
    assert.equal(store.listar(ARQ).length, 1);
  });
});

test('a lista vem da mais NOVA para a mais velha', () => {
  comStore((store, _raiz, relogio) => {
    store.guardar(ARQ, 'um', 'salvo');
    relogio.agora += 60_000;
    store.guardar(ARQ, 'dois', 'salvo');
    const versoes = store.listar(ARQ);
    assert.equal(versoes.length, 2);
    assert.equal(store.ler(ARQ, versoes[0]!.id)?.conteudo, 'dois');
  });
});

test('dois arquivos não misturam histórico', () => {
  comStore((store) => {
    store.guardar('/a/x.ts', 'do x', 'salvo');
    store.guardar('/a/y.ts', 'do y', 'salvo');
    assert.equal(store.listar('/a/x.ts').length, 1);
    assert.equal(store.ler('/a/x.ts', store.listar('/a/x.ts')[0]!.id)?.conteudo, 'do x');
  });
});

// ---------------------------------------------------------------------------
// T035 — o rascunho
// ---------------------------------------------------------------------------

test('o rascunho é achado pelo arquivo, e some ao salvar por cima', () => {
  comStore((store, _raiz, relogio) => {
    store.guardar(ARQ, 'trabalho não salvo', 'rascunho');
    assert.equal(store.rascunhoDe(ARQ)?.conteudo, 'trabalho não salvo');

    // Salvou: deixou de ser trabalho perdido e virou história. Manter os dois
    // faria a IDE oferecer para sempre um rascunho que já foi salvo.
    relogio.agora += 60_000;
    store.guardar(ARQ, 'trabalho não salvo', 'salvo');
    assert.equal(store.rascunhoDe(ARQ), null);
  });
});

test('descartar o rascunho o apaga, e o histórico salvo fica', () => {
  comStore((store, _raiz, relogio) => {
    store.guardar(ARQ, 'versão salva', 'salvo');
    relogio.agora += 60_000;
    store.guardar(ARQ, 'rascunho', 'rascunho');

    store.descartarRascunho(ARQ);
    assert.equal(store.rascunhoDe(ARQ), null);
    assert.equal(store.listar(ARQ).length, 1, 'a versão salva sobreviveu');
  });
});

test('a IDE acha os arquivos com rascunho pendente, do mais recente', () => {
  comStore((store, _raiz, relogio) => {
    store.guardar('/a/velho.ts', 'x', 'rascunho');
    relogio.agora += 60_000;
    store.guardar('/a/novo.ts', 'y', 'rascunho');
    store.guardar('/a/so-salvo.ts', 'z', 'salvo');

    const pendentes = store.arquivosComRascunho();
    assert.deepEqual(pendentes.map((p) => p.caminho), ['/a/novo.ts', '/a/velho.ts']);
  });
});

test('sem pasta nenhuma, a busca por rascunho não quebra', () => {
  const raiz = path.join(os.tmpdir(), `dev-ide-hist-nao-existe-${Date.now()}`);
  assert.deepEqual(new HistoricoStore(raiz).arquivosComRascunho(), []);
});

// ---------------------------------------------------------------------------
// A poda, e o disco
// ---------------------------------------------------------------------------

test('a poda apaga o TEXTO das versões que saíram', () => {
  // A poda tira do índice; o conteúdo é o que pesa. Sem apagar o `.txt`, o
  // disco cresceria para sempre.
  comStore((store, raiz, relogio) => {
    for (let i = 0; i < POLITICA_PADRAO.maxPorArquivo + 5; i += 1) {
      store.guardar(ARQ, `versão ${i}`, 'salvo');
      relogio.agora += 60_000;
    }
    assert.equal(store.listar(ARQ).length, POLITICA_PADRAO.maxPorArquivo);

    const pasta = fs.readdirSync(raiz)[0] as string;
    const textos = fs.readdirSync(path.join(raiz, pasta)).filter((f) => f.endsWith('.txt'));
    assert.equal(textos.length, POLITICA_PADRAO.maxPorArquivo, 'nenhum texto órfão sobrou');
  });
});

test('arquivo grande demais não entra', () => {
  comStore((store) => {
    const gordo = 'x'.repeat(POLITICA_PADRAO.maxBytes + 1);
    assert.equal(store.guardar(ARQ, gordo, 'salvo'), null);
    assert.equal(store.listar(ARQ).length, 0);
  });
});

test('índice estragado não custa o histórico inteiro', () => {
  comStore((store, raiz) => {
    const v = store.guardar(ARQ, 'boa', 'salvo');
    const pasta = path.join(raiz, fs.readdirSync(raiz)[0] as string);
    // Uma entrada lixo no meio das boas.
    const indice = JSON.parse(fs.readFileSync(path.join(pasta, 'indice.json'), 'utf8')) as {
      caminho: string;
      versoes: unknown[];
    };
    indice.versoes.push({ isto: 'não é uma versão' });
    fs.writeFileSync(path.join(pasta, 'indice.json'), JSON.stringify(indice));

    assert.equal(store.listar(ARQ).length, 1, 'a entrada boa sobreviveu');
    assert.equal(store.ler(ARQ, v!.id)?.conteudo, 'boa');
  });
});

test('versão cujo texto sumiu do disco não derruba a leitura', () => {
  comStore((store, raiz) => {
    const v = store.guardar(ARQ, 'vai sumir', 'salvo');
    const pasta = path.join(raiz, fs.readdirSync(raiz)[0] as string);
    fs.unlinkSync(path.join(pasta, `${v!.id}.txt`));
    // Alguém limpou à mão. "Não achei" é a verdade; quebrar não é.
    assert.equal(store.ler(ARQ, v!.id), null);
  });
});

test('a pasta do histórico nasce só para o dono', () => {
  // Ela guarda conteúdo de arquivo dele — inclusive de arquivo com segredo
  // dentro, que ele estava editando quando a janela fechou.
  comStore((store, raiz) => {
    store.guardar(ARQ, 'segredo', 'salvo');
    const pasta = path.join(raiz, fs.readdirSync(raiz)[0] as string);
    assert.equal(fs.statSync(pasta).mode & 0o777, 0o700);
  });
});
