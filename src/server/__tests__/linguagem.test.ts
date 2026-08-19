// Ir para a definição e achar as referências (spec 032).
//
// O que se prova aqui é o que separa isto de um `grep`: o mesmo NOME em
// lugares diferentes é coisa diferente, e o serviço sabe disso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { definicao, definicaoDeTipo, ehSuportado, esquecerPasta, referencias } from '../linguagem';

function comProjeto(fn: (pasta: string) => void): void {
  const pasta = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-lang-')));
  try {
    fn(pasta);
  } finally {
    esquecerPasta(pasta);
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

/** Linha e coluna (1-based) da primeira ocorrência de um trecho. */
function em(texto: string, trecho: string): { linha: number; coluna: number } {
  const i = texto.indexOf(trecho);
  const antes = texto.slice(0, i);
  const linha = antes.split('\n').length;
  return { linha, coluna: i - (antes.lastIndexOf('\n') + 1) + 1 };
}

test('a definição pode estar em OUTRO arquivo', () => {
  comProjeto((pasta) => {
    fs.writeFileSync(
      path.join(pasta, 'util.ts'),
      'export function somar(a: number, b: number): number {\n  return a + b;\n}\n'
    );
    const usa = "import { somar } from './util';\n\nconsole.log(somar(1, 2));\n";
    const caminho = path.join(pasta, 'usa.ts');
    fs.writeFileSync(caminho, usa);

    const pos = em(usa, 'somar(1, 2)');
    const alvos = definicao({ pasta, caminho, ...pos });
    assert.equal(alvos.length, 1);
    assert.equal(path.basename(alvos[0]!.caminho), 'util.ts');
    assert.equal(alvos[0]!.linha, 1);
    assert.match(alvos[0]!.previa, /export function somar/);
  });
});

test('o MESMO nome em escopos diferentes leva a definições diferentes', () => {
  // É o que um `grep` nunca faria — e a razão de isto existir.
  comProjeto((pasta) => {
    const texto = [
      'const nome = "de fora";',
      'function dentro() {',
      '  const nome = "de dentro";',
      '  return nome;',
      '}',
      'export default nome;',
      '',
    ].join('\n');
    const caminho = path.join(pasta, 'escopos.ts');
    fs.writeFileSync(caminho, texto);

    const deDentro = definicao({ pasta, caminho, ...em(texto, 'return nome') , coluna: 10 });
    assert.equal(deDentro[0]?.linha, 3, 'o `nome` do return é o local');

    const deFora = definicao({ pasta, caminho, ...em(texto, 'export default nome'), coluna: 16 });
    assert.equal(deFora[0]?.linha, 1, 'o `nome` do export é o de cima');
  });
});

test('as referências acham os usos em todos os arquivos', () => {
  comProjeto((pasta) => {
    const util = 'export const VERSAO = "1.0";\n';
    fs.writeFileSync(path.join(pasta, 'util.ts'), util);
    fs.writeFileSync(
      path.join(pasta, 'a.ts'),
      "import { VERSAO } from './util';\nconsole.log(VERSAO);\n"
    );
    fs.writeFileSync(
      path.join(pasta, 'b.ts'),
      "import { VERSAO } from './util';\nexport const X = VERSAO;\n"
    );

    const caminho = path.join(pasta, 'util.ts');
    const alvos = referencias({ pasta, caminho, ...em(util, 'VERSAO') });
    const arquivos = new Set(alvos.map((a) => path.basename(a.caminho)));
    assert.deepEqual([...arquivos].sort(), ['a.ts', 'b.ts', 'util.ts']);
  });
});

test('a definição de TIPO leva à interface, e não à variável', () => {
  comProjeto((pasta) => {
    const texto = [
      'export interface Aluno { nome: string }',
      'const aluno: Aluno = { nome: "joshua" };',
      'console.log(aluno);',
      '',
    ].join('\n');
    const caminho = path.join(pasta, 'tipo.ts');
    fs.writeFileSync(caminho, texto);

    const pos = em(texto, 'console.log(aluno)');
    const uso = { pasta, caminho, linha: pos.linha, coluna: pos.coluna + 12 };
    assert.equal(definicao(uso)[0]?.linha, 2, 'a definição do VALOR é a const');
    assert.equal(definicaoDeTipo(uso)[0]?.linha, 1, 'a do TIPO é a interface');
  });
});

test('o que está na TELA vence o que está em disco', () => {
  // Sem isto, ir para a definição de algo recém-escrito não acharia nada — e o
  // usuário não tem por que salvar antes de navegar.
  comProjeto((pasta) => {
    const caminho = path.join(pasta, 'novo.ts');
    fs.writeFileSync(caminho, '// vazio\n');
    const naTela = 'function agora() {}\nagora();\n';

    const alvos = definicao({
      pasta,
      caminho,
      ...em(naTela, 'agora();'),
      conteudo: naTela,
    });
    assert.equal(alvos[0]?.linha, 1);
  });
});

test('arquivo que não é TS nem JS devolve vazio, sem erro', () => {
  comProjeto((pasta) => {
    const caminho = path.join(pasta, 'consulta.sql');
    fs.writeFileSync(caminho, 'SELECT 1;\n');
    assert.deepEqual(definicao({ pasta, caminho, linha: 1, coluna: 1 }), []);
    assert.equal(ehSuportado(caminho), false);
    assert.equal(ehSuportado('/p/a.tsx'), true);
  });
});

test('posição sem símbolo nenhum devolve vazio, e não explode', () => {
  comProjeto((pasta) => {
    const caminho = path.join(pasta, 'vazio.ts');
    fs.writeFileSync(caminho, 'const a = 1;\n\n\n');
    assert.deepEqual(definicao({ pasta, caminho, linha: 3, coluna: 1 }), []);
    assert.deepEqual(referencias({ pasta, caminho, linha: 99, coluna: 99 }), []);
  });
});

test('arquivo fora da lista ainda responde — pode ser novo', () => {
  comProjeto((pasta) => {
    // Cria DEPOIS de o serviço ter listado os arquivos da pasta.
    const primeiro = path.join(pasta, 'primeiro.ts');
    fs.writeFileSync(primeiro, 'export const A = 1;\n');
    definicao({ pasta, caminho: primeiro, linha: 1, coluna: 14 });

    const texto = 'function tarde() {}\ntarde();\n';
    const novo = path.join(pasta, 'tarde.ts');
    fs.writeFileSync(novo, texto);
    const alvos = definicao({ pasta, caminho: novo, ...em(texto, 'tarde();') });
    assert.equal(alvos[0]?.linha, 1);
  });
});
