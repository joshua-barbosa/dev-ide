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
import type { ControleDeVinculo } from '../query/useVinculo';
import { LINGUAGENS } from '../../shared/editor/idiomas';

export interface DepsDasProps {
  readonly ws: Workspace;
  readonly qi: QuickInputController;
  readonly conexoes: ConnectionsController;
  readonly exec: Execution;
  readonly vinculos: ControleDeVinculo;
  readonly dialogs: {
    confirmar(opcoes: {
      readonly titulo?: string;
      readonly mensagem: string;
      readonly rotuloConfirmar?: string;
      readonly destrutivo?: boolean;
    }): Promise<boolean>;
  };
  readonly onErro: (erro: unknown) => void;
  /** Traz o painel `Output` à frente. Ver `onRodarCodigoDoBloco`. */
  readonly mostrarSaida: () => void;
}

export function propsDaAbaDeTabela({
  ws, qi, conexoes, exec, vinculos, dialogs, onErro, mostrarSaida,
}: DepsDasProps) {
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
  // Bloco numa linguagem do runner (spec 051): a saída cai no painel `Output`,
  // igual à de rodar um arquivo.
  //
  // Trazer o painel à frente é METADE da utilidade — a mesma frase está no
  // `executar` do `App`, e esquecê-la aqui reproduziu o defeito que ela evita:
  // o bloco rodava, a saída era escrita, e a tela não mudava nada. Visto no
  // navegador, com o painel fechado.
  onRodarCodigoDoBloco: (linguagem: string, codigo: string) => {
    mostrarSaida();
    return exec.executarTexto(linguagem, codigo);
  },
  // A MESMA lista do seletor do rodapé — é o "Select Language Mode" dele.
  onPedirLinguagem: (atual: string) =>
    qi.pedir({
      titulo: 'Linguagem do bloco',
      placeholder: `atual: ${atual}`,
      opcoes: LINGUAGENS.map(([valor, rotulo, icone]) => ({ valor, rotulo, icone })),
    }),
  vinculoDoCaderno: (t: Tab) => {
    void vinculos.versao;
    return vinculos.vinculoDe((t.meta as { path?: string | null }).path ?? null);
  },
  onTrocarVinculoDoCaderno: (t: Tab) => {
    const caminho = (t.meta as { path?: string | null }).path ?? null;
    // Sem caminho não há o que lembrar: um caderno vive em arquivo, sempre.
    if (caminho !== null) void vinculos.trocar(caminho).catch(onErro);
  },
  // O que a aba de SERVIDOR precisa (spec 055).
  capacidadesDe: (conexaoId: string) => conexoes.capacidadesDe(conexaoId),
  onAbrirArquivoRemoto: ws.abrirArquivoRemoto,
  onAbrirTerminalDoServidor: (t: Tab) => {
    const meta = t.meta as { connectionId?: string; label?: string };
    if (meta.connectionId !== undefined) {
      ws.abrirTerminal(meta.connectionId, meta.label ?? t.title);
    }
  },
  conexaoSomenteLeitura: (t: Tab) =>
    conexoes.acharConexao((t.meta as { connectionId?: string }).connectionId)?.readOnly === true,
};
}
