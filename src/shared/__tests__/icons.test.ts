// Testes do mapa de ícones.
//
// O mapa é dado puro, então mora em `shared` e roda em node:test. A totalidade
// (todo NodeIcon tem ícone) é garantida pelo compilador, não por teste — o mapa
// é um `Record<NodeIcon | TabIcon, string>`. O que se testa aqui é o que o
// compilador não alcança: o comportamento diante de um nome vindo do servidor
// em tempo de execução.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ICONE_GENERICO,
  ICONES_USADOS,
  NODE_ICONS,
  TAB_ICONS,
  resolverIcone,
} from '../icons';

test('resolve os ícones da árvore', () => {
  assert.equal(resolverIcone('database'), 'lucide:database');
  assert.equal(resolverIcone('table'), 'lucide:table');
  assert.equal(resolverIcone('folder'), 'lucide:folder');
});

test('resolve os ícones de aba', () => {
  assert.equal(resolverIcone('terminal'), 'lucide:terminal');
  assert.equal(resolverIcone('grid'), 'lucide:table');
});

test('nome desconhecido devolve o genérico, não vazio', () => {
  // O servidor pode mandar um ícone que esta versão da interface não conhece —
  // um driver mais novo, por exemplo. Buraco na tela seria pior que um círculo.
  assert.equal(resolverIcone('inventado-pelo-driver'), ICONE_GENERICO);
  assert.equal(resolverIcone(''), ICONE_GENERICO);
});

test('todo ícone do contrato tem correspondente', () => {
  for (const nome of [...NODE_ICONS, ...TAB_ICONS]) {
    const icone = resolverIcone(nome);
    assert.notEqual(icone, ICONE_GENERICO, `"${nome}" caiu no genérico`);
    assert.match(icone, /^lucide:/, `"${nome}" não aponta para o conjunto lucide`);
  }
});

test('a lista para o empacotador cobre tudo que pode ser desenhado', () => {
  // É esta lista que o script de build usa para gerar o pacote offline. Se um
  // ícone usado ficar de fora dela, ele some da interface sem erro nenhum.
  for (const nome of [...NODE_ICONS, ...TAB_ICONS]) {
    assert.ok(
      ICONES_USADOS.includes(resolverIcone(nome)),
      `"${resolverIcone(nome)}" não entraria no pacote offline`
    );
  }
  assert.ok(ICONES_USADOS.includes(ICONE_GENERICO), 'o genérico precisa ser empacotado');
});

test('a lista do empacotador não tem repetição', () => {
  assert.equal(new Set(ICONES_USADOS).size, ICONES_USADOS.length);
});
