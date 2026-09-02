// Os menus de contexto da árvore de conexões.
//
// Saíram do `App` quando o portão do Artigo IV o pegou em 806 linhas, ao ganhar
// as alterações de estrutura (spec 046). O corte é por assunto: os dois menus
// são a mesma coisa vista de dois lugares — botão direito num nó e numa conexão
// —, e nenhum deles interessa ao resto do `App`.
//
// A ação de menu GERA SQL e o ABRE; nada aqui executa. Ver a spec 040 para o
// porquê, e a 046 para o mesmo raciocínio aplicado ao `ALTER`.
import { Api } from '../api';
import type { EntradaMenu } from '../ContextMenu';
import type { PublicConnection, TreeNode } from '../../shared/contracts';

export interface MenusDeConexao {
  onMenuNo(
    e: React.MouseEvent,
    id: string,
    caminho: string[],
    no: TreeNode,
    database: string | null
  ): void;
  onMenuConexao(e: React.MouseEvent, conexao: PublicConnection): void;
}

export interface DepsDosMenus {
  abrir(e: React.MouseEvent, entradas: readonly EntradaMenu[]): void;
  copiar(texto: string): void;
  abrirQuery(
    id: string,
    titulo: string,
    conteudo: string,
    connectionId: string,
    database: string | null
  ): void;
  abrirFormulario(conexao: PublicConnection): void;
  excluir(conexao: PublicConnection): Promise<void>;
  abrirTerminalDaConexao(conexao: PublicConnection): Promise<void>;
  recarregarMetadados(id: string): Promise<void>;
  /** Abre a lista de processos do servidor (spec 047). */
  abrirProcessos(conexao: PublicConnection): void;
  /** As ações da árvore remota (spec 053). */
  readonly acoesRemotas: { menu(id: string, caminho: readonly string[], no: TreeNode): readonly unknown[] };
  /** Cria um arquivo na pasta `Query`, do tipo escolhido (spec 049). */
  novaQuery(connectionId: string, no: TreeNode, tipo: 'sql' | 'sqlbook'): Promise<void>;
  /** Desenha o diagrama ER daquele schema (T064). */
  diagramaEr(id: string, caminho: readonly string[], rotulo: string): Promise<void>;
  /** A sessão declarou que sabe desenhar o ER. Sem isso o item nem aparece. */
  sabeDesenharEr(id: string): boolean;
  estaAberta(id: string): boolean;
  desconectar(id: string): Promise<void>;
  abrirConexao(conexao: PublicConnection): Promise<void>;
  confirmar(opcoes: {
    readonly titulo?: string;
    readonly mensagem: string;
    readonly rotuloConfirmar?: string;
    readonly destrutivo?: boolean;
  }): Promise<boolean>;
}

export function useMenusDeConexao(deps: DepsDosMenus): MenusDeConexao {
  const { abrir: menuAbrir, copiar } = deps;
  return {
        onMenuNo: (e, id, caminho, no, database) => {
          // Nó da árvore REMOTA tem vocabulário próprio (spec 053): ali as
          // ações mexem no servidor, e não geram SQL.
          const remoto = deps.acoesRemotas.menu(id, caminho, no);
          if (remoto.length > 0) {
            menuAbrir(e, remoto as readonly EntradaMenu[]);
            return;
          }
          menuAbrir(e, [
            { label: 'Copiar nome', onClick: () => copiar(no.label) },

            // T064. Duas perguntas diferentes, e as duas precisam de resposta:
            // a SESSÃO diz se sabe desenhar, e o NÓ diz se é aqui. A primeira
            // versão desta condição adivinhava pela forma do `meta`, e errava
            // nos dois sentidos: aparecia em toda TABELA (elas também têm
            // `meta.schema`) e no database do PostgreSQL, onde não há um schema
            // só e o pedido falhava. Ele perguntou onde ficava o botão, e foi
            // assim que apareceu.
            ...(deps.sabeDesenharEr(id) && no.meta?.diagramaEr === true
              ? [
                  {
                    label: 'Diagrama ER',
                    onClick: () => deps.diagramaEr(id, caminho, no.label),
                  },
                ]
              : []),

            // P4: o diagrama do schema inteiro não responde "e esta aqui?".
            // *"assim eu consigo ver a tabela que estou olhando"* — 02/09/2026.
            // O caminho é o mesmo pedido, com a TABELA no fim; quem recorta é o
            // `vizinhanca`, no servidor.
            ...(deps.sabeDesenharEr(id) && no.meta?.diagramaDaTabela === true
              ? [
                  {
                    label: 'Diagrama desta tabela',
                    onClick: () => deps.diagramaEr(id, caminho, `${no.label} e vizinhos`),
                  },
                ]
              : []),

            // A categoria `Query` (spec 038) cria ARQUIVO, não objeto de banco.
            // As duas opções aparecem por extenso porque o `+` sozinho não diz
            // o que acrescenta — foi o que o usuário notou depois da spec 048.
            ...(no.meta?.queries === true
              ? [
                  null,
                  {
                    label: 'Nova query SQL…',
                    onClick: () => deps.novaQuery(id, no, 'sql'),
                  },
                  {
                    label: 'Novo Query Book…',
                    onClick: () => deps.novaQuery(id, no, 'sqlbook'),
                  },
                ]
              : []),

            ...(no.actions === undefined || no.actions.length === 0 ? [] : [null]),
            // Sem diálogo de confirmação, e de propósito (spec 040): uma
            // ação de menu GERA o SQL e o abre — nada é executado. O
            // diálogo que existia aqui afirmava "esta ação altera o
            // servidor", o que era falso. O `danger` continua, pintando o
            // item de vermelho, e o aviso de verdade vai no SQL gerado,
            // que é onde ele é lido. Rodar é o `▷ Run` da spec 038.
            ...(no.actions ?? []).map((acao) => ({
              label: acao.label,
              danger: acao.danger,
              onClick: async () => {
                const r = await Api.runAction(id, { nodePath: caminho, actionId: acao.id });
                if (acao.copiar === true) {
                  // Vai para o clipboard, e não para uma aba (P3): é texto para
                  // colar num `.sql` ou `.sqlbook` dele.
                  copiar(r.content);
                  return;
                }
                // O database vem herdado da subárvore: o menu de contexto
                // sabe onde clicou, e a aba precisa nascer amarrada.
                deps.abrirQuery(
                  `acao:${id}:${r.title}`, r.title, r.content, id, database
                );
              },
            })),
          ]);
        },
        onMenuConexao: (e, conexao) =>
          menuAbrir(e, [
            { label: 'Copiar nome', onClick: () => copiar(conexao.label) },
            deps.estaAberta(conexao.id)
              ? { label: 'Desconectar', onClick: () => deps.desconectar(conexao.id) }
              : { label: 'Conectar', onClick: () => deps.abrirConexao(conexao) },
            { label: 'Recarregar metadados', onClick: () => deps.recarregarMetadados(conexao.id) },
            { label: 'Ver processos…', onClick: () => deps.abrirProcessos(conexao) },
            null,
            { label: 'Editar conexão…', onClick: () => deps.abrirFormulario(conexao) },
            { label: 'Excluir conexão', danger: true, onClick: () => deps.excluir(conexao) },
          ]),
  };
}
