import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyGroupRename, buildGroupTree, normalizeGroupPath } from '../connections/groups';
import type { PublicConnection } from '../connections/types';

function conexao(label: string, group: string): PublicConnection {
  return {
    id: `id-${label}`,
    type: 'mysql',
    label,
    group,
    readOnly: false,
    fields: {},
    secretFields: [],
  };
}

// ---- normalização ----

test('normaliza caminho de grupo', () => {
  assert.equal(normalizeGroupPath('ACME/Bancos'), 'ACME/Bancos');
  assert.equal(normalizeGroupPath('/ACME/Bancos/'), 'ACME/Bancos');
  assert.equal(normalizeGroupPath('ACME//Bancos'), 'ACME/Bancos');
  assert.equal(normalizeGroupPath('  ACME / Bancos  '), 'ACME/Bancos');
  assert.equal(normalizeGroupPath(''), '');
  assert.equal(normalizeGroupPath('   '), '');
  assert.equal(normalizeGroupPath('///'), '');
});

// ---- montagem da árvore ----

test('conexões sem grupo ficam na raiz', () => {
  const arvore = buildGroupTree([conexao('local', ''), conexao('outro', '   ')]);
  assert.deepEqual(arvore.groups, []);
  assert.deepEqual(arvore.connections.map((c) => c.label), ['local', 'outro']);
});

test('agrupa por caminho simples', () => {
  const arvore = buildGroupTree([conexao('servidor-2', 'ACME'), conexao('redis', 'Hostinger')]);
  assert.deepEqual(arvore.groups.map((g) => g.name), ['ACME', 'Hostinger']);
  assert.deepEqual(arvore.groups[0].connections.map((c) => c.label), ['servidor-2']);
  assert.deepEqual(arvore.connections, []);
});

test('aninha subgrupos e preenche o caminho completo', () => {
  const arvore = buildGroupTree([
    conexao('servidor-2', 'ACME/Bancos'),
    conexao('fila', 'ACME/Servidores'),
  ]);

  const grupo = arvore.groups[0];
  assert.equal(grupo.name, 'ACME');
  assert.equal(grupo.path, 'ACME');
  assert.deepEqual(grupo.groups.map((g) => g.name), ['Bancos', 'Servidores']);
  assert.equal(grupo.groups[0].path, 'ACME/Bancos');
  assert.deepEqual(grupo.connections, [], 'ACME não tem conexão própria');
});

test('cria grupos intermediários que não têm conexão própria', () => {
  const arvore = buildGroupTree([conexao('prod', 'ACME/Bancos/Produção')]);
  const bancos = arvore.groups[0].groups[0];
  assert.equal(bancos.path, 'ACME/Bancos');
  assert.deepEqual(bancos.connections, []);
  assert.deepEqual(bancos.groups[0].connections.map((c) => c.label), ['prod']);
});

test('ordena pastas antes de conexões, cada bloco em ordem alfabética', () => {
  const arvore = buildGroupTree([
    conexao('zulu', ''),
    conexao('alpha', ''),
    conexao('x', 'Zeta'),
    conexao('y', 'Alfa'),
  ]);
  assert.deepEqual(arvore.groups.map((g) => g.name), ['Alfa', 'Zeta']);
  assert.deepEqual(arvore.connections.map((c) => c.label), ['alpha', 'zulu']);
});

test('conexões do mesmo grupo saem ordenadas por label', () => {
  const arvore = buildGroupTree([
    conexao('servidor-4', 'ACME'),
    conexao('servidor-3', 'ACME'),
    conexao('servidor-2', 'ACME'),
  ]);
  assert.deepEqual(
    arvore.groups[0].connections.map((c) => c.label),
    ['servidor-2', 'servidor-3', 'servidor-4']
  );
});

test('trata caminhos equivalentes como o mesmo grupo', () => {
  const arvore = buildGroupTree([conexao('a', 'ACME/Bancos'), conexao('b', '/ACME//Bancos/')]);
  assert.equal(arvore.groups.length, 1);
  assert.equal(arvore.groups[0].groups.length, 1);
  assert.deepEqual(arvore.groups[0].groups[0].connections.map((c) => c.label), ['a', 'b']);
});

// ---- renomear grupo ----

test('renomear um grupo reescreve o prefixo dos descendentes', () => {
  assert.equal(applyGroupRename('ACME', 'ACME', 'ACME SA'), 'ACME SA');
  assert.equal(applyGroupRename('ACME/Bancos', 'ACME', 'ACME SA'), 'ACME SA/Bancos');
  assert.equal(applyGroupRename('ACME/Bancos/Prod', 'ACME/Bancos', 'ACME/DB'), 'ACME/DB/Prod');
});

test('renomear não afeta grupos que apenas começam com o mesmo texto', () => {
  assert.equal(applyGroupRename('ACMEX', 'ACME', 'ACME SA'), 'ACMEX');
  assert.equal(applyGroupRename('ACMEX/Sub', 'ACME', 'ACME SA'), 'ACMEX/Sub');
  assert.equal(applyGroupRename('Outro/ACME', 'ACME', 'ACME SA'), 'Outro/ACME');
});
