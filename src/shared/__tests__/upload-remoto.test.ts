import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destinosDe, seguros, totalDeBytes } from '../remoto/upload';

const a = (relativo: string, bytes = 10) => ({ relativo, bytes });

test('um arquivo solto cai direto na pasta', () => {
  assert.deepEqual(destinosDe('/srv/app', [a('leiame.txt')]), [
    { relativo: 'leiame.txt', destino: '/srv/app/leiame.txt' },
  ]);
});

test('a estrutura da pasta arrastada é reproduzida', () => {
  // É o caso que ele descreveu: arrastar `src` para cima de `app` põe o
  // conteúdo em `app/src`.
  const d = destinosDe('/srv/app', [a('src/main.ts'), a('src/util/x.ts')]);
  assert.deepEqual(d.map((x) => x.destino), [
    '/srv/app/src/main.ts',
    '/srv/app/src/util/x.ts',
  ]);
});

test('separador a mais ou a menos chega igual do outro lado', () => {
  // Um separador a mais e `src` vira `//src`; um a menos e ela se funde com o
  // nome do arquivo. É onde um upload erra sem avisar.
  const d = destinosDe('/srv/app/', [a('./src//main.ts')]);
  assert.equal(d[0]?.destino, '/srv/app/src/main.ts');
});

test('a raiz não ganha barra dupla', () => {
  assert.equal(destinosDe('/', [a('x.txt')])[0]?.destino, '/x.txt');
});

test('arquivo sem nome relativo é descartado', () => {
  assert.deepEqual(destinosDe('/srv', [a(''), a('ok.txt')]).map((x) => x.relativo), ['ok.txt']);
});

// ---------------------------------------------------------------------------
// A cerca
// ---------------------------------------------------------------------------

test('`..` no nome é RECUSADO — o arraste é o único caminho em que o nome vem de fora', () => {
  const d = destinosDe('/srv/app', [a('../../etc/passwd'), a('ok.txt')]);
  const { ok, recusados } = seguros(d, '/srv/app');
  assert.deepEqual(ok.map((x) => x.relativo), ['ok.txt']);
  assert.deepEqual(recusados, ['../../etc/passwd']);
});

test('subir exatamente a pasta de destino também é recusado', () => {
  // `destino === pastaRemota` significa que o nome se anulou pelo caminho.
  const { ok, recusados } = seguros(
    [{ relativo: '.', destino: '/srv/app' }],
    '/srv/app'
  );
  assert.equal(ok.length, 0);
  assert.deepEqual(recusados, ['.']);
});

test('a cerca compara COMPONENTE, e não prefixo de texto', () => {
  const { ok } = seguros([{ relativo: 'x', destino: '/srv/app2/x' }], '/srv/app');
  assert.equal(ok.length, 0);
});

test('na raiz, tudo que está abaixo passa', () => {
  const { ok } = seguros(destinosDe('/', [a('a/b.txt')]), '/');
  assert.equal(ok.length, 1);
});

test('o total de bytes soma para a tela poder dizer antes', () => {
  assert.equal(totalDeBytes([a('x', 100), a('y', 24)]), 124);
  assert.equal(totalDeBytes([]), 0);
});
