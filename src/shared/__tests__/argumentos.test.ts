// O caminho que veio pelo "Abrir com…".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aberturaPedida, caminhoParaAbrir, decodificarFileUrl, pastaDe, semBarraFinal,
} from '../../electron/argumentos';

test('empacotado: o primeiro argumento depois do binário é o caminho', () => {
  assert.equal(
    caminhoParaAbrir(['/apps/braytech-code', '/casa/projeto/arquivo.ts'], false),
    '/casa/projeto/arquivo.ts'
  );
});

test('em desenvolvimento, o SCRIPT do processo principal não é para abrir', () => {
  // `electron dist/electron/main.js /casa/x` — o `main.js` é o programa, e
  // abri-lo mostraria o próprio código da IDE em vez do arquivo dele.
  assert.equal(
    caminhoParaAbrir(['electron', 'dist/electron/main.js', '/casa/x'], true),
    '/casa/x'
  );
});

test('opções do Chromium são puladas', () => {
  // `--no-sandbox` está no atalho desta máquina, e viraria um caminho.
  assert.equal(
    caminhoParaAbrir(['/apps/bt', '--no-sandbox', '/casa/x'], false),
    '/casa/x'
  );
});

test('sem argumento nenhum, não há o que abrir', () => {
  assert.equal(caminhoParaAbrir(['/apps/bt'], false), null);
  assert.equal(caminhoParaAbrir(['/apps/bt', '--no-sandbox'], false), null);
});

test('file:// com espaço e acento vira o caminho de verdade', () => {
  // Sem decodificar, todo arquivo com espaço abriria como "não encontrado", e o
  // caminho na mensagem pareceria certo à primeira vista.
  assert.equal(
    caminhoParaAbrir(['/apps/bt', 'file:///casa/meu%20c%C3%B3digo.ts'], false),
    '/casa/meu código.ts'
  );
});

test('URL quebrada não vira caminho vazio silencioso', () => {
  assert.equal(decodificarFileUrl('file://%%%'), '');
  assert.equal(caminhoParaAbrir(['/apps/bt', 'file://%%%'], false), null);
});

test('o ponto sozinho não conta — é o "abrir aqui" do terminal', () => {
  assert.equal(caminhoParaAbrir(['/apps/bt', '.'], false), null);
});

// ---------------------------------------------------------------------------
// Pasta e arquivo pedem coisas diferentes
// ---------------------------------------------------------------------------

test('PASTA vira a raiz da árvore, e nenhum arquivo é aberto', () => {
  assert.deepEqual(aberturaPedida('/casa/projeto', true), { pasta: '/casa/projeto' });
});

test('ARQUIVO abre no editor, e a pasta que o contém vira a raiz', () => {
  // Abrir só o arquivo deixaria a árvore vazia ao lado dele — e quem clicou num
  // `.ts` no gerenciador quase sempre quer mexer no projeto.
  assert.deepEqual(aberturaPedida('/casa/projeto/main.ts', false), {
    pasta: '/casa/projeto',
    arquivo: '/casa/projeto/main.ts',
  });
});

test('a barra final da pasta não vira parte do nome', () => {
  assert.equal(aberturaPedida('/casa/projeto/', true).pasta, '/casa/projeto');
});

test('arquivo na raiz do sistema não gera pasta vazia', () => {
  assert.equal(aberturaPedida('/arquivo.txt', false).pasta, '/');
});

test('a raiz continua raiz', () => {
  assert.equal(semBarraFinal('/'), '/');
  assert.equal(pastaDe('/'), '/');
});
