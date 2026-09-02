// O diagrama ER (T064, spec 069).
//
// O que erra na prática é o NOME: o Mermaid só aceita `[A-Za-z0-9_]` em
// entidade, e um nome com hífen derruba o diagrama INTEIRO — por uma tabela.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  documentoDoDiagrama,
  mermaidDoDiagrama,
  nomeDeEntidade,
  vizinhanca,
  type DiagramaER,
} from '../sql/diagrama-er';

const BASE: DiagramaER = {
  titulo: 'escola.public',
  tabelas: [
    { nome: 'alunos', colunas: [{ nome: 'id', tipo: 'bigint', chave: true }] },
    {
      nome: 'notas',
      colunas: [
        { nome: 'id', tipo: 'bigint', chave: true },
        { nome: 'aluno_id', tipo: 'bigint', chave: false },
      ],
    },
  ],
  relacoes: [{ de: 'notas', para: 'alunos', coluna: 'aluno_id', obrigatoria: false }],
  cortadas: 0,
};

test('nome que o Mermaid não aceita é trocado, não derruba o diagrama', () => {
  assert.equal(nomeDeEntidade('minha-tabela'), 'minha_tabela');
  assert.equal(nomeDeEntidade('endereços'), 'endere_os');
  assert.equal(nomeDeEntidade('tabela com espaço'), 'tabela_com_espa_o');
  // Identificador não pode começar com dígito.
  assert.equal(nomeDeEntidade('2024_vendas'), 't_2024_vendas');
});

test('o Mermaid tem as entidades, os atributos e a relação', () => {
  const m = mermaidDoDiagrama(BASE);
  assert.match(m, /^erDiagram/);
  assert.match(m, /notas \}o--\|\| alunos : "aluno_id"/);
  assert.match(m, /bigint id PK/);
});

test('coluna NOT NULL vira cardinalidade obrigatória', () => {
  const m = mermaidDoDiagrama({
    ...BASE,
    relacoes: [{ de: 'notas', para: 'alunos', coluna: 'aluno_id', obrigatoria: true }],
  });
  assert.match(m, /notas \}\|--\|\| alunos/);
});

test('tabela SEM relação aparece assim mesmo', () => {
  // Sumir com ela faria o diagrama mentir sobre o que existe no schema.
  const m = mermaidDoDiagrama({ ...BASE, relacoes: [] });
  assert.match(m, /alunos \{/);
  assert.match(m, /notas \{/);
});

test('o corte é DITO, e não silencioso', () => {
  const doc = documentoDoDiagrama({ ...BASE, cortadas: 158 });
  assert.match(doc, /158 tabela\(s\) ficaram de fora/);
  // E diz que o teto é do NAVEGADOR, não de leitura: quem lê usa o zoom.
  assert.match(doc, /navegador não travar/);
});

test('o documento ensina a ler o diagrama', () => {
  // Sem isto ele perguntou "como que eu iria dar zoom na tela?" — e a resposta
  // não pode estar só na cabeça de quem escreveu.
  assert.match(documentoDoDiagrama(BASE), /Ctrl \+ roda/);
  assert.match(documentoDoDiagrama(BASE), /roda\*\* navega/);
});

test('schema vazio diz que está vazio, em vez de um bloco em branco', () => {
  const doc = documentoDoDiagrama({ ...BASE, tabelas: [], relacoes: [] });
  assert.match(doc, /Não há tabela neste schema/);
  assert.equal(doc.includes('```mermaid'), false);
});

test('sem chave estrangeira o documento explica por que está solto', () => {
  const doc = documentoDoDiagrama({ ...BASE, relacoes: [] });
  assert.match(doc, /Nenhuma chave estrangeira declarada/);
  assert.match(doc, /```mermaid/);
});

// ---------------------------------------------------------------------------
// A vizinhança de UMA tabela (P4)
// ---------------------------------------------------------------------------

const TEIA: DiagramaER = {
  titulo: 'loja',
  tabelas: [
    { nome: 'pedidos', colunas: [] },
    { nome: 'clientes', colunas: [] },
    { nome: 'itens', colunas: [] },
    { nome: 'produtos', colunas: [] },
    { nome: 'longe', colunas: [] },
  ],
  relacoes: [
    { de: 'pedidos', para: 'clientes', coluna: 'cliente_id', obrigatoria: true },
    { de: 'itens', para: 'pedidos', coluna: 'pedido_id', obrigatoria: true },
    { de: 'itens', para: 'produtos', coluna: 'produto_id', obrigatoria: true },
  ],
  cortadas: 0,
};

test('vizinho é quem se liga nos DOIS sentidos', () => {
  // `pedidos` referencia `clientes` E é referenciada por `itens`. Pegar só um
  // dos lados daria meia resposta — e o lado errado com igual probabilidade.
  const v = vizinhanca(TEIA, 'pedidos');
  assert.deepEqual(
    v.tabelas.map((t) => t.nome).sort(),
    ['clientes', 'itens', 'pedidos']
  );
});

test('a tabela sem ligação nenhuma aparece sozinha, e não vazia', () => {
  const v = vizinhanca(TEIA, 'longe');
  assert.deepEqual(v.tabelas.map((t) => t.nome), ['longe']);
  assert.equal(v.relacoes.length, 0);
  assert.equal(v.cortadas, 4);
});

test('seta com uma ponta de fora NÃO entra — apontaria para o nada', () => {
  const v = vizinhanca(TEIA, 'clientes');
  assert.deepEqual(v.tabelas.map((t) => t.nome).sort(), ['clientes', 'pedidos']);
  // `itens → pedidos` fica de fora: `itens` não está desenhada.
  assert.deepEqual(v.relacoes.map((r) => `${r.de}->${r.para}`), ['pedidos->clientes']);
});

test('grau 2 alcança o vizinho do vizinho', () => {
  const v = vizinhanca(TEIA, 'clientes', 2);
  assert.deepEqual(
    v.tabelas.map((t) => t.nome).sort(),
    ['clientes', 'itens', 'pedidos']
  );
});

test('grau 1 NÃO alcança o vizinho do vizinho — a fronteira é fotografada antes', () => {
  // Sem a foto, um vizinho recém-entrado traria os dele na mesma volta e o
  // `grau` não significaria nada.
  const v = vizinhanca(TEIA, 'clientes', 1);
  assert.equal(v.tabelas.some((t) => t.nome === 'itens'), false);
});

test('grau 0 é tratado como 1: nunca devolve o diagrama vazio de relações', () => {
  const v = vizinhanca(TEIA, 'pedidos', 0);
  assert.equal(v.tabelas.length, 3);
});

test('o título diz de qual tabela é', () => {
  assert.equal(vizinhanca(TEIA, 'pedidos').titulo, 'pedidos e vizinhos');
});

test('a vizinhança vira Mermaid como qualquer diagrama', () => {
  const texto = mermaidDoDiagrama(vizinhanca(TEIA, 'pedidos'));
  assert.match(texto, /erDiagram/);
  assert.match(texto, /pedidos/);
  assert.equal(/produtos/.test(texto), false, 'produtos não é vizinha de pedidos');
});
