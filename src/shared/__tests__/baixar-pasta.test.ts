// A varredura de uma pasta remota (T089).
//
// `listar` é injetado, então a árvore inteira mora aqui e nenhum servidor é
// tocado — inclusive os casos que ninguém consegue reproduzir de propósito num
// servidor de verdade: o link que aponta para a raiz, e o ciclo de montagem.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  juntar, LIMITES_PADRAO, relativoA, varrerPasta, type EntradaRemota,
} from '../baixar-pasta';

/** Uma árvore de mentira: caminho → entradas. */
function servidorFalso(arvore: Record<string, readonly EntradaRemota[]>) {
  const pedidos: string[] = [];
  return {
    pedidos,
    listar: async (caminho: string): Promise<readonly EntradaRemota[]> => {
      pedidos.push(caminho);
      return arvore[caminho] ?? [];
    },
  };
}

const arq = (name: string, size = 10): EntradaRemota =>
  ({ name, kind: 'file', size, modifiedAt: null });
const dir = (name: string): EntradaRemota =>
  ({ name, kind: 'folder', size: null, modifiedAt: null });

test('varre a pasta inteira, entrando nas subpastas', async () => {
  const { listar } = servidorFalso({
    '/var/www/site': [arq('index.php', 100), dir('css'), dir('js')],
    '/var/www/site/css': [arq('estilo.css', 50)],
    '/var/www/site/js': [arq('app.js', 30), dir('vendor')],
    '/var/www/site/js/vendor': [arq('lib.js', 20)],
  });

  const r = await varrerPasta('/var/www/site', listar);
  assert.deepEqual(r.arquivos.map((a) => a.relativo).sort(), [
    'site/css/estilo.css',
    'site/index.php',
    'site/js/app.js',
    'site/js/vendor/lib.js',
  ]);
  assert.equal(r.totalBytes, 200);
});

test('a pasta baixada entra no zip COMO PASTA', () => {
  // Extrair um zip que despeja quarenta arquivos soltos na pasta de downloads
  // é o que ninguém quer.
  assert.equal(relativoA('/var/www/site', '/var/www/site/index.php'), 'site/index.php');
  assert.equal(relativoA('/var/www/site/', '/var/www/site/a/b.txt'), 'site/a/b.txt');
});

test('link simbólico NÃO é seguido', async () => {
  // Um link para `/` faria a varredura tentar baixar o servidor inteiro.
  const { listar, pedidos } = servidorFalso({
    '/app': [arq('a.txt'), { name: 'raiz', kind: 'link', size: null, modifiedAt: null }],
  });
  const r = await varrerPasta('/app', listar);
  assert.deepEqual(r.arquivos.map((a) => a.relativo), ['app/a.txt']);
  assert.deepEqual(pedidos, ['/app'], 'não entrou no link');
});

test('ciclo de montagem não vira laço infinito', async () => {
  // `/a/espelho` montado de volta em `/a`: sem a guarda, isto roda para sempre.
  const { listar } = servidorFalso({
    '/a': [dir('espelho'), arq('x.txt')],
    '/a/espelho': [dir('..'), arq('y.txt')],
  });
  const r = await varrerPasta('/a', listar);
  assert.deepEqual(r.arquivos.map((a) => a.relativo).sort(), ['a/espelho/y.txt', 'a/x.txt']);
});

test('`.` e `..` são ignorados', async () => {
  // Chegam em alguns servidores FTP, e segui-los é varrer o disco inteiro.
  const { listar } = servidorFalso({
    '/p': [dir('.'), dir('..'), arq('só-este.txt')],
  });
  const r = await varrerPasta('/p', listar);
  assert.deepEqual(r.arquivos.map((a) => a.relativo), ['p/só-este.txt']);
});

test('pasta vazia sobrevive ao zip', async () => {
  const { listar } = servidorFalso({
    '/proj': [dir('logs'), arq('a.txt')],
    '/proj/logs': [],
  });
  const r = await varrerPasta('/proj', listar);
  assert.deepEqual(r.pastasVazias, ['proj/logs/']);
});

test('arquivos demais é ERRO, e não corte silencioso', async () => {
  // Cortar entregaria um zip incompleto com cara de completo.
  const muitos = Array.from({ length: 12 }, (_, i) => arq(`f${i}.txt`, 1));
  const { listar } = servidorFalso({ '/x': muitos });
  await assert.rejects(
    () => varrerPasta('/x', listar, { limites: { maxArquivos: 10, maxBytes: 1e9 } }),
    /mais de 10 arquivos/
  );
});

test('bytes demais também é erro, com o número', async () => {
  const { listar } = servidorFalso({ '/x': [arq('gordo.bin', 5_000_000)] });
  await assert.rejects(
    () => varrerPasta('/x', listar, { limites: { maxArquivos: 100, maxBytes: 1_048_576 } }),
    /passa de 1 MB/
  );
});

test('cancelar interrompe a varredura', async () => {
  let voltas = 0;
  const { listar } = servidorFalso({
    '/a': [dir('b')],
    '/a/b': [dir('c')],
    '/a/b/c': [arq('fundo.txt')],
  });
  await assert.rejects(
    () =>
      varrerPasta('/a', listar, {
        cancelado: () => {
          voltas += 1;
          return voltas > 2;
        },
      }),
    /cancelado/
  );
});

test('o progresso avisa por pasta visitada', async () => {
  const vistos: string[] = [];
  const { listar } = servidorFalso({
    '/a': [dir('b'), arq('x.txt')],
    '/a/b': [arq('y.txt')],
  });
  await varrerPasta('/a', listar, { aoAndar: (_n, pasta) => vistos.push(pasta) });
  assert.deepEqual(vistos, ['/a', '/a/b']);
});

test('barra sobrando não duplica no caminho', async () => {
  assert.equal(juntar('/a/', 'b.txt'), '/a/b.txt');
  assert.equal(juntar('/a', 'b.txt'), '/a/b.txt');
});

test('os limites padrão são os que a memória do navegador aguenta', () => {
  // O zip inteiro é montado no navegador; estes números são o teto disso.
  assert.equal(LIMITES_PADRAO.maxArquivos, 2_000);
  assert.equal(LIMITES_PADRAO.maxBytes, 200 * 1024 * 1024);
});
