// O que as ações da árvore remota precisam do `App` (spec 053).
//
// Mesmo motivo e mesma forma do `propsDaAbaDeTabela`: são dez dependências que
// só um assunto usa, e montá-las inline fez o `App` passar do teto do Artigo IV
// pela quinta vez. Não é hook — é uma função que monta um objeto, chamada a
// cada renderização de propósito, para os tratadores fecharem sobre o estado de
// AGORA.
import type { ConnectionsController } from '../connections/useConnections';
import type { DepsDasAcoesRemotas } from './useAcoesRemotas';
import type { Execution } from '../useExecution';
import type { QuickInputController } from '../useQuickInput';
import type { Workspace } from '../useWorkspace';

/** Quanto do script cabe na caixa de confirmação. */
const MAX_PREVIA = 4_000;

export interface DepsParaMontar {
  readonly ws: Workspace;
  readonly qi: QuickInputController;
  readonly exec: Execution;
  readonly conexoes: ConnectionsController;
  readonly copiar: (texto: string) => void;
  readonly confirmar: (opcoes: {
    titulo?: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }) => Promise<boolean>;
  readonly mostrarSaida: () => void;
  readonly onErro: (erro: unknown) => void;
}

export function depsDasAcoesRemotas({
  ws, qi, exec, conexoes, copiar, confirmar, mostrarSaida, onErro,
}: DepsParaMontar): DepsDasAcoesRemotas {
  return {
    copiar,
    pedir: (opcoes) => qi.pedir(opcoes),
    confirmar,
    abrirArquivoRemoto: ws.abrirArquivoRemoto,
    // A prévia do script é uma confirmação com o conteúdo dentro: é a decisão
    // D28 inteira — nunca executar sem ter mostrado o que vai rodar.
    confirmarScript: (nome, conteudo) =>
      confirmar({
        titulo: `Executar "${nome}" no servidor`,
        mensagem: `Isto roda NO SERVIDOR. Confira antes:\n\n${conteudo.slice(0, MAX_PREVIA)}`,
        rotuloConfirmar: 'Executar',
        destrutivo: true,
      }),
    escreverNaSaida: exec.escreverNaSaida,
    mostrarSaida,
    recarregarNo: conexoes.recarregarNo,
    // O erro de uma ação remota vira diálogo, e não silêncio: apagar que falhou
    // tem que dizer por quê.
    avisar: (p) => void p.catch(onErro),
    somenteLeitura: (id) => conexoes.acharConexao(id)?.readOnly === true,
  };
}
