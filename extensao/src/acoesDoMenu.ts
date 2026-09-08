// As ações de nó como itens do menu NATIVO.
//
// **Por que uma lista escrita aqui, se o driver já declara as ações.** O menu
// do editor é estático: o rótulo vive no `package.json` e não aceita texto
// decidido em tempo de execução. A alternativa seria um item "Ações…" que abre
// uma lista — e foi exatamente isso que ele derrubou em 04/09: *"menu de
// contexto virando lista de opções"*.
//
// Então o rótulo é declarado, e o que a ação FAZ continua sendo do driver: o
// comando só chama `POST /api/connections/:id/action` e usa a resposta. Nada
// de SQL escrito aqui — o Artigo III segue de pé.
//
// A lista pode envelhecer, e é o risco real deste caminho. Por isso o
// `conferir:extensao` percorre uma árvore de verdade e FALHA quando um driver
// declara uma ação sem item — em vez de ela sumir calada da tela dele.

/** Uma ação do driver que vira item de menu. */
export interface ItemDeAcao {
  readonly id: string;
  readonly rotulo: string;
  /**
   * O grupo do menu do editor. Ordena e separa com linha:
   * `1_abrir` (consulta), `2_copiar` (texto para colar), `3_alterar` (escrita).
   */
  readonly grupo: '1_abrir' | '2_copiar' | '3_alterar';
}

export const ACOES_DO_MENU: readonly ItemDeAcao[] = [
  // Abrir uma consulta
  { id: 'select', rotulo: 'Abrir consulta', grupo: '1_abrir' },
  { id: 'count', rotulo: 'Contar linhas (exato)', grupo: '1_abrir' },
  { id: 'ddl', rotulo: 'Ver DDL', grupo: '1_abrir' },
  { id: 'redis-buscar', rotulo: 'Abrir busca', grupo: '1_abrir' },
  { id: 'mongo-find', rotulo: 'Abrir consulta', grupo: '1_abrir' },
  { id: 'pinecone-buscar', rotulo: 'Abrir busca', grupo: '1_abrir' },
  { id: 'tables', rotulo: 'Tables', grupo: '1_abrir' },
  { id: 'views', rotulo: 'Views', grupo: '1_abrir' },
  { id: 'functions', rotulo: 'Functions', grupo: '1_abrir' },
  { id: 'procedures', rotulo: 'Procedures', grupo: '1_abrir' },
  { id: 'triggers', rotulo: 'Triggers', grupo: '1_abrir' },
  { id: 'sequences', rotulo: 'Sequences', grupo: '1_abrir' },
  { id: 'matviews', rotulo: 'Materialized Views', grupo: '1_abrir' },
  { id: 'types', rotulo: 'Types', grupo: '1_abrir' },
  { id: 'events', rotulo: 'Events', grupo: '1_abrir' },
  { id: 'foreign', rotulo: 'Foreign Tables', grupo: '1_abrir' },
  { id: 'indexes', rotulo: 'Indexes', grupo: '1_abrir' },
  { id: 'roles', rotulo: 'Roles', grupo: '1_abrir' },
  { id: 'users', rotulo: 'Users', grupo: '1_abrir' },
  // Texto para colar num `.sql` — vai para a área de transferência
  { id: 'copiar', rotulo: 'Copiar tabela', grupo: '2_copiar' },
  { id: 'template-select', rotulo: 'SELECT', grupo: '2_copiar' },
  { id: 'template-insert', rotulo: 'INSERT', grupo: '2_copiar' },
  { id: 'template-update', rotulo: 'UPDATE', grupo: '2_copiar' },
  { id: 'template-delete', rotulo: 'DELETE', grupo: '2_copiar' },
  { id: 'usuario-create', rotulo: 'Copiar SQL para criar usuário', grupo: '2_copiar' },
  { id: 'usuario-drop', rotulo: 'Copiar SQL para APAGAR', grupo: '2_copiar' },
  { id: 'usuario-grant', rotulo: 'Copiar SQL de GRANT', grupo: '2_copiar' },
  { id: 'usuario-revoke', rotulo: 'Copiar SQL de REVOKE', grupo: '2_copiar' },
  // Escrita. **Nenhuma executa por clique**: todas GERAM o SQL e o abrem, que é
  // a regra da spec 040 e continua valendo aqui.
  { id: 'truncate', rotulo: 'Esvaziar (TRUNCATE)', grupo: '3_alterar' },
  { id: 'esvaziar', rotulo: 'Esvaziar', grupo: '3_alterar' },
  { id: 'refresh-matview', rotulo: 'REFRESH', grupo: '3_alterar' },
  { id: 'drop', rotulo: 'Apagar (DROP)', grupo: '3_alterar' },
  { id: 'drop-view', rotulo: 'Apagar view (DROP)', grupo: '3_alterar' },
  { id: 'drop-matview', rotulo: 'Apagar (DROP)', grupo: '3_alterar' },
  { id: 'drop-sequence', rotulo: 'Apagar (DROP)', grupo: '3_alterar' },
  { id: 'drop-trigger', rotulo: 'Apagar (DROP)', grupo: '3_alterar' },
  { id: 'drop-event', rotulo: 'Apagar (DROP)', grupo: '3_alterar' },
];

/** O comando que o `package.json` declara para uma ação. */
export function comandoDaAcao(id: string): string {
  return `braytech.acao.${id}`;
}

/**
 * O `when` do item, casando com o `contextValue` que a árvore monta.
 *
 * Os colchetes delimitam de propósito: sem eles `drop` casaria em
 * `drop-view`, e o menu de uma view ganharia dois "Apagar".
 */
export function quandoDaAcao(id: string): string {
  const escapado = id.replace(/[-]/g, '\\-');
  return `viewItem =~ /\\[${escapado}\\]/`;
}
