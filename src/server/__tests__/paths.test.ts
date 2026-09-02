// Onde a IDE guarda as coisas dela.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pastaDeProjetos } from '../paths';

// ---------------------------------------------------------------------------
// A pasta de projetos, empacotada ou não (T094)
// ---------------------------------------------------------------------------

test('em desenvolvimento, os projetos ficam na raiz do repositório', () => {
  // Mudar isso moveria os projetos dele de lugar sem ninguém pedir.
  assert.equal(pastaDeProjetos('/casa/dev-ide', {}), '/casa/dev-ide/projects');
});

test('EMPACOTADA, os projetos saem do .asar — que é somente-leitura', () => {
  // Foi o primeiro defeito real da versão desktop: o servidor tentava `mkdir`
  // dentro do pacote, não subia, e o app abria uma caixa de erro e fechava.
  const r = pastaDeProjetos('/apps/dev-ide/resources/app.asar', { DEV_IDE_HOME: '/casa/.dev-ide' });
  assert.equal(r, '/casa/.dev-ide/projects');
  assert.equal(r.includes('.asar'), false, 'nada gravável dentro do pacote');
});

test('a variável de ambiente vence os dois casos', () => {
  assert.equal(
    pastaDeProjetos('/apps/x/app.asar', { DEV_IDE_PROJECTS: '/outro/lugar' }),
    '/outro/lugar'
  );
  assert.equal(
    pastaDeProjetos('/casa/dev-ide', { DEV_IDE_PROJECTS: '/outro/lugar' }),
    '/outro/lugar'
  );
});

test('variável VAZIA não conta como escolha', () => {
  // Uma variável exportada sem valor viraria `mkdir ''` — pior que ignorá-la.
  assert.equal(pastaDeProjetos('/casa/dev-ide', { DEV_IDE_PROJECTS: '' }), '/casa/dev-ide/projects');
});
