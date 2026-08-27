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
