import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agruparPorSecao,
  camposParaEnviar,
  camposVisiveis,
  gruposExistentes,
  valoresIniciais,
  validar,
  SECAO_PRINCIPAL,
} from '../connections/form';
import type { FieldSpec, GroupNode, PublicConnection } from '../contracts';

const CAMPOS: readonly FieldSpec[] = [
  { name: 'host', label: 'Host', type: 'string', required: true, default: '127.0.0.1' },
  { name: 'port', label: 'Porta', type: 'number', required: true, default: 3306 },
  { name: 'password', label: 'Senha', type: 'password', secret: true },
  { name: 'hide_system', label: 'Esconder', type: 'boolean', default: true, section: 'Árvore' },
  { name: 'limite', label: 'Limite', type: 'number', default: 500, section: 'SQL' },
  {
    name: 'ssl_mode',
    label: 'SSL',
    type: 'select',
    default: 'DISABLED',
    section: 'TLS',
    options: [
      { value: 'DISABLED', label: 'sem TLS' },
      { value: 'REQUIRED', label: 'exige TLS' },
    ],
  },
];

const SALVA: PublicConnection = {
  id: 'abc',
  type: 'mysql',
  label: 'servidor-2',
  group: 'ACME/Bancos',
  readOnly: true,
  fields: { host: '10.0.0.9', port: 3307, hide_system: false },
  secretFields: ['password'],
};

// ---- valores iniciais (AC-6) ----

test('criar parte dos valores padrão declarados', () => {
  const valores = valoresIniciais(CAMPOS, null);
  assert.equal(valores.host, '127.0.0.1');
  // Número vira texto aqui de propósito: é o que um controle de formulário
  // segura. A conversão de volta acontece só no envio — ver `camposParaEnviar`.
  assert.equal(valores.port, '3306');
  assert.equal(valores.hide_system, true);
  assert.equal(valores.ssl_mode, 'DISABLED');
});

test('campo sem padrão nasce vazio, não indefinido', () => {
  // O controle precisa de valor desde o primeiro render, senão o React troca de
  // não-controlado para controlado no meio do caminho.
  assert.equal(valoresIniciais(CAMPOS, null).password, '');
});

test('editar parte dos valores salvos, caindo no padrão para o que falta', () => {
  const valores = valoresIniciais(CAMPOS, SALVA);
  assert.equal(valores.host, '10.0.0.9');
  assert.equal(valores.port, '3307');
  assert.equal(valores.hide_system, false, 'false salvo não pode virar o padrão true');
  assert.equal(valores.limite, '500', 'campo ausente cai no padrão');
});

test('o segredo nunca vem preenchido ao editar', () => {
  // A API não devolve segredo; o formulário não pode inventar um.
  assert.equal(valoresIniciais(CAMPOS, SALVA).password, '');
});

// ---- seções (AC-8) ----

test('campos sem seção vão para a principal, que vem primeiro', () => {
  const secoes = agruparPorSecao(CAMPOS);
  assert.equal(secoes[0]!.titulo, SECAO_PRINCIPAL);
  assert.deepEqual(secoes[0]!.campos.map((c) => c.name), ['host', 'port', 'password']);
});

test('as seções saem na ordem em que foram declaradas', () => {
  assert.deepEqual(
    agruparPorSecao(CAMPOS).map((s) => s.titulo),
    [SECAO_PRINCIPAL, 'Árvore', 'SQL', 'TLS']
  );
});

test('só a principal vem aberta', () => {
  const secoes = agruparPorSecao(CAMPOS);
  assert.deepEqual(secoes.map((s) => s.aberta), [true, false, false, false]);
});

test('driver sem nenhuma seção declarada dá uma seção só', () => {
  const simples: FieldSpec[] = [{ name: 'file', label: 'Arquivo', type: 'path', required: true }];
  const secoes = agruparPorSecao(simples);
  assert.equal(secoes.length, 1);
  assert.equal(secoes[0]!.titulo, SECAO_PRINCIPAL);
});

// ---- validação (AC-11) ----

test('formulário completo não acusa nada', () => {
  assert.deepEqual(validar(CAMPOS, valoresIniciais(CAMPOS, null)), {});
});

test('obrigatório vazio é acusado pelo nome do campo', () => {
  const erros = validar(CAMPOS, { ...valoresIniciais(CAMPOS, null), host: '' });
  assert.match(erros.host!, /obrigat/i);
  assert.equal(erros.port, undefined, 'não deve acusar quem está preenchido');
});

