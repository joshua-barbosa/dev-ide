// O que sugerir, e onde (T053, spec 071).
//
// A leitura do catálogo é dos drivers e o desenho é do Monaco. O que erra na
// prática é a DECISÃO — e é ela que dá para testar sem banco e sem tela.
import test from 'node:test';
import assert from 'node:assert/strict';

import { apelidos, lerContexto, sugestoes, type Codebase } from '../sql/codebase';

const BASE: Codebase = {
  database: 'escola',
  lidoEm: 1,
  cortado: false,
  funcoes: ['now', 'coalesce'],
  objetos: [
    {
      nome: 'alunos',
      especie: 'tabela',
      schema: 'public',
      colunas: [
        { nome: 'id', tipo: 'bigint' },
        { nome: 'nome', tipo: 'text' },
      ],
    },
    {
      nome: 'notas',
      especie: 'tabela',
      schema: 'public',
      colunas: [
        { nome: 'id', tipo: 'bigint' },
        { nome: 'valor', tipo: 'numeric' },
      ],
    },
    { nome: 'v_media', especie: 'view', schema: 'public', colunas: [{ nome: 'media', tipo: 'numeric' }] },
    { nome: 'sp_recalcula', especie: 'procedure', schema: 'public', colunas: [] },
  ],
};

const textos = (s: readonly { texto: string }[]): string[] => s.map((x) => x.texto);

test('depois de FROM vêm as TABELAS, e não as colunas', () => {
  const r = sugestoes(BASE, 'SELECT * FROM ');
  assert.deepEqual(textos(r).slice(0, 3), ['alunos', 'notas', 'v_media']);
  assert.equal(r.some((x) => x.genero === 'coluna'), false);
});

test('`alvo.` oferece SÓ as colunas daquele alvo', () => {
  const r = sugestoes(BASE, 'SELECT alunos.', 'SELECT alunos. FROM alunos');
  assert.deepEqual(textos(r), ['id', 'nome']);
});

test('o apelido também vale — e ele costuma vir DEPOIS do cursor', () => {
  // `SELECT a.| FROM alunos a`: lendo só o prefixo, `a.` não sugeriria nada
  // justamente no caso mais comum de todos.
  const r = sugestoes(BASE, 'SELECT a.', 'SELECT a. FROM alunos a');
  assert.deepEqual(textos(r), ['id', 'nome']);

  const inteiro = 'SELECT n.x FROM alunos a JOIN notas AS n ON n.id = a.id WHERE n.';
  assert.deepEqual(textos(sugestoes(BASE, inteiro, inteiro)), ['id', 'valor']);
});

test('palavra-chave depois da tabela NÃO vira apelido', () => {
  // `FROM alunos WHERE` — sem esta regra, `WHERE` viraria apelido de `alunos`,
  // e `where.` passaria a sugerir colunas. É o erro clássico deste código.
  const mapa = apelidos('SELECT * FROM alunos WHERE id = 1');
  assert.equal(mapa.has('where'), false);
  assert.equal(mapa.size, 0);
});

test('sem qualificador, a coluna das tabelas CITADAS vem primeiro', () => {
  const r = sugestoes(BASE, 'SELECT ', 'SELECT  FROM alunos a');
  // As de `alunos`, e não as de `notas`: só quem está no texto interessa.
  assert.deepEqual(textos(r).slice(0, 2), ['id', 'nome']);
  assert.equal(r.some((x) => x.texto === 'valor'), false);
});

test('coluna de mesmo nome em duas tabelas aparece UMA vez', () => {
  const r = sugestoes(BASE, 'SELECT ', 'SELECT  FROM alunos a JOIN notas n ON 1=1');
  assert.equal(textos(r).filter((t) => t === 'id').length, 1);
});

test('função do banco e palavra da linguagem vêm no fim', () => {
  const r = sugestoes(BASE, 'SELECT ');
  const generos = r.map((x) => x.genero);
  assert.ok(generos.indexOf('funcao') < generos.indexOf('palavra'));
  assert.ok(generos.indexOf('objeto') < generos.indexOf('funcao'));
});

test('o contexto é lido de TRÁS para frente, e para na primeira estrutural', () => {
  assert.deepEqual(lerContexto('SELECT * FROM '), { qualificador: null, depoisDe: 'FROM' });
  assert.deepEqual(lerContexto('SELECT * FROM t WHERE '), { qualificador: null, depoisDe: 'WHERE' });
  assert.equal(lerContexto('SELECT a.').qualificador, 'a');
  assert.equal(lerContexto('SELECT a.no').qualificador, 'a');
});

test('catálogo vazio não quebra, e ainda oferece as palavras da linguagem', () => {
  const vazio: Codebase = { ...BASE, objetos: [], funcoes: [] };
  const r = sugestoes(vazio, 'SELECT ');
  assert.ok(r.length > 0);
  assert.equal(r.every((x) => x.genero === 'palavra'), true);
  assert.deepEqual(sugestoes(vazio, 'SELECT * FROM '), []);
});
