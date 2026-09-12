// Onde a IDE guarda as coisas dela.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as path from 'node:path';
import { caminhoDoAmbiente, homeDeDados, pastaDeProjetos } from '../paths';

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

/**
 * A extensão instalada é o mesmo caso do `.asar`, por outro caminho.
 *
 * A pasta de uma extensão é APAGADA pelo editor a cada atualização. Sem esta
 * marca, os projetos dele nasceriam lá dentro e sumiriam na primeira versão
 * nova — calados, que é o pior jeito de perder trabalho.
 */
test('empacotada na extensão, os projetos vão para a casa de dados', () => {
  const r = pastaDeProjetos('/casa/.vscode/extensions/braytech.braytech-code-0.1.0', {
    BRAYTECH_EMPACOTADO: '1',
    DEV_IDE_HOME: '/casa/.dev-ide',
  });
  assert.equal(r, '/casa/.dev-ide/projects');
});

test('sem a marca, a raiz manda — é o modo de desenvolvimento dele', () => {
  const r = pastaDeProjetos('/casa/repo', { DEV_IDE_HOME: '/casa/.dev-ide' });
  assert.equal(r, '/casa/repo/projects');
});

// Variável DEFINIDA e VAZIA não é caminho. Com `??` ela passava, e o cofre ia
// para `vault.json` RELATIVO à pasta de onde o motor subiu — dentro do
// repositório, no teste em que isso apareceu. Na extensão, a pasta de onde o
// host sobe nem é do usuário.
test('DEV_IDE_HOME vazio cai no padrão, em vez de virar caminho relativo', () => {
  const r = homeDeDados({ DEV_IDE_HOME: '' });
  assert.ok(path.isAbsolute(r), `esperava caminho absoluto, veio "${r}"`);
  assert.ok(r.endsWith('.dev-ide'));
});

test('DEV_IDE_HOME só com espaço também cai no padrão', () => {
  assert.ok(path.isAbsolute(homeDeDados({ DEV_IDE_HOME: '   ' })));
});

test('caminhoDoAmbiente: vazio e ausente dão o padrão; preenchido vale', () => {
  assert.equal(caminhoDoAmbiente(undefined, '/padrao'), '/padrao');
  assert.equal(caminhoDoAmbiente('', '/padrao'), '/padrao');
  assert.equal(caminhoDoAmbiente('  ', '/padrao'), '/padrao');
  assert.equal(caminhoDoAmbiente('/meu/cofre.json', '/padrao'), '/meu/cofre.json');
});
