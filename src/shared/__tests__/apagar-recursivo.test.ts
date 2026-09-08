// Apagar uma PASTA com coisas dentro.
//
// Ele, em 08/09/2026: *"Eu cliquei com o botão direito na pasta, e fui em
// deletar a pasta, deu Failure"*.
//
// `Failure` é o que o SFTP responde ao `rmdir` de uma pasta que não está
// vazia — e o driver chamava `rmdir` direto. Pior: a confirmação da IDE
// PROMETE o contrário ("a pasta e tudo que está dentro dela vão junto"),
// então a tela dizia uma coisa e o servidor fazia outra.
//
// A ordem de apagar é lógica pura, e é o que se prova aqui: sem ela, apagar
// "de cima para baixo" recria o mesmo `Failure` mais fundo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ordemDeApagar, type NoParaApagar, type PassoDeApagar,
} from '../arquivos/apagar-recursivo';

/** Uma árvore inventada: `projeto/` com um arquivo e uma subpasta com outro. */
const ARVORE: Readonly<Record<string, readonly NoParaApagar[]>> = {
  '/raiz/projeto': [
    { nome: 'raiz.txt', pasta: false },
    { nome: 'dentro', pasta: true },
  ],
  '/raiz/projeto/dentro': [{ nome: 'fundo.txt', pasta: false }],
};

const listar = async (caminho: string): Promise<readonly NoParaApagar[]> =>
  ARVORE[caminho] ?? [];

test('arquivo solto: uma só remoção, e não é de pasta', async () => {
  const passos = await ordemDeApagar('/raiz/solto.txt', false, listar);
  assert.deepEqual(passos, [{ caminho: '/raiz/solto.txt', pasta: false }]);
});

test('a pasta sai POR ÚLTIMO, e o que está dentro dela antes', async () => {
  // De cima para baixo, o `rmdir` da raiz falharia — é o "Failure" dele.
  const passos = await ordemDeApagar('/raiz/projeto', true, listar);
  const caminhos = passos.map((p: PassoDeApagar) => p.caminho);
  assert.equal(caminhos[caminhos.length - 1], '/raiz/projeto');
  assert.ok(
    caminhos.indexOf('/raiz/projeto/dentro/fundo.txt') < caminhos.indexOf('/raiz/projeto/dentro'),
    'o arquivo de dentro tem de sair antes da pasta que o contém'
  );
});

test('cada passo diz se é pasta — o SFTP tem chamadas diferentes', async () => {
  const passos = await ordemDeApagar('/raiz/projeto', true, listar);
  const pastas = passos.filter((p: PassoDeApagar) => p.pasta).map((p: PassoDeApagar) => p.caminho);
  assert.deepEqual(pastas, ['/raiz/projeto/dentro', '/raiz/projeto']);
});

test('tudo que existe entra na lista, e nada duas vezes', async () => {
  const passos = await ordemDeApagar('/raiz/projeto', true, listar);
  assert.deepEqual(
    [...passos.map((p: PassoDeApagar) => p.caminho)].sort(),
    [
      '/raiz/projeto',
      '/raiz/projeto/dentro',
      '/raiz/projeto/dentro/fundo.txt',
      '/raiz/projeto/raiz.txt',
    ]
  );
});

test('pasta vazia continua sendo um passo só', async () => {
  const passos = await ordemDeApagar('/raiz/vazia', true, listar);
  assert.deepEqual(passos, [{ caminho: '/raiz/vazia', pasta: true }]);
});

test('fundo demais é recusado, em vez de varrer para sempre', async () => {
  // Um link que aponta para o pai faria a varredura não terminar nunca. O
  // limite corta com mensagem, e não com a pilha estourada.
  const cicla = async (): Promise<readonly NoParaApagar[]> => [{ nome: 'de-novo', pasta: true }];
  await assert.rejects(() => ordemDeApagar('/raiz/ciclo', true, cicla), /níveis/);
});
