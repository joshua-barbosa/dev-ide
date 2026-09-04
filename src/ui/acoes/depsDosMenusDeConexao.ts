// O que os menus da árvore de conexões precisam do `App`.
//
// Mesmo motivo e mesma forma do `depsDasAcoesRemotas`: são catorze dependências
// que só um assunto usa, e montá-las inline fez o `App` passar do teto do
// Artigo IV — desta vez por UMA linha, ao ganhar o `onAbrirChave` da spec 089.
//
// Não é hook: é uma função que monta um objeto, chamada a cada renderização de
// propósito, para os tratadores fecharem sobre o estado de AGORA.
import type { ConnectionsController } from '../connections/useConnections';
import type { ConexoesAcoes } from './useConexoesAcoes';
import type { DepsDosMenus } from './useMenusDeConexao';
import type { AcoesRemotas } from './useAcoesRemotas';
import type { Workspace } from '../useWorkspace';

export interface DepsParaMontarMenus {
  readonly ws: Workspace;
  readonly conexoes: ConnectionsController;
  readonly conexoesAcoes: ConexoesAcoes;
  readonly acoesRemotas: AcoesRemotas;
  readonly abrir: DepsDosMenus['abrir'];
  readonly copiar: (texto: string) => void;
  readonly confirmar: DepsDosMenus['confirmar'];
}

export function depsDosMenusDeConexao({
  ws, conexoes, conexoesAcoes, acoesRemotas, abrir, copiar, confirmar,
}: DepsParaMontarMenus): DepsDosMenus {
  return {
    abrir,
    acoesRemotas,
    copiar,
    // T064: o diagrama sai como markdown com um bloco Mermaid, aberto JÁ em
    // preview. O texto continua atrás do switch, para ele poder gravar o
    // diagrama no repositório como documentação.
    sabeDesenharEr: (id) => conexoes.capacidadesDe(id)?.diagramaEr === true,
    diagramaEr: conexoesAcoes.diagramaEr,
    abrirQuery: ws.abrirQuery,
    abrirFormulario: (conexao) => conexoesAcoes.abrirFormulario(conexao),
    excluir: conexoes.excluir,
    abrirTerminalDaConexao: conexoesAcoes.abrirTerminalDaConexao,
    recarregarMetadados: conexoes.recarregarMetadados,
    abrirProcessos: (conexao) => ws.abrirProcessos(conexao.id, conexao.label),
    novaQuery: async (connectionId, no, tipo) => {
      const database = typeof no.meta?.database === 'string' ? no.meta.database : null;
      if (database === null) return;
      await conexoesAcoes.novaQuery({ connectionId, database }, tipo);
    },
    estaAberta: (id) => conexoes.estado?.openIds.includes(id) === true,
    desconectar: conexoes.desconectar,
    abrirConexao: conexoes.abrirConexao,
    confirmar,
  };
}
