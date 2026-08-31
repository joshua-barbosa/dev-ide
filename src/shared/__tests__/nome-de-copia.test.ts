import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caminhoRenomeado, nomeDeCopia } from '../nome-de-copia';

const comOsNomes = (...nomes: string[]) => (c: string) => nomes.includes(c);
const vazio = () => false;

test('a primeira cópia não leva número', () => {
  assert.equal(nomeDeCopia('utils.ts', vazio), 'utils copy.ts');
});

test('a segunda leva o 2', () => {
  assert.equal(nomeDeCopia('utils.ts', comOsNomes('utils copy.ts')), 'utils copy 2.ts');
});

test('a numeração pula o que já existe', () => {
  const existe = comOsNomes('utils copy.ts', 'utils copy 2.ts', 'utils copy 3.ts');
  assert.equal(nomeDeCopia('utils.ts', existe), 'utils copy 4.ts');
});

test('copiar a cópia empilha, e não substitui', () => {
  assert.equal(nomeDeCopia('utils copy.ts', vazio), 'utils copy copy.ts');
});

test('a extensão fica no fim, e não no meio', () => {
  assert.equal(nomeDeCopia('relatorio.tar.gz', vazio), 'relatorio.tar copy.gz');
});

test('pasta sem extensão só ganha o sufixo', () => {
  assert.equal(nomeDeCopia('src', vazio), 'src copy');
});

test('arquivo oculto não perde o ponto que o define', () => {
  // `.env` → `env copy` seria um arquivo diferente, e visível.
  assert.equal(nomeDeCopia('.env', vazio), '.env copy');
  assert.equal(nomeDeCopia('.gitignore', vazio), '.gitignore copy');
});

test('oculto COM extensão continua oculto', () => {
  assert.equal(nomeDeCopia('.env.local', vazio), '.env copy.local');
});

// ---- o caminho depois do renomear ----

test('o próprio arquivo renomeado ganha o nome novo', () => {
  assert.equal(caminhoRenomeado('/p/a.ts', '/p/a.ts', '/p/b.ts'), '/p/b.ts');
});

test('o arquivo DENTRO da pasta renomeada acompanha', () => {
  assert.equal(caminhoRenomeado('/p/src/a.ts', '/p/src', '/p/lib'), '/p/lib/a.ts');
  assert.equal(caminhoRenomeado('/p/src/x/y.ts', '/p/src', '/p/lib'), '/p/lib/x/y.ts');
});

test('a pasta de nome PARECIDO não é afetada', () => {
  // `startsWith` sem a barra casaria `src2` ao renomear `src`.
  assert.equal(caminhoRenomeado('/p/src2/a.ts', '/p/src', '/p/lib'), null);
  assert.equal(caminhoRenomeado('/p/outro.ts', '/p/a.ts', '/p/b.ts'), null);
});