test('espaço em branco não conta como preenchido', () => {
  assert.match(validar(CAMPOS, { ...valoresIniciais(CAMPOS, null), host: '   ' }).host!, /obrigat/i);
});

test('número inválido é acusado', () => {
  for (const ruim of ['abc', '12ab', '']) {
    const erros = validar(CAMPOS, { ...valoresIniciais(CAMPOS, null), port: ruim });
    assert.ok(erros.port !== undefined, `deveria acusar: ${JSON.stringify(ruim)}`);
  }
});

test('número opcional vazio é aceito', () => {
  const erros = validar(CAMPOS, { ...valoresIniciais(CAMPOS, null), limite: '' });
  assert.equal(erros.limite, undefined);
});

test('seleção fora das opções é acusada', () => {
  const erros = validar(CAMPOS, { ...valoresIniciais(CAMPOS, null), ssl_mode: 'INVENTADO' });
  assert.match(erros.ssl_mode!, /opç/i);
});

test('senha vazia não é acusada — ela é opcional aqui', () => {
  assert.equal(validar(CAMPOS, valoresIniciais(CAMPOS, null)).password, undefined);
});

// ---- o que enviar (AC-14, AC-15) — o caso mais importante da spec ----

test('ao criar, envia o que foi digitado, inclusive o segredo', () => {
  const valores = { ...valoresIniciais(CAMPOS, null), password: 'p4ss' };
  assert.equal(camposParaEnviar(CAMPOS, valores).password, 'p4ss');
});

test('ao editar sem tocar na senha, o campo NÃO é enviado', () => {
  // É o que preserva o segredo guardado: o servidor só recifra o que recebe.
  const enviado = camposParaEnviar(CAMPOS, valoresIniciais(CAMPOS, SALVA));
  assert.equal('password' in enviado, false, 'senha em branco não pode ir na atualização');
  assert.equal(enviado.host, '10.0.0.9', 'os demais campos continuam indo');
});

test('ao editar com senha nova, o campo é enviado', () => {
  const valores = { ...valoresIniciais(CAMPOS, SALVA), password: 'nova-senha' };
  assert.equal(camposParaEnviar(CAMPOS, valores).password, 'nova-senha');
});

test('ao criar, segredo em branco também não é enviado', () => {
  const enviado = camposParaEnviar(CAMPOS, valoresIniciais(CAMPOS, null));
  assert.equal('password' in enviado, false);
});

test('número chega como número, não como texto', () => {
  const valores = { ...valoresIniciais(CAMPOS, null), port: '3308' };
  assert.equal(camposParaEnviar(CAMPOS, valores).port, 3308);
});

test('opcional em branco não é enviado como texto vazio', () => {
  const valores = { ...valoresIniciais(CAMPOS, null), limite: '' };
  assert.equal('limite' in camposParaEnviar(CAMPOS, valores), false);
});

// ---- grupos existentes (AC-16) ----

const ARVORE: GroupNode = {
  name: '',
  path: '',
  groups: [
    {
      name: 'ACME',
      path: 'ACME',
      groups: [
        { name: 'Bancos', path: 'ACME/Bancos', groups: [], connections: [SALVA] },
        { name: 'Servidores', path: 'ACME/Servidores', groups: [], connections: [] },
      ],
      connections: [],
    },
    { name: 'Pessoal', path: 'Pessoal', groups: [], connections: [] },
  ],
  connections: [],
};

test('extrai todos os caminhos de grupo, ordenados e sem repetir', () => {
  assert.deepEqual(gruposExistentes(ARVORE), [
    'ACME',
    'ACME/Bancos',
    'ACME/Servidores',
    'Pessoal',
  ]);
});

test('a raiz não vira um grupo vazio na lista', () => {
  assert.deepEqual(gruposExistentes({ name: '', path: '', groups: [], connections: [] }), []);
});

// ---------------------------------------------------------------------------
// Visibilidade condicional (spec 052, D20)
// ---------------------------------------------------------------------------

const AUTENTICACAO: readonly FieldSpec[] = [
  { name: 'host', label: 'Host', type: 'string', required: true },
  {
    name: 'auth', label: 'Auth', type: 'select', default: 'password',
    options: [
      { value: 'password', label: 'Senha' },
      { value: 'key', label: 'Chave' },
      { value: 'agent', label: 'Agente' },
    ],
  },
  {
    name: 'password', label: 'Senha', type: 'password', secret: true, required: true,
    showIf: { campo: 'auth', valores: ['password'] },
  },
  {
    name: 'key_path', label: 'Chave', type: 'path', required: true,
    showIf: { campo: 'auth', valores: ['key'] },
  },
  {
    name: 'passphrase', label: 'Passphrase', type: 'password', secret: true,
    showIf: { campo: 'auth', valores: ['key'] },
  },
];

