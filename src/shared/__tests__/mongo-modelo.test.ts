// MongoDB numa grade de colunas fixas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  achatar, celula, colunasDaAmostra, COLUNA_CRUA, lerFiltro, linhasDosDocumentos,
  uriDoMongo,
} from '../sql/mongo-modelo';

test('objeto aninhado vira caminho com ponto', () => {
  assert.deepEqual(
    achatar({ nome: 'ana', endereco: { cidade: 'SP', cep: '01000' } }),
    { nome: 'ana', 'endereco.cidade': 'SP', 'endereco.cep': '01000' }
  );
});

test('ARRAY não é achatado item a item', () => {
  // Dez itens virariam dez colunas, e o documento seguinte, com três, deixaria
  // sete vazias — a grade viraria um campo minado.
  const r = achatar({ tags: ['a', 'b', 'c'] });
  assert.deepEqual(Object.keys(r), ['tags']);
  assert.deepEqual(r.tags, ['a', 'b', 'c']);
});

test('Date NÃO é aberto em campos internos', () => {
  const d = new Date('2026-09-03T12:00:00Z');
  assert.deepEqual(achatar({ criado: d }), { criado: d });
});

test('ObjectId e afins ficam inteiros: `_id.buffer.0` não diz nada a ninguém', () => {
  class ObjectId {
    toString(): string { return 'abc123'; }
  }
  const r = achatar({ _id: new ObjectId() });
  assert.deepEqual(Object.keys(r), ['_id']);
});

test('o achatamento tem fundo — não desce para sempre', () => {
  const fundo = { a: { b: { c: { d: { e: 1 } } } } };
  const chaves = Object.keys(achatar(fundo));
  assert.equal(chaves.length, 1);
  assert.ok(chaves[0]?.startsWith('a.b.c'), `parou em ${chaves[0]}`);
});

// ---------------------------------------------------------------------------
// As colunas
// ---------------------------------------------------------------------------

test('a ordem é a de APARIÇÃO, e não alfabética', () => {
  // O primeiro documento costuma ser o mais representativo, e alfabetar jogaria
  // o `_id` para o meio.
  const c = colunasDaAmostra([{ _id: 1, nome: 'ana', ativo: true }]);
  assert.deepEqual(c, ['_id', 'nome', 'ativo', COLUNA_CRUA]);
});

test('campo que só existe em UM documento ainda vira coluna', () => {
  // Esconder seria decidir por quem lê. Uma coluna quase vazia é informação:
  // diz que o campo é raro.
  const c = colunasDaAmostra([{ a: 1 }, { a: 2, raro: 'x' }]);
  assert.ok(c.includes('raro'));
});

test('a coluna do documento cru vem por último, sempre', () => {
  assert.equal(colunasDaAmostra([{ a: 1 }]).at(-1), COLUNA_CRUA);
});

// ---------------------------------------------------------------------------
// As linhas
// ---------------------------------------------------------------------------

test('campo ausente vira nulo, e não a palavra "undefined"', () => {
  const colunas = colunasDaAmostra([{ a: 1, b: 2 }]);
  const linhas = linhasDosDocumentos([{ a: 1 }], colunas);
  assert.equal(linhas[0]?.[colunas.indexOf('b')], null);
});

test('a coluna crua traz o documento INTEIRO, com o que foi achatado', () => {
  const colunas = colunasDaAmostra([{ a: { b: 1 } }]);
  const linha = linhasDosDocumentos([{ a: { b: 1 } }], colunas);
  assert.equal(linha[0]?.at(-1), '{"a":{"b":1}}');
});

test('valor objeto numa célula vira JSON, e não [object Object]', () => {
  assert.equal(celula({ x: 1 }), '{"x":1}');
  assert.equal(celula(null), null);
  assert.equal(celula(42), '42');
});

// ---------------------------------------------------------------------------
// O filtro
// ---------------------------------------------------------------------------

test('filtro vazio traz todos', () => {
  assert.deepEqual(lerFiltro('   '), { filtro: {} });
});

test('JSON quebrado é RECUSADO — não vira `{}`', () => {
  // Mandar tudo por causa de uma vírgula a mais devolveria a coleção inteira
  // sem ninguém pedir.
  const r = lerFiltro('{"status":}');
  assert.match('erro' in r ? r.erro : '', /precisa ser um JSON/);
});

test('lista ou valor solto não é filtro', () => {
  assert.match('erro' in lerFiltro('[1,2]') ? (lerFiltro('[1,2]') as { erro: string }).erro : '', /OBJETO/);
  assert.ok('erro' in lerFiltro('42'));
});

test('filtro válido passa como objeto', () => {
  assert.deepEqual(lerFiltro('{"status":"ativo"}'), { filtro: { status: 'ativo' } });
});

// ---------------------------------------------------------------------------
// As formas de conectar
// ---------------------------------------------------------------------------

const uriDe = (r: unknown): string => (r as { destino: { uri: string } }).destino?.uri ?? '';
const erroMongo = (r: unknown): string => (r as { erro?: string }).erro ?? '';

test('campos separados viram uma URI válida', () => {
  const r = uriDoMongo({ modo: 'campos', host: 'db', port: 27018, database: 'loja' });
  assert.equal(uriDe(r), 'mongodb://db:27018/');
});

test('usuário e senha vão codificados — senha com @ quebraria a URI', () => {
  const r = uriDoMongo({ modo: 'campos', host: 'db', username: 'ana', password: 'p@ss' });
  assert.match(uriDe(r), /mongodb:\/\/ana:p%40ss@db:27017\//);
});

test('authSource entra como opção, e é o que salva do "authentication failed"', () => {
  // Sem ele o Mongo procura o usuário no banco de destino e falha com uma
  // mensagem que faz qualquer um pensar que a senha está errada.
  const r = uriDoMongo({ modo: 'campos', host: 'db', username: 'a', auth_source: 'admin' });
  assert.match(uriDe(r), /authSource=admin/);
});

test('`mongodb+srv://` com porta é RECUSADO, dizendo por quê', () => {
  // O `+srv` faz o driver perguntar ao DNS quais servidores e portas usar; pôr
  // porta ali é erro de sintaxe, e a mensagem do driver fala de DNS.
  const r = uriDoMongo({ modo: 'uri', uri: 'mongodb+srv://user:p@cluster.net:27017/' });
  assert.match(erroMongo(r), /não aceita porta/);
});

test('`mongodb+srv://` sem porta passa', () => {
  const r = uriDoMongo({ modo: 'uri', uri: 'mongodb+srv://user:p@cluster.mongodb.net/' });
  assert.match(uriDe(r), /^mongodb\+srv:\/\//);
});

test('esquema que não é de Mongo é recusado', () => {
  assert.match(erroMongo(uriDoMongo({ modo: 'uri', uri: 'postgres://x' })), /mongodb:\/\//);
});

test('directConnection entra quando marcado — é o irmão do standalone', () => {
  const r = uriDoMongo({ modo: 'campos', host: 'db', direct: true });
  assert.match(uriDe(r), /directConnection=true/);
});

test('TLS e replicaSet entram como opções', () => {
  const r = uriDoMongo({ modo: 'campos', host: 'db', tls: true, replica_set: 'rs0' });
  assert.match(uriDe(r), /tls=true/);
  assert.match(uriDe(r), /replicaSet=rs0/);
});

test('host vazio no modo campos é recusado com instrução', () => {
  assert.match(erroMongo(uriDoMongo({ modo: 'campos', host: ' ' })), /modo URI/);
});
