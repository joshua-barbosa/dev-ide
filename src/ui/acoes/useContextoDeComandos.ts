// O que vale AGORA para menu, paleta e atalho (extraído do `App`).
//
// Saiu de lá quando o `App` bateu no teto de 800 do Artigo IV pela sétima vez.
// O assunto é um só e não é montar tela: **quais condições estão satisfeitas
// neste instante**. É o que decide se um item de menu aparece habilitado, e as
// três portas — menu, paleta e atalho — leem daqui, para nunca discordarem.
//
// Não é hook com estado, e é chamado a cada renderização de propósito: o
// contexto é uma FOTO do agora. Memoizá-lo faria o menu responder com o estado
// de ontem.
import { podeDividirTerminal } from '../../shared/terminais';
import type { ContextoDeComandos } from '../../shared/commands';
import type { ConnectionsController } from '../connections/useConnections';
import type { Execution } from '../useExecution';
import type { Navegacao } from '../useHistorico';
import type { PastaAberta } from '../files/usePasta';
import type { Workspace } from '../useWorkspace';
import type { EstadoDeTerminais } from '../../shared/terminais';

export interface DepsDoContexto {
  readonly ws: Workspace;
  readonly pasta: PastaAberta;
  readonly exec: Execution;
  readonly conexoes: ConnectionsController;
  readonly nav: Navegacao;
  readonly terminais: EstadoDeTerminais;
}

/**
 * Abas que NÃO são editor de texto, mesmo tendo um por baixo.
 *
 * `tabela` entrou na lista quando a spec 043 encontrou o defeito: o ▷ da barra
 * de abas aparecia numa aba de tabela e executava o EDITOR do grupo, que ainda
 * guardava o último arquivo aberto ali. Quem executa numa aba de tabela é o
 * botão da própria aba.
 */
const SEM_EDITOR = ['grid', 'conexao', 'tabela', 'processos', 'caderno'];

/**
 * Abas que não se salvam em disco.
 *
 * Mais curta que a de cima: o Query Book (spec 048) não é editor do Monaco e
 * mesmo assim se salva. Separar as duas foi o que devolveu o `Ctrl+S` a ele.
 */
const SEM_SALVAR = ['grid', 'conexao', 'terminal', 'tabela', 'processos'];

export function contextoDeComandos({
  ws, pasta, exec, conexoes, nav, terminais,
}: DepsDoContexto): ContextoDeComandos {
  const tipo = ws.active?.type ?? '';
  return {
    temEditor: ws.active !== null && !SEM_EDITOR.includes(tipo),
    podeSalvar: ws.active !== null && !SEM_SALVAR.includes(tipo),
    temProjeto: pasta.pasta !== '',
    abaSuja: ws.active?.dirty === true,
    temAba: ws.active !== null,
    temSelecao: true,
    temConexaoAtiva: exec.conexaoAtiva !== null,
    cofreDestrancado: conexoes.estado?.vault.unlocked === true,
    executando: exec.executando,
    podeVoltar: nav.podeVoltar,
    podeAvancar: nav.podeAvancar,
    podeDividirTerminal: podeDividirTerminal(terminais),
  };
}
