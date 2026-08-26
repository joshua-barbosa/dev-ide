import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  APELIDO_DA_CONTAGEM,
  MAX_POR_PAGINA,
  montarConsultaDeTabela,
  normalizarPedidoDeTabela,
  PADRAO_POR_PAGINA,
  TAMANHOS_DE_PAGINA,
} from '../connections/drivers/tabela';

const COLUNAS = ['id', 'nome', 'nota'];
const base = { alvo: '`escola`.`alunos`', colunas: COLUNAS, estilo: 'backtick' as const };

const sqlDe = (pedido: Record<string, unknown>): string =>
  montarConsultaDeTabela(base, normalizarPedidoDeTabela(pedido, COLUNAS)).sql;

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

test('a primeira página não tem OFFSET', () => {
  const sql = sqlDe({ pagina: 1, porPagina: 50 });
  assert.match(sql, /LIMIT 50/);
  assert.equal(sql.includes('OFFSET'), false, 'OFFSET 0 é ruído');
});

test('a terceira página pula duas páginas', () => {
  assert.match(sqlDe({ pagina: 3, porPagina: 50 }), /LIMIT 50 OFFSET 100/);
});

test('página e tamanho fora de faixa são corrigidos, não recusados', () => {
  // Vem da tela; corrigir é mais útil que devolver erro.
  const p = normalizarPedidoDeTabela({ pagina: 0, porPagina: 0 }, COLUNAS);
  assert.equal(p.pagina, 1);
  assert.equal(p.porPagina > 0, true);
});

test('o teto de linhas por página é imposto mesmo se o cliente pedir mais', () => {
  const p = normalizarPedidoDeTabela({ pagina: 1, porPagina: 10_000_000 }, COLUNAS);
  assert.equal(p.porPagina, MAX_POR_PAGINA);
});

test('página absurda não vira OFFSET negativo', () => {
  const p = normalizarPedidoDeTabela({ pagina: -5, porPagina: 50 }, COLUNAS);
  assert.equal(p.pagina, 1);
});

// ---------------------------------------------------------------------------
// Ordenação
// ---------------------------------------------------------------------------

test('ordena pela coluna pedida, citada', () => {
  assert.match(sqlDe({ ordenar: { coluna: 'nome', desc: false } }), /ORDER BY `nome` ASC/);
  assert.match(sqlDe({ ordenar: { coluna: 'nome', desc: true } }), /ORDER BY `nome` DESC/);
});

test('sem ordenação não há ORDER BY', () => {
  assert.equal(sqlDe({}).includes('ORDER BY'), false);
});

test('coluna de ordenação que não existe é RECUSADA', () => {
  // O nome vem da tela. Aceitar aqui seria deixar o cliente escrever SQL.
  assert.throws(
    () => normalizarPedidoDeTabela({ ordenar: { coluna: 'id; DROP TABLE x', desc: false } }, COLUNAS),
    /coluna/i
  );
});

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

test('filtro de uma coluna vira LIKE com curinga dos dois lados', () => {
  const { sql, params } = montarConsultaDeTabela(
    base,
    normalizarPedidoDeTabela({ filtros: [{ coluna: 'nome', valor: 'jo' }] }, COLUNAS)
  );
  assert.match(sql, /WHERE `nome` LIKE \?/);
  assert.deepEqual(params, ['%jo%']);
});

test('o valor do filtro vai PARAMETRIZADO, nunca concatenado', () => {
  const { sql, params } = montarConsultaDeTabela(
    base,
    normalizarPedidoDeTabela({ filtros: [{ coluna: 'nome', valor: "'; DROP TABLE x --" }] }, COLUNAS)
  );
  assert.equal(sql.includes('DROP'), false, 'o valor não pode aparecer no SQL');
  assert.equal(params[0]?.includes('DROP'), true, 'ele vai como parâmetro');
});

test('curinga do LIKE dentro do valor é escapado', () => {
  // Procurar por `100%` não pode virar "qualquer coisa começando com 100".
  const { params } = montarConsultaDeTabela(
    base,
    normalizarPedidoDeTabela({ filtros: [{ coluna: 'nome', valor: '100%' }] }, COLUNAS)
  );
  assert.equal(params[0], '%100\\%%');
});

