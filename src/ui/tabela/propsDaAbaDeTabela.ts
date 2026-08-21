// O que a ABA DE TABELA e o QUERY BOOK precisam do `App`.
//
// Saiu do JSX quando o portão do Artigo IV pegou o `App` — são nove props que
// só essas duas abas usam, e passá-las inline fazia o `EditorGroup` parecer ter
// vinte responsabilidades em vez de duas.
//
// Não é um hook: é uma função que monta um objeto. Chamá-la a cada renderização
// é de propósito — os tratadores fecham sobre o estado de AGORA, e memoizá-los
// faria um comando rodar com o estado de ontem, que é o defeito que a spec 038
// já pagou uma vez.
import type { Tab } from '../../shared/tabs';
import type { ConnectionsController } from '../connections/useConnections';
import type { Execution } from '../useExecution';
import type { QuickInputController } from '../useQuickInput';
import type { Workspace } from '../useWorkspace';

export interface DepsDasProps {
  readonly ws: Workspace;
  readonly qi: QuickInputController;
  readonly conexoes: ConnectionsController;
  readonly exec: Execution;
  readonly dialogs: {
    confirmar(opcoes: {
      readonly titulo?: string;
      readonly mensagem: string;
      readonly rotuloConfirmar?: string;
      readonly destrutivo?: boolean;
    }): Promise<boolean>;
  };
  readonly onErro: (erro: unknown) => void;
}

export function propsDaAbaDeTabela({ ws, qi, conexoes, exec, dialogs, onErro }: DepsDasProps) {
return {
  onExportar: ws.abrirSemTitulo,
  onConfirmarEscrita: (mensagem: string, titulo: string) =>
    dialogs.confirmar({ titulo, mensagem, rotuloConfirmar: 'Gravar', destrutivo: true }),
  qi,
  abrirComando: (id: string, titulo: string, sql: string) => {
    const meta = (ws.active?.meta ?? {}) as { connectionId?: string; database?: string | null };
    ws.abrirQuery(id, titulo, sql, meta.connectionId ?? '', meta.database ?? null);
  },
  onErroDaTabela: onErro,
  onMudarCaderno: ws.mudarCaderno,
  // O bloco do caderno roda pelo MESMO caminho do `Run` do editor: quem
  // resolve o vínculo e abre o resultado é o `executarStatement` da spec 038.
  onRodarBloco: (
    modo: 'run' | 'tab' | 'json',
    sql: string,
    caminho: string | null,
    titulo: string
  ) => exec.executarStatement(modo, sql, caminho, titulo),
  conexaoSomenteLeitura: (t: Tab) =>
    conexoes.acharConexao((t.meta as { connectionId?: string }).connectionId)?.readOnly === true,
};
}
