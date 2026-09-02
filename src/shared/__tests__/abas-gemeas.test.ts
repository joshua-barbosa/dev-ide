// A identidade das abas gêmeas (T028).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ESQUEMA_DO_MODELO, caminhoDaUri, chaveDoModelo, ehCopia, gemeas, idBaseDe, idDeCopia, proximaCopia,
} from '../abas-gemeas';

const A = 'file:/casa/a.ts';
const B = 'file:/casa/b.ts';

test('a cópia carrega o id original dentro dela', () => {
  assert.equal(idDeCopia(A, 2), 'copia:2:file:/casa/a.ts');
  assert.equal(idBaseDe(idDeCopia(A, 2)), A);
});

test('um id que não é cópia é a própria base', () => {
  assert.equal(idBaseDe(A), A);
  assert.equal(ehCopia(A), false);
  assert.equal(ehCopia(idDeCopia(A, 3)), true);
});

test('arquivo cujo nome tem `#` não vira cópia por engano', () => {
  // O motivo de o marcador ser prefixo e não sufixo: no Linux `x#2` é nome de
  // arquivo legítimo, e um sufixo o leria como "cópia 2 de x".
  const estranho = 'file:/casa/x#2';
  assert.equal(ehCopia(estranho), false);
  assert.equal(idBaseDe(estranho), estranho);
});

test('as gêmeas incluem a própria aba', () => {
  const ids = [A, idDeCopia(A, 2), B];
  assert.deepEqual(gemeas(ids, A), [A, idDeCopia(A, 2)]);
  assert.deepEqual(gemeas(ids, idDeCopia(A, 2)), [A, idDeCopia(A, 2)]);
  assert.deepEqual(gemeas(ids, B), [B], 'outro arquivo não é gêmeo de ninguém');
});

test('a numeração começa em 2, porque a original é a 1', () => {
  assert.equal(proximaCopia([A], A), idDeCopia(A, 2));
});

test('a próxima cópia pula as que já existem', () => {
  const ids = [A, idDeCopia(A, 2), idDeCopia(A, 3)];
  assert.equal(proximaCopia(ids, A), idDeCopia(A, 4));
  assert.equal(proximaCopia(ids, idDeCopia(A, 2)), idDeCopia(A, 4), 'copiar a cópia também');
});

test('um buraco na numeração é reaproveitado', () => {
  const ids = [A, idDeCopia(A, 3)];
  assert.equal(proximaCopia(ids, A), idDeCopia(A, 2));
});

test('gêmeas dividem a chave do modelo; arquivos diferentes, não', () => {
  assert.equal(chaveDoModelo(A, '/casa/a.ts'), chaveDoModelo(idDeCopia(A, 2), '/casa/a.ts'));
  assert.notEqual(chaveDoModelo(A, '/casa/a.ts'), chaveDoModelo(B, '/casa/b.ts'));
});

test('aba sem arquivo tem modelo só dela', () => {
  assert.equal(chaveDoModelo('sem-titulo:1', null), 'aba:sem-titulo:1');
  assert.equal(chaveDoModelo('sem-titulo:1', ''), 'aba:sem-titulo:1');
  assert.notEqual(chaveDoModelo('sem-titulo:1', null), chaveDoModelo('sem-titulo:2', null));
});

// ---------------------------------------------------------------------------
// A URI do modelo, e a volta (lote E)
//
// Os provedores de linguagem do Monaco rodam DENTRO do editor e não enxergam o
// estado do React. O caminho do arquivo tem de sair da própria URI.
// ---------------------------------------------------------------------------

test('a URI de um arquivo devolve o caminho de volta', () => {
  const chave = chaveDoModelo('file:/casa/a.ts', '/casa/a.ts');
  const uri = `${ESQUEMA_DO_MODELO}${encodeURIComponent(chave)}`;
  assert.equal(caminhoDaUri(uri), '/casa/a.ts');
});

test('caminho com espaço e acento sobrevive à ida e à volta', () => {
  const caminho = '/casa/meus projetos/coração.ts';
  const uri = `${ESQUEMA_DO_MODELO}${encodeURIComponent(chaveDoModelo('x', caminho))}`;
  assert.equal(caminhoDaUri(uri), caminho);
});

test('aba SEM arquivo devolve `null`', () => {
  // Não há o que perguntar ao serviço de linguagem sobre um texto que não está
  // em lugar nenhum.
  const uri = `${ESQUEMA_DO_MODELO}${encodeURIComponent(chaveDoModelo('sem-titulo:1', null))}`;
  assert.equal(caminhoDaUri(uri), null);
});

test('URI de outro esquema devolve `null`', () => {
  assert.equal(caminhoDaUri('file:///casa/a.ts'), null);
  assert.equal(caminhoDaUri(''), null);
});

test('URI estragada não derruba o autocomplete', () => {
  // `%` solto faz o `decodeURIComponent` lançar.
  assert.equal(caminhoDaUri(`${ESQUEMA_DO_MODELO}%zz`), null);
});
