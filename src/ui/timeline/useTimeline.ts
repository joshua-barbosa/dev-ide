// O que o Timeline faz com uma versão (T010).
//
// Saiu do `App` quando ele estourou o teto de 800 do Artigo IV pela oitava vez.
// O assunto é um só, e não é montar tela: **o que acontece quando ele escolhe
// uma versão** — trazer para o editor, ou abrir ao lado para comparar.
import { useCallback } from 'react';
import type { NotificacoesController } from '../useNotificacoes';
import type { Workspace } from '../useWorkspace';

export interface AcoesDoTimeline {
  /** Põe a versão no editor, deixando a aba suja. */
  restaurar(caminho: string, conteudo: string): void;
  /** Abre a versão numa aba própria, para comparar lado a lado. */
  abrirParaComparar(caminho: string, quando: number, conteudo: string): void;
}

export function useTimeline(
  ws: Workspace,
  notificacoes: NotificacoesController
): AcoesDoTimeline {
  /**
   * Restaurar NÃO grava em disco.
   *
   * A versão entra no editor e a aba fica suja: quem decide se aquilo vira o
   * arquivo é ele, com `Ctrl+S`. Gravar direto transformaria "quero ver como
   * estava" em "perdi o que eu tinha agora" — e o Timeline existe justamente
   * para o oposto disso.
   */
  const restaurar = useCallback(
    (_caminho: string, conteudo: string) => {
      ws.editorRef.current?.setValue(conteudo);
      ws.marcarSujo();
      notificacoes.notificar(
        'A versão veio para o editor. Salve para valer no arquivo.',
        'info',
        'Timeline'
      );
    },
    [ws, notificacoes]
  );

  /**
   * Abre a versão numa aba própria.
   *
   * O id leva a data, então duas versões do mesmo arquivo abrem em duas abas —
   * é o que permite pôr uma ao lado da outra com o `Split Editor`. Um id fixo
   * faria a segunda substituir a primeira, que é o contrário de comparar.
   */
  const abrirParaComparar = useCallback(
    (caminho: string, quando: number, conteudo: string) => {
      const nome = caminho.split('/').pop() ?? caminho;
      ws.abrirTexto(
        `versao:${caminho}:${quando}`,
        `${nome} · ${new Date(quando).toLocaleString()}`,
        conteudo,
        ws.linguagemAtiva
      );
    },
    [ws]
  );

  return { restaurar, abrirParaComparar };
}