test('só aparecem os campos que o valor corrente pede', () => {
  const nomes = (auth: string) =>
    camposVisiveis(AUTENTICACAO, { host: 'h', auth }).map((c) => c.name);

  assert.deepEqual(nomes('password'), ['host', 'auth', 'password']);
  assert.deepEqual(nomes('key'), ['host', 'auth', 'key_path', 'passphrase']);
  assert.deepEqual(nomes('agent'), ['host', 'auth']);
});

test('campo sem `showIf` aparece sempre', () => {
  const semCondicao: readonly FieldSpec[] = [{ name: 'host', label: 'Host', type: 'string' }];
  assert.equal(camposVisiveis(semCondicao, {}).length, 1);
});

test('campo obrigatório ESCONDIDO não bloqueia o formulário', () => {
  // `password` é obrigatório e está escondido com `auth: 'key'`. Sem esta
  // regra, escolher autenticação por chave travaria o botão de salvar num
  // campo que a tela nem mostra — e o usuário não teria como adivinhar.
  const erros = validar(AUTENTICACAO, { host: 'h', auth: 'key', key_path: '/k' });
  assert.equal(erros.password, undefined);
  assert.equal(Object.keys(erros).length, 0);
});

test('campo obrigatório VISÍVEL continua bloqueando', () => {
  const erros = validar(AUTENTICACAO, { host: 'h', auth: 'password', password: '' });
  assert.equal(erros.password, 'Campo obrigatório.');
});

test('campo escondido NÃO é enviado, mesmo preenchido', () => {
  // Trocar de senha para chave tem que levar o segredo embora: guardar uma
  // senha cifrada para um modo de autenticação que não se usa é guardar risco
  // sem utilidade.
  const enviado = camposParaEnviar(AUTENTICACAO, {
    host: 'h', auth: 'key', password: 'ficou-de-antes', key_path: '/k',
  });
  assert.equal('password' in enviado, false);
  assert.equal(enviado.key_path, '/k');
});

test('o agrupamento por seção só recebe o que está visível', () => {
  const secoes = agruparPorSecao(camposVisiveis(AUTENTICACAO, { auth: 'agent' }));
  const principal = secoes.find((s) => s.titulo === SECAO_PRINCIPAL);
  assert.deepEqual(principal?.campos.map((c) => c.name), ['host', 'auth']);
});

test('condição que aponta para campo inexistente esconde, e não explode', () => {
  const torto: readonly FieldSpec[] = [
    { name: 'x', label: 'X', type: 'string', showIf: { campo: 'nao_existe', valores: ['a'] } },
  ];
  assert.deepEqual(camposVisiveis(torto, {}), []);
});

test('booleano na condição compara como TEXTO', () => {
  // O controle de um `boolean` guarda `true`/`false`, e a condição vem do
  // driver como texto — é o formato que atravessa JSON sem ambiguidade.
  const campos: readonly FieldSpec[] = [
    { name: 'tls', label: 'TLS', type: 'boolean', default: false },
    { name: 'ca', label: 'CA', type: 'path', showIf: { campo: 'tls', valores: ['true'] } },
  ];
  assert.deepEqual(camposVisiveis(campos, { tls: true }).map((c) => c.name), ['tls', 'ca']);
  assert.deepEqual(camposVisiveis(campos, { tls: false }).map((c) => c.name), ['tls']);
});

test('sugestão NÃO é lista fechada — só `select` recusa o que está fora', () => {
  // Achado no navegador: o campo da chave SSH oferece o que existe em `~/.ssh`
  // e recusava qualquer outro caminho digitado, que é exatamente o caso em que
  // ninguém adivinha (spec 052, D22).
  const comSugestao: readonly FieldSpec[] = [
    {
      name: 'chave', label: 'Chave', type: 'path',
      options: [{ value: '/home/eu/.ssh/id_ed25519', label: 'id_ed25519' }],
    },
    {
      name: 'auth', label: 'Auth', type: 'select',
      options: [{ value: 'key', label: 'Chave' }],
    },
  ];
  const erros = validar(comSugestao, { chave: '/outro/lugar/chave.pem', auth: 'key' });
  assert.equal(erros.chave, undefined);

  // O `select` continua fechado: ali a lista É a regra.
  assert.equal(validar(comSugestao, { auth: 'inventado' }).auth, 'Escolha uma das opções.');
});
