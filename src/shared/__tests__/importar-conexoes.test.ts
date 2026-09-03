// Importar conexões do arquivo exportado (N001).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  identidade, lerArquivoDeConexoes, planoDeImportacao, resumoDoPlano,
  type ConexaoParaImportar, type Existente,
} from '../importar-conexoes';

const TIPOS = ['mysql', 'postgres', 'sqlite'];

const arquivo = (conexoes: unknown[]): string =>
  JSON.stringify({ exportadoEm: '2026-09-02T00:00:00Z', aviso: 'senhas', conexoes });

const uma = (over: Partial<ConexaoParaImportar> = {}): Record<string, unknown> => ({
  type: 'mysql', label: 'produção', group: 'ACME', readOnly: false,
  fields: { host: 'db', password: 'x' }, ...over,
});

// ---------------------------------------------------------------------------
// Ler o arquivo — é aqui que entra lixo no cofre
// ---------------------------------------------------------------------------

test('JSON quebrado é recusado com texto que se entende', () => {
  // "Unexpected token < in JSON" não diz a ninguém que ele escolheu um HTML.
  const r = lerArquivoDeConexoes('<html>', TIPOS);
  assert.match('erro' in r ? r.erro : '', /não é um JSON válido/);
});

test('JSON válido de OUTRA coisa é recusado, dizendo o que se esperava', () => {
  const r = lerArquivoDeConexoes('{"foo":1}', TIPOS);
  assert.match('erro' in r ? r.erro : '', /Exportar conexões COM as senhas/);
});

test('conexão sem label diz QUAL das conexões está errada', () => {
  const r = lerArquivoDeConexoes(arquivo([uma(), uma({ label: '' })]), TIPOS);
  assert.match('erro' in r ? r.erro : '', /#2/);
});

test('tipo desconhecido é PULADO, e o erro final diz qual era', () => {
  // Uma conexão de driver inexistente apareceria na árvore e falharia ao abrir,
  // sem ninguém entender por quê.
  const r = lerArquivoDeConexoes(arquivo([uma({ type: 'oracle' })]), TIPOS);
  assert.match('erro' in r ? r.erro : '', /oracle/);
});

test('o que é conhecido entra mesmo com um desconhecido no meio', () => {
  const r = lerArquivoDeConexoes(arquivo([uma(), uma({ type: 'oracle' })]), TIPOS);
  assert.equal('conexoes' in r ? r.conexoes.length : 0, 1);
});

test('espaço em volta do rótulo e do grupo é aparado', () => {
  const r = lerArquivoDeConexoes(arquivo([uma({ label: '  db  ', group: ' G ' })]), TIPOS);
  const c = 'conexoes' in r ? r.conexoes[0] : null;
  assert.equal(c?.label, 'db');
  assert.equal(c?.group, 'G');
});

test('readOnly só é verdadeiro quando é verdadeiro', () => {
  // Um `"readOnly": "false"` de um arquivo editado à mão não pode virar `true`.
  const r = lerArquivoDeConexoes(arquivo([uma({ readOnly: 'false' as never })]), TIPOS);
  assert.equal('conexoes' in r ? r.conexoes[0]?.readOnly : true, false);
});

// ---------------------------------------------------------------------------
// O plano, ANTES de tocar no cofre
// ---------------------------------------------------------------------------

const existentes: Existente[] = [{ id: 'abc', label: 'produção', group: 'ACME' }];
const entrando: ConexaoParaImportar[] = [
  { type: 'mysql', label: 'produção', group: 'ACME', readOnly: false, fields: {} },
  { type: 'mysql', label: 'nova', group: 'ACME', readOnly: false, fields: {} },
];

test('a identidade é grupo + rótulo, e não o id interno', () => {
  // O id é gerado no cofre de destino: a mesma conexão reimportada teria outro,
  // e nunca seria reconhecida como a mesma.
  assert.equal(identidade({ group: 'A', label: 'b' }), 'A/b');
});

test('o padrão NÃO apaga nada: repetida fica lado a lado', () => {
  const p = planoDeImportacao(existentes, entrando, 'manter-as-duas');
  assert.deepEqual(p.map((d) => d.acao), ['criar', 'criar']);
  assert.equal(p[0]?.idExistente, 'abc', 'mas o conflito é registrado, para a tela avisar');
});

test('substituir aponta QUAL conexão vai ser trocada', () => {
  const p = planoDeImportacao(existentes, entrando, 'substituir');
  assert.equal(p[0]?.acao, 'substituir');
  assert.equal(p[0]?.idExistente, 'abc');
  assert.equal(p[1]?.acao, 'criar');
});

test('pular deixa a existente intacta', () => {
  const p = planoDeImportacao(existentes, entrando, 'pular');
  assert.deepEqual(p.map((d) => d.acao), ['pular', 'criar']);
});

test('sem nada no cofre, tudo é novo', () => {
  const p = planoDeImportacao([], entrando, 'substituir');
  assert.deepEqual(p.map((d) => d.acao), ['criar', 'criar']);
});

test('o resumo separa NOVA de REPETIDA — são coisas diferentes na tela', () => {
  const r = resumoDoPlano(planoDeImportacao(existentes, entrando, 'manter-as-duas'));
  assert.match(r, /1 nova/);
  assert.match(r, /1 repetida/);
});

test('o resumo de substituição diz quantas somem', () => {
  assert.match(resumoDoPlano(planoDeImportacao(existentes, entrando, 'substituir')), /1 substituída/);
});
