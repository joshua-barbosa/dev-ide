import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ICONES_DE_SERVICO,
  ICONE_DE_FTP,
  ICONE_DE_SSH,
  NODE_ICONS,
  TAB_ICONS,
} from '../icons';
import {
  CODICON_GENERICO,
  MARCAS_COM_SVG,
  codiconDe,
  ehMarca,
  svgDaMarca,
} from '../icones-do-editor';

test('todo ícone do contrato tem codicon — nenhum cai no genérico por esquecimento', () => {
  const esquecidos = [...NODE_ICONS, ...TAB_ICONS].filter(
    (nome) => codiconDe(nome) === CODICON_GENERICO
  );
  assert.deepEqual(esquecidos, []);
});

test('nome desconhecido cai no genérico, em vez de quebrar a árvore', () => {
  assert.equal(codiconDe('nao-existe'), CODICON_GENERICO);
  assert.equal(codiconDe(''), CODICON_GENERICO);
});

test('aceita o nome já qualificado com lucide:, como o motor às vezes manda', () => {
  assert.equal(codiconDe('lucide:table'), codiconDe('table'));
  assert.equal(codiconDe('lucide:database'), codiconDe('database'));
});

test('o codicon é sempre um nome de ícone válido — minúsculas e hífen', () => {
  for (const nome of [...NODE_ICONS, ...TAB_ICONS]) {
    assert.match(codiconDe(nome), /^[a-z0-9-]+$/, `${nome} -> ${codiconDe(nome)}`);
  }
});

test('marca de produto é reconhecida, e só ela', () => {
  assert.equal(ehMarca('devicon:redis'), true);
  assert.equal(ehMarca('devicon:mongodb'), true);
  assert.equal(ehMarca('table'), false);
  assert.equal(ehMarca('lucide:database'), false);
});

test('marca sem SVG nosso cai em `server`, que foi a escolha DELE', () => {
  // *"Os que não tiver usa o ícone padrão de server"* (08/09/2026).
  assert.equal(codiconDe('devicon:naoexiste'), 'server');
  assert.equal(svgDaMarca('devicon:naoexiste'), null);
});

test('SVG e codicon são coisas diferentes, e não se misturam', () => {
  // `redis` NÃO é codicon: devolvê-lo como se fosse deixaria o item sem ícone.
  assert.equal(codiconDe('devicon:redis'), 'server');
  assert.equal(svgDaMarca('devicon:redis'), 'redis');
  assert.equal(svgDaMarca('table'), null);
});

test('as marcas com SVG são exatamente as que o pacote leva', () => {
  // Divergir aqui é o defeito silencioso: a lista diz que temos o SVG, o
  // pacote não tem, e a conexão fica sem ícone nenhum na lateral.
  const declaradas = Object.values(ICONES_DE_SERVICO).map((i) => i.slice('devicon:'.length));
  assert.deepEqual([...MARCAS_COM_SVG].sort(), [...declaradas].sort());
});

test('o ícone que cada DRIVER declara também tem codicon', () => {
  // Não são nós nem abas: chegam pelo `/drivers` e desenham a linha da
  // conexão. Ficaram de fora do primeiro guarda e cairiam no genérico.
  for (const icone of [ICONE_DE_SSH, ICONE_DE_FTP]) {
    assert.notEqual(codiconDe(icone), CODICON_GENERICO, icone);
  }
});

test('a cópia da extensão é IDÊNTICA à daqui', () => {
  // A extensão compila com `rootDir` próprio e não alcança `src/shared`, então
  // o mapa vive nos dois lugares. Cópia sem guarda vira divergência: um driver
  // novo ganharia ícone na IDE e um círculo vazio na extensão, e ninguém
  // perceberia até ele abrir a árvore.
  // O teste roda de `dist/shared/__tests__`; a fonte está em `src/`.
  const raiz = path.resolve(__dirname, '..', '..', '..');
  const daqui = path.join(raiz, 'src', 'shared', 'icones-do-editor.ts');
  const la = path.join(raiz, 'extensao', 'src', 'icones-do-editor.ts');
  assert.equal(
    readFileSync(la, 'utf8'),
    readFileSync(daqui, 'utf8'),
    'copie `src/shared/icones-do-editor.ts` para `extensao/src/` — os dois têm de ser iguais'
  );
});
