import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  arquivosDaArvore, arvoreDaPasta, dentroDaPasta, listarSubpastas, MAX_NOS, MAX_PROFUNDIDADE,
  pastaValida,
} from '../pastas';

function comPasta(fn: (raiz: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-pastas-'));
  try {
    fn(fs.realpathSync(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- validação ----

test('pastaValida recusa o que não existe e o que não é pasta', () => {
  comPasta((raiz) => {
    const arquivo = path.join(raiz, 'a.txt');
    fs.writeFileSync(arquivo, 'x');
    assert.throws(() => pastaValida(path.join(raiz, 'nao-existe')), /não encontrada/);
    assert.throws(() => pastaValida(arquivo), /não encontrada/);
    assert.equal(pastaValida(raiz), raiz);
  });
});

test('pastaValida recusa byte nulo', () => {
  assert.throws(() => pastaValida('/tmp/\0mau'), /inválido/);
});

// ---- navegador ----

test('listarSubpastas devolve só pastas, ordenadas, e o pai', () => {
  comPasta((raiz) => {
    fs.mkdirSync(path.join(raiz, 'zeta'));
    fs.mkdirSync(path.join(raiz, 'alfa'));
    fs.writeFileSync(path.join(raiz, 'arquivo.txt'), 'x');

    const listagem = listarSubpastas(raiz);
    assert.deepEqual(listagem.dirs.map((d) => d.name), ['alfa', 'zeta']);
    assert.equal(listagem.parent, path.dirname(raiz));
  });
});

test('listarSubpastas esconde as ocultas mas mostra node_modules', () => {
  comPasta((raiz) => {
    fs.mkdirSync(path.join(raiz, '.cache'));
    fs.mkdirSync(path.join(raiz, 'node_modules'));

    // A árvore ignora `node_modules`; o navegador não pode escondê-la, senão
    // mentiria sobre o que existe no disco.
    assert.deepEqual(listarSubpastas(raiz).dirs.map((d) => d.name), ['node_modules']);
  });
});

test('a raiz do sistema de arquivos não tem pai', () => {
  assert.equal(listarSubpastas('/').parent, null);
});

// ---- árvore ----

test('a árvore ignora ocultos e as pastas de sempre', () => {
  comPasta((raiz) => {
    fs.mkdirSync(path.join(raiz, 'node_modules'));
    fs.writeFileSync(path.join(raiz, 'node_modules', 'x.js'), '');
    fs.mkdirSync(path.join(raiz, '.git'));
    fs.writeFileSync(path.join(raiz, '.env'), '');
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');

    const { nodes, truncated } = arvoreDaPasta(raiz);
    assert.deepEqual(nodes.map((n) => n.name), ['a.ts']);
    assert.equal(truncated, false);
  });
});

test('pasta antes de arquivo, e cada grupo em ordem alfabética', () => {
  comPasta((raiz) => {
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');
    fs.mkdirSync(path.join(raiz, 'zeta'));
    assert.deepEqual(arvoreDaPasta(raiz).nodes.map((n) => n.name), ['zeta', 'a.ts']);
  });
});

test('a profundidade tem teto — pasta muito aninhada para de descer', () => {
  comPasta((raiz) => {
    let atual = raiz;
    for (let i = 0; i <= MAX_PROFUNDIDADE + 2; i += 1) {
      atual = path.join(atual, `n${i}`);
      fs.mkdirSync(atual);
    }
    fs.writeFileSync(path.join(atual, 'fundo.txt'), '');

    // Sem teto isto desceria até o fim; a afirmação é que NÃO desce.
    const caminhos = arquivosDaArvore(arvoreDaPasta(raiz).nodes);
    assert.equal(caminhos.length, 0, 'o arquivo no fundo não pode aparecer');
  });
});

test('o número de nós tem teto, e a árvore avisa que cortou', () => {
  comPasta((raiz) => {
    // Um a mais que o teto: o corte precisa acontecer de verdade.
    for (let i = 0; i < MAX_NOS + 1; i += 1) {
      fs.writeFileSync(path.join(raiz, `a${i}.txt`), '');
    }
    const arvore = arvoreDaPasta(raiz);
    assert.equal(arvore.truncated, true);
    assert.equal(arvore.nodes.length, MAX_NOS);
  });
});

test('pasta sem permissão de leitura some da árvore em vez de derrubá-la', () => {
  comPasta((raiz) => {
    const proibida = path.join(raiz, 'proibida');
    fs.mkdirSync(proibida);
    fs.writeFileSync(path.join(proibida, 'x.txt'), '');
    fs.chmodSync(proibida, 0o000);
    try {
      const nos = arvoreDaPasta(raiz).nodes;
      assert.deepEqual(nos.map((n) => n.name), ['proibida']);
      assert.deepEqual(nos[0]?.children, []);
    } finally {
      fs.chmodSync(proibida, 0o700);
    }
  });
});

test('arquivosDaArvore filtra por extensão', () => {
  comPasta((raiz) => {
    fs.mkdirSync(path.join(raiz, 'sub'));
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');
    fs.writeFileSync(path.join(raiz, 'sub', 'b.py'), '');
    fs.writeFileSync(path.join(raiz, 'sub', 'c.txt'), '');

    const { nodes } = arvoreDaPasta(raiz);
    assert.equal(arquivosDaArvore(nodes).length, 3);
    assert.deepEqual(
      arquivosDaArvore(nodes, new Set(['.ts', '.py'])).map((c) => path.basename(c)).sort(),
      ['a.ts', 'b.py']
    );
  });
});

// ---- contenção ----

test('dentroDaPasta recusa caminho que escapa', () => {
  comPasta((raiz) => {
    assert.throws(() => dentroDaPasta(raiz, '../fora.txt'), /dentro da pasta/);
    assert.throws(() => dentroDaPasta(raiz, '/etc/passwd'), /dentro da pasta/);
    assert.throws(() => dentroDaPasta(raiz, 'sub/../../fora.txt'), /dentro da pasta/);
  });
});

test('dentroDaPasta aceita subcaminho e recusa byte nulo', () => {
  comPasta((raiz) => {
    assert.equal(dentroDaPasta(raiz, 'sub/a.ts'), path.join(raiz, 'sub', 'a.ts'));
    assert.throws(() => dentroDaPasta(raiz, 'a\0.ts'), /inválido/);
  });
});