test('vários filtros se combinam com AND', () => {
  const { sql, params } = montarConsultaDeTabela(
    base,
    normalizarPedidoDeTabela(
      { filtros: [{ coluna: 'nome', valor: 'a' }, { coluna: 'nota', valor: '9' }] },
      COLUNAS
    )
  );
  assert.match(sql, /WHERE `nome` LIKE \? AND `nota` LIKE \?/);
  assert.equal(params.length, 2);
});

test('filtro vazio é ignorado, e não vira LIKE %%', () => {
  const p = normalizarPedidoDeTabela({ filtros: [{ coluna: 'nome', valor: '  ' }] }, COLUNAS);
  assert.deepEqual(p.filtros, []);
});

test('filtro em coluna inexistente é RECUSADO', () => {
  assert.throws(
    () => normalizarPedidoDeTabela({ filtros: [{ coluna: 'inventada', valor: 'x' }] }, COLUNAS),
    /coluna/i
  );
});

// ---------------------------------------------------------------------------
// A contagem
// ---------------------------------------------------------------------------

test('a contagem usa os MESMOS filtros da consulta, e nenhum LIMIT', () => {
  // Contar sem o filtro daria o total da tabela, e a paginação mentiria.
  const pedido = normalizarPedidoDeTabela(
    { pagina: 2, porPagina: 10, filtros: [{ coluna: 'nome', valor: 'a' }] },
    COLUNAS
  );
  const { contagem, params } = montarConsultaDeTabela(base, pedido);
  // Com APELIDO: sem ele o MySQL devolve a coluna chamada `COUNT(*)`, e quem
  // lê procura por outro nome — foi assim que o total veio `0` contra o banco
  // de verdade. O SQLite lia por posição e o PostgreSQL apelida sozinho, então
  // os dois disfarçaram.
  assert.match(contagem, new RegExp(`SELECT COUNT\\(\\*\\) AS ${APELIDO_DA_CONTAGEM}`));
  assert.match(contagem, /WHERE `nome` LIKE \?/);
  assert.equal(contagem.includes('LIMIT'), false);
  assert.equal(contagem.includes('ORDER BY'), false, 'ordenar para contar é desperdício');
  assert.deepEqual(params, ['%a%']);
});

// ---------------------------------------------------------------------------
// Estilo de citação
// ---------------------------------------------------------------------------

test('o estilo de citação acompanha o driver', () => {
  const { sql } = montarConsultaDeTabela(
    { alvo: '"public"."alunos"', colunas: COLUNAS, estilo: 'double' },
    normalizarPedidoDeTabela({ ordenar: { coluna: 'nome', desc: true } }, COLUNAS)
  );
  assert.match(sql, /ORDER BY "nome" DESC/);
  assert.equal(sql.includes('`'), false);
});

test('o PostgreSQL usa $1, e não ?', () => {
  const { sql, params } = montarConsultaDeTabela(
    { alvo: '"t"', colunas: COLUNAS, estilo: 'double', marcador: 'numerado' },
    normalizarPedidoDeTabela({ filtros: [{ coluna: 'nome', valor: 'a' }] }, COLUNAS)
  );
  assert.match(sql, /LIKE \$1/);
  assert.deepEqual(params, ['%a%']);
});

// ---------------------------------------------------------------------------
// Os dois lados precisam concordar
// ---------------------------------------------------------------------------

test('os tamanhos de página do servidor e da interface são os mesmos', () => {
  // A interface não compila `src/server`, então a lista existe duas vezes. Uma
  // divergência aqui seria um seletor oferecendo um valor que o servidor corta
  // em silêncio — o mesmo tipo de buraco que o teste de mapas de linguagem da
  // spec 024 fechou.
  // `__dirname` aponta para `dist/`; a fonte da interface não é compilada.
  const raiz = path.resolve(__dirname, '..', '..', '..');
  const fonte = fs.readFileSync(
    path.join(raiz, 'src', 'ui', 'tabela', 'useTabela.ts'),
    'utf8'
  );
  const casamento = /TAMANHOS_DE_PAGINA: readonly number\[\] = \[([^\]]*)\]/.exec(fonte);
  assert.notEqual(casamento, null, 'não achei a lista na interface');
  const daInterface = (casamento?.[1] ?? '').split(',').map((n) => Number(n.trim()));
  assert.deepEqual(daInterface, [...TAMANHOS_DE_PAGINA]);

  const padrao = /PADRAO_POR_PAGINA = (\d+)/.exec(fonte);
  assert.equal(Number(padrao?.[1]), PADRAO_POR_PAGINA);
});

