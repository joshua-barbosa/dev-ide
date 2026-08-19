import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  dentroDaPasta, filhosDaPasta, listarSubpastas, MAX_ENTRADAS, MAX_PROFUNDIDADE,
  pastaValida, varrerArquivos,
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

// ---- árvore (um nível por vez, spec 034) ----

test('a árvore MOSTRA os ocultos — eles são arquivo de trabalho', () => {
  comPasta((raiz) => {
    // Reportado pelo usuário em 2026-08-19: `.gitignore`, `.env`, `.claude` e
    // `.vscode` sumiam. O filtro por ponto inicial veio do navegador de PASTAS,
    // onde faz sentido; dentro de um projeto, oculto é arquivo que se edita.
    fs.writeFileSync(path.join(raiz, '.gitignore'), '');
    fs.writeFileSync(path.join(raiz, '.env'), '');
    fs.mkdirSync(path.join(raiz, '.vscode'));
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');

    const nomes = filhosDaPasta(raiz).nodes.map((n) => n.name);
    assert.deepEqual(nomes, ['.vscode', '.env', '.gitignore', 'a.ts']);
  });
});

test('a árvore mostra TAMBÉM as pastas de dependência', () => {
  // A versão anterior as escondia, e escondê-las era mentir sobre o projeto:
  // num projeto Laravel, `vendor` existe e o usuário sabe disso. O que resolveu
  // não foi mostrar menos — foi parar de ler a árvore inteira de uma vez.
  comPasta((raiz) => {
    for (const nome of ['node_modules', '.venv', 'vendor', 'dist']) {
      fs.mkdirSync(path.join(raiz, nome));
      fs.writeFileSync(path.join(raiz, nome, 'x.js'), '');
    }
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');

    const nomes = filhosDaPasta(raiz).nodes.map((n) => n.name);
    assert.deepEqual(nomes, ['.venv', 'dist', 'node_modules', 'vendor', 'a.ts']);
  });
});

test('metadado de controle de versão NÃO aparece (spec 036)', () => {
  // Lista curta e de um tipo só: nada aqui se edita, nunca. É o `files.exclude`
  // padrão do VS Code, e é o oposto de esconder `vendor` — que se abre.
  comPasta((raiz) => {
    for (const nome of ['.git', '.hg', '.svn', 'CVS']) fs.mkdirSync(path.join(raiz, nome));
    fs.writeFileSync(path.join(raiz, '.DS_Store'), '');
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');

    assert.deepEqual(filhosDaPasta(raiz).nodes.map((n) => n.name), ['a.ts']);
  });
});

test('o que o .gitignore ignora vem MARCADO, e não escondido', () => {
  comPasta((raiz) => {
    fs.writeFileSync(path.join(raiz, '.gitignore'), '*.log\nconstruido/\n');
    fs.mkdirSync(path.join(raiz, 'construido'));
    fs.mkdirSync(path.join(raiz, 'node_modules'));
    fs.writeFileSync(path.join(raiz, 'saida.log'), '');
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');

    const porNome = new Map(filhosDaPasta(raiz).nodes.map((n) => [n.name, n.ignored ?? false]));
    assert.equal(porNome.get('construido'), true);
    assert.equal(porNome.get('saida.log'), true);
    assert.equal(porNome.get('node_modules'), true, 'o padrão embutido também marca');
    assert.equal(porNome.get('a.ts'), false);
    assert.equal(porNome.get('.gitignore'), false);
  });
});

test('a marca vale DENTRO da subpasta, somando os .gitignore do caminho', () => {
  // Sem somar as regras da raiz, abrir uma subpasta perderia o cinza lá dentro.
  comPasta((raiz) => {
    fs.writeFileSync(path.join(raiz, '.gitignore'), '*.log\n');
    fs.mkdirSync(path.join(raiz, 'pacote'));
    fs.writeFileSync(path.join(raiz, 'pacote', '.gitignore'), 'gerado.ts\n');
    fs.writeFileSync(path.join(raiz, 'pacote', 'saida.log'), '');
    fs.writeFileSync(path.join(raiz, 'pacote', 'gerado.ts'), '');
    fs.writeFileSync(path.join(raiz, 'pacote', 'fonte.ts'), '');

    const sub = path.join(raiz, 'pacote');
    const porNome = new Map(filhosDaPasta(sub, raiz).nodes.map((n) => [n.name, n.ignored ?? false]));
    assert.equal(porNome.get('saida.log'), true, 'regra da raiz');
    assert.equal(porNome.get('gerado.ts'), true, 'regra da própria pasta');
    assert.equal(porNome.get('fonte.ts'), false);
  });
});

test('a árvore NÃO desce sozinha: pasta vem sem filhos', () => {
  // É o coração da mudança. `children` ausente significa "ainda não carregada";
  // uma lista vazia significaria "carregada e vazia", e a interface precisa
  // distinguir as duas para saber quando pedir.
  comPasta((raiz) => {
    fs.mkdirSync(path.join(raiz, 'sub'));
    fs.writeFileSync(path.join(raiz, 'sub', 'fundo.ts'), '');

    const sub = filhosDaPasta(raiz).nodes[0];
    assert.equal(sub?.name, 'sub');
    assert.equal(sub?.children, undefined);

    // E o nível de baixo chega quando é pedido.
    assert.deepEqual(filhosDaPasta(sub!.path).nodes.map((n) => n.name), ['fundo.ts']);
  });
});

