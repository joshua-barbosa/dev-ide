// As duas caixas que a barra de status abre: linguagem e "ir para".
//
// Corte de tamanho, como o resto de `acoes/`: o teto de 800 linhas do Artigo IV
// (spec 028) pegou o `App` quando a spec 038 entrou. As duas saíram juntas
// porque são a mesma coisa vista de fora — os dois botões do canto direito, cada
// um abrindo a entrada rápida e agindo sobre o editor em foco.
import { LINGUAGENS } from '../../shared/editor/idiomas';
import { dicaDePosicao, interpretarPosicao } from '../../shared/editor/posicao';
import type { QuickInputController } from '../useQuickInput';
import type { Workspace } from '../useWorkspace';

export interface StatusAcoes {
  escolherLinguagem(): Promise<void>;
  irParaLinha(): Promise<void>;
}

export interface StatusAcoesDeps {
  readonly qi: QuickInputController;
  readonly ws: Workspace;
  trocarLinguagem(valor: string): void;
  /** Anota o salto no histórico do `Alt+←`. */
  registrarSalto(posicao: { abaId: string; linha: number }): void;
}

export function useStatusAcoes({
  qi, ws, trocarLinguagem, registrarSalto,
}: StatusAcoesDeps): StatusAcoes {
  const escolherLinguagem = async (): Promise<void> => {
    const escolhida = await qi.pedir({
      titulo: 'Selecionar linguagem',
      placeholder: 'Linguagem',
      opcoes: LINGUAGENS.map(([valor, rotulo, icone]) => ({ valor, rotulo, icone })),
    });
    if (escolhida !== null) trocarLinguagem(escolhida);
  };

  /**
   * A caixa de "ir para", do `Ctrl+G` e do clique em "Ln x, Col y".
   *
   * Aceita `12` e `12:5`, como o VS Code — e também `12,5`, que é o formato que
   * a própria barra de status mostra e que a mão copia de lá.
   */
  const irParaLinha = async (): Promise<void> => {
    const editor = ws.editorRef.current;
    if (editor === null) return;
    const total = editor.totalDeLinhas();

    const alvo = await qi.pedir({
      titulo: 'Ir para linha e coluna',
      placeholder: dicaDePosicao(total),
    });
    if (alvo === null) return;

    const posicao = interpretarPosicao(alvo, total);
    if (posicao === null) return;

    editor.goToPosition(posicao.linha, posicao.coluna);
    if (ws.activeId !== null) registrarSalto({ abaId: ws.activeId, linha: posicao.linha });
  };

  return { escolherLinguagem, irParaLinha };
}