test('todo tamanho oferecido cabe no teto do servidor', () => {
  for (const n of TAMANHOS_DE_PAGINA) {
    assert.equal(normalizarPedidoDeTabela({ porPagina: n }, COLUNAS).porPagina, n, String(n));
  }
});

// ---- Filtro com operadores (T057) ----
//
// Na spec 041 eu escrevi que "`contém` cobre o uso diário" e deixei o resto de
// fora. O valor NUNCA entra no SQL em nenhum destes caminhos — é o que estes
// testes guardam, junto com a semântica de cada operador.

const ALVO_FILTRO = {
  alvo: '`app`.`logs`',
  colunas: ['id', 'nome', 'criado_em'],
  estilo: 'backtick' as const,
  marcador: 'interrogacao' as const,
};

function ondeDe(valor: string) {
  const q = montarConsultaDeTabela(ALVO_FILTRO, {
    pagina: 1,
    porPagina: 10,
    ordenar: null,
    filtros: [{ coluna: 'id', valor }],
  });
  return { sql: q.sql, params: q.params };
}

test('`contém` continua sendo o padrão, com os curingas escapados', () => {
  const r = ondeDe('100%');
  assert.ok(r.sql.includes('`id` LIKE ?'));
  // `100%` é texto literal, e não "qualquer coisa começando com 100".
  assert.deepEqual(r.params, ['%100\\%%']);
});

test('maior, menor e igual viram o operador do SQL, com o valor como parâmetro', () => {
  assert.ok(ondeDe('>10').sql.includes('`id` > ?'));
  assert.deepEqual(ondeDe('>10').params, ['10']);
  assert.ok(ondeDe('<=10').sql.includes('`id` <= ?'));
  assert.ok(ondeDe('=10').sql.includes('`id` = ?'));
  assert.ok(ondeDe('!=10').sql.includes('`id` <> ?'));
});

test('nulo vira IS NULL, e não `= NULL`, que nunca casaria', () => {
  const r = ondeDe('null');
  assert.ok(r.sql.includes('`id` IS NULL'));
  // Sem parâmetro nenhum: não há valor a comparar.
  assert.deepEqual(r.params, []);
  assert.ok(ondeDe('!null').sql.includes('`id` IS NOT NULL'));
});

test('intervalo vira BETWEEN com dois parâmetros', () => {
  const r = ondeDe('1..5');
  assert.ok(r.sql.includes('`id` BETWEEN ? AND ?'));
  assert.deepEqual(r.params, ['1', '5']);
});

test('a contagem leva os MESMOS filtros — sem isso a paginação mentiria', () => {
  const q = montarConsultaDeTabela(ALVO_FILTRO, {
    pagina: 1, porPagina: 10, ordenar: null,
    filtros: [{ coluna: 'id', valor: '>10' }],
  });
  assert.ok(q.contagem.includes('`id` > ?'));
});

test('operador sem valor NÃO vira condição — e não devolve a tabela inteira calada', () => {
  const q = montarConsultaDeTabela(ALVO_FILTRO, {
    pagina: 1, porPagina: 10, ordenar: null,
    filtros: [{ coluna: 'id', valor: '>' }],
  });
  assert.ok(!q.sql.includes('WHERE'));
  assert.deepEqual(q.params, []);
});

test('o valor não escapa para o SQL nem tentando', () => {
  const r = ondeDe(">1 OR 1=1; DROP TABLE logs--");
  assert.ok(!r.sql.includes('DROP'));
  assert.deepEqual(r.params, ["1 OR 1=1; DROP TABLE logs--"]);
});

test('dois filtros com operadores diferentes numeram os parâmetros na ordem', () => {
  const q = montarConsultaDeTabela(
    { ...ALVO_FILTRO, estilo: 'double', marcador: 'numerado' },
    {
      pagina: 1, porPagina: 10, ordenar: null,
      filtros: [{ coluna: 'id', valor: '>10' }, { coluna: 'nome', valor: 'ana' }],
    }
  );
  assert.ok(q.sql.includes('"id" > $1'));
  assert.ok(q.sql.includes('"nome" LIKE $2'));
  assert.deepEqual(q.params, ['10', '%ana%']);
});
