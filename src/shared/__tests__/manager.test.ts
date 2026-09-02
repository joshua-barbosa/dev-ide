// A comparação de estruturas do `Structure Sync` (T070).
//
// Lógica pura, sem banco nenhum: o que se prova aqui é o que o comparador diz e
// — mais importante — **o que ele se recusa a gerar**.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compararEstruturas, nivelDaLinha,
  type ColunaDaEstrutura, type RetratoDaEstrutura, type TabelaDaEstrutura,
} from '../sql/manager';

const col = (
  nome: string,
  tipo = 'varchar(255)',
  extra: Partial<ColunaDaEstrutura> = {}
): ColunaDaEstrutura => ({ nome, tipo, aceitaNulo: true, padrao: null, ...extra });

const tab = (
  nome: string,
  colunas: readonly ColunaDaEstrutura[],
  indices: TabelaDaEstrutura['indices'] = []
): TabelaDaEstrutura => ({ nome, colunas, indices });

const retrato = (tabelas: readonly TabelaDaEstrutura[]): RetratoDaEstrutura =>
  ({ banco: 'teste', tabelas });

test('estruturas iguais não têm diferença', () => {
  const a = retrato([tab('clientes', [col('id', 'int'), col('email')])]);
  assert.deepEqual(compararEstruturas(a, a), []);
});

test('tabela que só existe na origem vira CREATE TABLE', () => {
  const d = compararEstruturas(
    retrato([tab('novos', [col('id', 'int', { aceitaNulo: false })])]),
    retrato([])
  );
  assert.equal(d.length, 1);
  assert.equal(d[0]?.lado, 'só na origem');
  assert.match(d[0]?.sql ?? '', /CREATE TABLE `novos`/);
  assert.match(d[0]?.sql ?? '', /`id` int NOT NULL/);
});

test('tabela que só existe no DESTINO aparece, mas NÃO gera DROP', () => {
  // Gerar `DROP TABLE` num comparador de estrutura é deixar uma arma
  // engatilhada em cima da mesa. A diferença aparece; o comando é dele.
  const d = compararEstruturas(retrato([]), retrato([tab('sobrando', [col('id')])]));
  assert.equal(d[0]?.lado, 'só no destino');
  assert.equal(d[0]?.sql, '', 'nada de DROP TABLE gerado');
});

test('coluna que falta no destino vira ADD COLUMN', () => {
  const d = compararEstruturas(
    retrato([tab('c', [col('id', 'int'), col('email')])]),
    retrato([tab('c', [col('id', 'int')])])
  );
  assert.equal(d.length, 1);
  assert.match(d[0]?.sql ?? '', /ALTER TABLE `c` ADD COLUMN `email` varchar\(255\)/);
});

test('coluna que sobra no destino NÃO gera DROP COLUMN', () => {
  // Apagar coluna apaga os dados dela.
  const d = compararEstruturas(
    retrato([tab('c', [col('id', 'int')])]),
    retrato([tab('c', [col('id', 'int'), col('legado')])])
  );
  assert.equal(d[0]?.lado, 'só no destino');
  assert.equal(d[0]?.sql, '');
});

test('tipo, nulo e padrão diferentes viram MODIFY, com o que mudou escrito', () => {
  const d = compararEstruturas(
    retrato([tab('c', [col('preco', 'decimal(10,2)', { aceitaNulo: false, padrao: '0' })])]),
    retrato([tab('c', [col('preco', 'float')])])
  );
  assert.equal(d[0]?.lado, 'diferente');
  assert.match(d[0]?.detalhe ?? '', /float → decimal\(10,2\)/);
  assert.match(d[0]?.detalhe ?? '', /deixa de aceitar nulo/);
  assert.match(d[0]?.detalhe ?? '', /padrão/);
  assert.match(d[0]?.sql ?? '', /MODIFY COLUMN `preco` decimal\(10,2\) NOT NULL DEFAULT 0/);
});

test('índice em ORDEM diferente é índice diferente', () => {
  // `(a, b)` e `(b, a)` servem a consultas diferentes; comparar como conjunto
  // esconderia a diferença que importa.
  const d = compararEstruturas(
    retrato([tab('c', [col('a'), col('b')], [{ nome: 'ix', colunas: ['a', 'b'], unico: false }])]),
    retrato([tab('c', [col('a'), col('b')], [{ nome: 'ix', colunas: ['b', 'a'], unico: false }])])
  );
  assert.equal(d[0]?.tipo, 'indice');
  // Índice não se altera: derruba e cria.
  assert.match(d[0]?.sql ?? '', /DROP INDEX `ix`[\s\S]*CREATE INDEX `ix`/);
});

test('índice que vira único conta como diferente', () => {
  const d = compararEstruturas(
    retrato([tab('c', [col('a')], [{ nome: 'ix', colunas: ['a'], unico: true }])]),
    retrato([tab('c', [col('a')], [{ nome: 'ix', colunas: ['a'], unico: false }])])
  );
  assert.match(d[0]?.sql ?? '', /CREATE UNIQUE INDEX/);
});

test('nome com crase não escapa da citação', () => {
  // Um nome com crase é legal no MySQL; sem o escape, ele fecharia a citação e
  // o resto do nome viraria comando.
  const d = compararEstruturas(
    retrato([tab('a`b', [col('x', 'int')])]),
    retrato([])
  );
  assert.match(d[0]?.sql ?? '', /CREATE TABLE `a``b`/);
});

// ---------------------------------------------------------------------------
// O nível de uma linha de log
// ---------------------------------------------------------------------------

test('a palavra decide o nível', () => {
  assert.equal(nivelDaLinha('2026-09-01 12:00:00 [ERROR] Table is full'), 'erro');
  assert.equal(nivelDaLinha('[Warning] Aborted connection'), 'aviso');
  assert.equal(nivelDaLinha('[Note] InnoDB: Buffer pool(s) load completed'), 'nota');
});

test('linha que não se reconhece NÃO vira nota', () => {
  // Chamar de nota o que pode ser erro é o defeito silencioso deste tipo de
  // classificador: some da tela justamente o que se estava procurando.
  assert.equal(nivelDaLinha('mysqld: ready for connections'), 'outro');
  assert.equal(nivelDaLinha(''), 'outro');
});