test('pasta antes de arquivo, e cada grupo em ordem alfabética', () => {
  comPasta((raiz) => {
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');
    fs.mkdirSync(path.join(raiz, 'zeta'));
    assert.deepEqual(filhosDaPasta(raiz).nodes.map((n) => n.name), ['zeta', 'a.ts']);
  });
});

test('uma pasta com entradas demais é cortada, e avisa', () => {
  comPasta((raiz) => {
    for (let i = 0; i < MAX_ENTRADAS + 1; i += 1) {
      fs.writeFileSync(path.join(raiz, `a${i}.txt`), '');
    }
    const { nodes, truncated } = filhosDaPasta(raiz);
    assert.equal(nodes.length, MAX_ENTRADAS);
    assert.equal(truncated, true);
  });
});

test('pasta sem permissão de leitura vem vazia em vez de derrubar o painel', () => {
  comPasta((raiz) => {
    const proibida = path.join(raiz, 'proibida');
    fs.mkdirSync(proibida);
    fs.writeFileSync(path.join(proibida, 'x.txt'), '');
    fs.chmodSync(proibida, 0o000);
    try {
      assert.deepEqual(filhosDaPasta(raiz).nodes.map((n) => n.name), ['proibida']);
      assert.deepEqual(filhosDaPasta(proibida).nodes, []);
    } finally {
      fs.chmodSync(proibida, 0o700);
    }
  });
});

// ---- varredura (o outro lado: quem indexa, filtra) ----

test('a varredura PULA o que a árvore mostra', () => {
  comPasta((raiz) => {
    fs.mkdirSync(path.join(raiz, 'node_modules'));
    fs.writeFileSync(path.join(raiz, 'node_modules', 'dep.ts'), '');
    fs.mkdirSync(path.join(raiz, '.venv'));
    fs.writeFileSync(path.join(raiz, '.venv', 'lib.py'), '');
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');

    const { arquivos } = varrerArquivos(raiz);
    assert.deepEqual(arquivos.map((c) => path.basename(c)), ['a.ts']);
  });
});

test('a varredura obedece ao .gitignore do projeto', () => {
  comPasta((raiz) => {
    fs.writeFileSync(path.join(raiz, '.gitignore'), 'segredos/\n*.log\n!importante.log\n');
    fs.mkdirSync(path.join(raiz, 'segredos'));
    fs.writeFileSync(path.join(raiz, 'segredos', 'chave.txt'), '');
    fs.writeFileSync(path.join(raiz, 'ruido.log'), '');
    fs.writeFileSync(path.join(raiz, 'importante.log'), '');
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');

    const nomes = varrerArquivos(raiz).arquivos.map((c) => path.basename(c)).sort();
    assert.deepEqual(nomes, ['.gitignore', 'a.ts', 'importante.log']);
  });
});

test('o .gitignore de uma SUBPASTA vale para ela, e não para as irmãs', () => {
  // É o caso do monorepo: um `.gitignore` por pacote.
  comPasta((raiz) => {
    for (const pacote of ['api', 'web']) {
      fs.mkdirSync(path.join(raiz, pacote));
      fs.writeFileSync(path.join(raiz, pacote, 'gerado.ts'), '');
    }
    fs.writeFileSync(path.join(raiz, 'api', '.gitignore'), 'gerado.ts\n');

    const nomes = varrerArquivos(raiz, { extensoes: new Set(['.ts']) }).arquivos
      .map((c) => path.relative(raiz, c))
      .sort();
    assert.deepEqual(nomes, ['web/gerado.ts']);
  });
});

test('a varredura tem teto de profundidade', () => {
  comPasta((raiz) => {
    let atual = raiz;
    for (let i = 0; i <= MAX_PROFUNDIDADE + 2; i += 1) {
      atual = path.join(atual, `n${i}`);
      fs.mkdirSync(atual);
    }
    fs.writeFileSync(path.join(atual, 'fundo.txt'), '');
    assert.equal(varrerArquivos(raiz).arquivos.length, 0, 'o arquivo no fundo não aparece');
  });
});

test('a varredura tem teto de arquivos, e avisa que cortou', () => {
  comPasta((raiz) => {
    for (let i = 0; i < 12; i += 1) fs.writeFileSync(path.join(raiz, `a${i}.txt`), '');
    const { arquivos, truncated } = varrerArquivos(raiz, { max: 5 });
    assert.equal(arquivos.length, 5);
    assert.equal(truncated, true);
  });
});

test('a varredura filtra por extensão', () => {
  comPasta((raiz) => {
    fs.mkdirSync(path.join(raiz, 'sub'));
    fs.writeFileSync(path.join(raiz, 'a.ts'), '');
    fs.writeFileSync(path.join(raiz, 'sub', 'b.py'), '');
    fs.writeFileSync(path.join(raiz, 'sub', 'c.txt'), '');
    const nomes = varrerArquivos(raiz, { extensoes: new Set(['.ts', '.py']) }).arquivos
      .map((c) => path.basename(c))
      .sort();
    assert.deepEqual(nomes, ['a.ts', 'b.py']);
  });
});

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
