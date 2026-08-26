// Que aba um arquivo do disco vira (T027 · spec 024).
//
// Este módulo saiu do `useWorkspace` quando ele passou do teto de 800 linhas do
// Artigo IV — e sair melhorou: a decisão passou a ser testável sem React e sem
// servidor, com o leitor injetado.
import assert from 'node:assert/strict';
import test from 'node:test';
import { montarAbaDeArquivo } from '../editor/abaDeArquivo';

const ler = async (caminho: string) => ({ path: caminho, content: 'conteúdo lido' });
const idioma = (caminho: string): string =>
  caminho.endsWith('.sql') ? 'sql' : caminho.endsWith('.ts') ? 'typescript' : 'plain';

test('arquivo de texto vira aba de editor, com o conteúdo lido', async () => {
  const { aba, leu } = await montarAbaDeArquivo('/x/a.ts', ler, idioma);
  assert.equal(aba.type, 'editor');
  assert.equal(leu, true);
  assert.equal((aba.meta as { content: string }).content, 'conteúdo lido');
});

test('`.sql` vira aba de SQL — ela tem o `▷` na barra', async () => {
  assert.equal((await montarAbaDeArquivo('/x/a.sql', ler, idioma)).aba.type, 'sql');
});

test('`.sqlbook` vira CADERNO, e não texto para o Monaco', async () => {
  const { aba } = await montarAbaDeArquivo('/x/a.sqlbook', ler, idioma);
  assert.equal(aba.type, 'caderno');
});

test('imagem NÃO é lida do disco — bytes decodificados como UTF-8 viram lixo', async () => {
  let leituras = 0;
  const contando = async (c: string) => {
    leituras += 1;
    return { path: c, content: '' };
  };
  const { aba, leu } = await montarAbaDeArquivo('/x/foto.png', contando, idioma);
  assert.equal(leu, false);
  assert.equal(leituras, 0);
  assert.equal(aba.type, 'visualizador');
  assert.equal((aba.meta as { visualizador: string }).visualizador, 'imagem');
});

test('PDF também não é lido', async () => {
  const { aba, leu } = await montarAbaDeArquivo('/x/manual.pdf', ler, idioma);
  assert.equal(leu, false);
  assert.equal((aba.meta as { visualizador: string }).visualizador, 'pdf');
});

test('CSV É lido: ele é texto, e `Ctrl+S` continua gravando', async () => {
  const { aba, leu } = await montarAbaDeArquivo('/x/dados.csv', ler, idioma);
  assert.equal(leu, true);
  assert.equal(aba.type, 'visualizador');
  // O `meta.content` segue sendo a verdade — é o que faz salvar funcionar.
  assert.equal((aba.meta as { content: string }).content, 'conteúdo lido');
});

test('o id é o caminho, para reabrir o mesmo arquivo focar a aba existente', async () => {
  assert.equal((await montarAbaDeArquivo('/x/a.ts', ler, idioma)).aba.id, 'file:/x/a.ts');
  assert.equal((await montarAbaDeArquivo('/x/f.png', ler, idioma)).aba.id, 'file:/x/f.png');
});
