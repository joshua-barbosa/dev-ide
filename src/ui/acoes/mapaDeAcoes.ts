// O que cada comando faz (extraído do `App` na spec 053).
//
// Saiu de lá porque era o maior bloco coeso do arquivo — 90 linhas — e o `App`
// bateu no teto de 800 do Artigo IV pela quinta vez. O corte é por assunto,
// como manda a constituição: "o que cada comando faz" é um assunto só, e ele
// não tem nada a ver com montar a tela.
//
// Não é hook, e é chamado a cada renderização de propósito: os tratadores
// fecham sobre o estado de AGORA. Memoizá-los faria um comando rodar com o
// estado de ontem — o defeito que a spec 038 já pagou uma vez.
import { Api } from '../api';
import type { IdImplementado } from '../../shared/commands';
import type { ConnectionsController } from '../connections/useConnections';
import type { Execution } from '../useExecution';
import type { Workspace } from '../useWorkspace';
import type { DialogsController } from '../useDialogs';
import type { Layout } from '../useLayout';
import type { PrefsController } from '../usePrefs';
import type { Navegacao } from '../useHistorico';
import type { ArquivoAcoes } from './useArquivoAcoes';
import type { CodigoAcoes } from './useCodigoAcoes';
import type { ComandosAcoes } from './useComandosAcoes';
import type { ConexoesAcoes } from './useConexoesAcoes';
import type { PastaAcoes } from './usePastaAcoes';
import type { SnippetsAcoes } from './useSnippetsAcoes';
import type { FormatacaoAcoes } from './useFormatacaoAcoes';

/**
 * Tudo que os comandos alcançam.
 *
 * A lista é longa porque o mapa é longo — e explicitá-la é o ponto: antes ela
 * estava implícita no fecho léxico do `App`, e ninguém conseguia dizer, olhando,
 * de quantas coisas o menu depende.
 */
export interface DepsDoMapa {
  readonly ws: Workspace;
  readonly exec: Execution;
  readonly conexoes: ConnectionsController;
  readonly dialogs: DialogsController;
  readonly layout: Layout;
  readonly prefs: PrefsController;
  readonly nav: Navegacao;
  readonly arquivoAcoes: ArquivoAcoes;
  readonly codigoAcoes: CodigoAcoes;
  readonly comandosAcoes: ComandosAcoes;
  readonly conexoesAcoes: ConexoesAcoes;
  readonly pastaAcoes: PastaAcoes;
  readonly snippetsAcoes: SnippetsAcoes;
  readonly formatacaoAcoes: FormatacaoAcoes;
  readonly novoArquivo: () => void;
  readonly novoTerminalNoPainel: () => void;
  /** Divide o terminal ativo. `horizontal` (lado a lado) é o padrão (T020). */
  readonly dividirTerminalNoPainel: (orientacao?: 'horizontal' | 'vertical') => void;
  readonly abrirPorCaminho: () => Promise<void>;
  /** `Ctrl+P`: acha pelo NOME. Diferente de `abrirPorCaminho`, que pede o caminho. */
  readonly irParaArquivo: () => Promise<void>;
  readonly abrirPreferencias: () => Promise<void>;
  /** A TELA de configurações (T001) — a outra forma abre o arquivo. */
  readonly abrirTelaDePreferencias: () => void;
  readonly abrirPaleta: () => void | Promise<void>;
  readonly escolherTema: () => Promise<void>;
  /** Volta ou avança no histórico. `null` = não há para onde ir. */
  readonly irPara: (posicao: { readonly abaId: string; readonly linha: number } | null) => void;
  readonly irParaLinha: () => Promise<void>;
  readonly executar: (modo: 'file' | 'block') => void;
  readonly setPainelLateral: (painel: string) => void;
  readonly avisar: (p: Promise<unknown>) => void;
}

export function mapaDeAcoes(deps: DepsDoMapa): Readonly<Record<IdImplementado, () => void>> {
  const {
    ws, exec, conexoes, dialogs, layout, prefs, nav,
    arquivoAcoes, codigoAcoes, comandosAcoes, conexoesAcoes, pastaAcoes, snippetsAcoes,
    formatacaoAcoes,
    novoArquivo, novoTerminalNoPainel, dividirTerminalNoPainel, abrirPorCaminho, irParaArquivo,
    abrirPreferencias, abrirTelaDePreferencias, abrirPaleta, escolherTema, irPara, irParaLinha, executar,
    setPainelLateral, avisar,
  } = deps;

/**
 * Liga cada id declarado à função que o executa.
 *
 * Um comando não pendente sem entrada aqui vira clique morto — por isso há
 * teste de completude cruzando as duas listas.
 */
return {
  'file.new': novoArquivo,
  'file.newProject': () => avisar(pastaAcoes.novoProjeto()),
  'file.open': () => avisar(abrirPorCaminho()),
  'file.openFolder': () => avisar(pastaAcoes.abrirPasta()),
  'file.addFolder': () => avisar(pastaAcoes.acrescentarPasta()),
  'file.openWorkspace': () => avisar(pastaAcoes.escolherProjeto()),
  'file.openRecent': () => avisar(pastaAcoes.abrirRecente()),
  'file.save': () => avisar(arquivoAcoes.salvarArquivo()),
  'file.saveAs': () => avisar(arquivoAcoes.salvarArquivo()),
  'file.saveAll': () => avisar(arquivoAcoes.salvarTudo()),
  'file.autoSave': () => avisar(arquivoAcoes.alternarAutoSave()),
  'file.revert': () => avisar(arquivoAcoes.reverterArquivo()),
  'file.preferences': () => abrirTelaDePreferencias(),
  'file.preferencesJson': () => avisar(abrirPreferencias()),
  'file.closeEditor': () => { if (ws.activeId !== null) ws.fechar(ws.activeId); },

  'edit.undo': () => document.execCommand('undo'),
  'edit.redo': () => document.execCommand('redo'),
  'edit.cut': () => document.execCommand('cut'),
  'edit.copy': () => document.execCommand('copy'),
  'edit.snippets': () => avisar(snippetsAcoes.abrir()),
  // Beautify, Minify e a foto do trecho (spec 077).
  'edit.beautify': () => avisar(formatacaoAcoes.formatar('beautify')),
  'edit.minify': () => avisar(formatacaoAcoes.formatar('minify')),
  'edit.codeSnap': () => avisar(formatacaoAcoes.foto()),
  'edit.paste': () => avisar(navigator.clipboard.readText().then((t) => {
    document.execCommand('insertText', false, t);
  })),

  'selection.all': () => document.execCommand('selectAll'),

  'view.commandPalette': () => {
    void abrirPaleta();
  },
  'view.explorer': () => setPainelLateral('files'),
  // Os três abrem o MESMO painel: `Find in Files` e `Replace in Files` são a
  // busca vista do menu Edit, e `Search` é a mesma vista da lateral.
  'view.search': () => setPainelLateral('search'),
  'edit.findInFiles': () => setPainelLateral('search'),
  'edit.replaceInFiles': () => setPainelLateral('search'),
  'view.symbols': () => setPainelLateral('symbols'),
  'view.database': () => setPainelLateral('database'),
  'view.service': () => setPainelLateral('service'),
  // Passou a significar o que o nome diz: mostrar o painel naquela aba. Antes
  // este comando LIMPAVA a saída, o que ninguém adivinharia pelo rótulo.
  'view.appearance': () => avisar(escolherTema()),
  'view.output': () => layout.mostrarPainel('output'),
  'view.problems': () => layout.mostrarPainel('problems'),
  'view.toggleSidebar': layout.alternarLateral,
  'view.togglePanel': layout.alternarPainel,
  'view.splitEditor': () => ws.dividir('direita'),
  'view.splitEditorDown': () => ws.dividir('baixo'),
  'view.duplicateEditor': () => ws.duplicar('direita'),
  'view.duplicateEditorDown': () => ws.duplicar('baixo'),
  // Alterna e PERSISTE. A ação do Monaco alternaria e esqueceria — e o
  // usuário espera que a escolha sobreviva a recarregar a página.
  'view.wordWrap': () =>
    avisar(prefs.definir({ 'editor.wordWrap': !prefs.prefs['editor.wordWrap'] })),

  'go.file': () => avisar(irParaArquivo()),
  'go.symbol': () => setPainelLateral('symbols'),
  'go.line': () => avisar(irParaLinha()),
  'go.definition': () => avisar(codigoAcoes.irParaDefinicao()),
  'go.typeDefinition': () => avisar(codigoAcoes.irParaDefinicaoDeTipo()),
  'go.references': () => avisar(codigoAcoes.verReferencias()),
  'go.back': () => irPara(nav.voltar()),
  'go.forward': () => irPara(nav.avancar()),

  'run.file': () => executar('file'),
  'run.selection': () => executar('block'),
  'run.stop': () => avisar(exec.parar()),
  'run.buildTask': () => avisar(comandosAcoes.rodarDoGrupo('build')),
  'run.testTask': () => avisar(comandosAcoes.rodarDoGrupo('test')),
  'run.disconnect': () => {
    const id = exec.conexaoAtiva;
    if (id !== null) avisar(conexoes.desconectar(id));
  },

  'terminal.new': () => novoTerminalNoPainel(),
  'terminal.splitDown': () => dividirTerminalNoPainel('vertical'),
  'terminal.split': () => dividirTerminalNoPainel('horizontal'),
  'terminal.runTask': () => avisar(comandosAcoes.abrir()),
  'terminal.connection': () => {
    const conexao = conexoes.acharConexao(exec.conexaoAtiva);
    if (conexao !== null) avisar(conexoesAcoes.abrirTerminalDaConexao(conexao));
  },

  'help.commands': () => {
    void abrirPaleta();
  },
  // Destino honesto em vez de remoção: a IDE não tem documentação escrita,
  // mas tem um README — e é para ele que o usuário deve ser levado.
  'help.docs': () => avisar(Api.docs().then(({ path }) => ws.abrirArquivo(path))),
  'help.requisitos': () => ws.abrirRequisitos(),
  'help.about': () => void dialogs.avisar(
    'IDE local com painéis de banco e serviço, sem licença e sem limite de conexões.',
    'dev-ide'
  ),
};

}
