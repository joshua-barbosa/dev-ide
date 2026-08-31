// Os saltos e o histórico de navegação (spec 016, T011).
//
// Saiu do `App` quando ele passou do teto de 800 linhas do Artigo IV ao ganhar
// o caminho nas posições. O corte é por assunto: aqui está *"por onde se passou
// e como voltar"*, e lá ficou a montagem da tela.
//
// **A decisão central da spec 016 continua valendo:** trocar de aba é um salto,
// mover o cursor não é. Registrar cada tecla faria `Back` andar uma casa por
// vez e não servir para nada.
import { useEffect } from 'react';
import type { Navegacao } from '../useHistorico';
import type { Posicao } from '../../shared/historico';
import type { Workspace } from '../useWorkspace';

export interface SaltosDeps {
  readonly ws: Workspace;
  readonly nav: Navegacao;
  /** Engole a promessa e manda o erro para a tela de problemas. */
  avisar(p: Promise<unknown>): void;
  onErro(erro: unknown): void;
}

export interface Saltos {
  /** Leva a uma posição do histórico, reabrindo o arquivo se preciso (T011). */
  irPara(posicao: Posicao | null): void;
  /** Abre o arquivo do símbolo, se preciso, e pula para a linha. */
  irParaSimbolo(arquivo: string, linha: number): void;
  /** Monta a posição de uma aba, com o caminho quando ela tem um. */
  saltoDe(abaId: string, linha: number): Posicao;
}

export function useSaltos({ ws, nav, avisar, onErro }: SaltosDeps): Saltos {
  /**
   * Uma posição do histórico, com o caminho quando a aba tem um (T011).
   *
   * O caminho é o que permite VOLTAR para um arquivo já fechado. Registrá-lo
   * aqui, e não na hora de voltar, é o que faz a informação existir quando ela
   * é necessária — na volta, a aba já não está lá para ser perguntada.
   */
  const saltoDe = (abaId: string, linha: number): Posicao => {
    const caminho = (ws.store.get(abaId)?.meta as { path?: string | null } | undefined)?.path;
    return {
      abaId,
      linha,
      ...(typeof caminho === 'string' && caminho !== '' ? { caminho } : {}),
    };
  };

  const activeId = ws.activeId;
  const linhaAtual = ws.cursor.linha;
  useEffect(() => {
    if (activeId !== null) nav.registrarSalto(saltoDe(activeId, linhaAtual));
    // `cursor` FORA das dependências de propósito — é justamente o que não deve
    // disparar registro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  /**
   * Leva a uma posição do histórico, reabrindo o arquivo se preciso (T011).
   *
   * Reabrir é o item inteiro: antes, `Back` para uma aba fechada pulava a
   * posição em silêncio, e quem apertava caía num lugar que não tinha pedido.
   * Fechar a aba não desfaz a navegação.
   */
  const irPara = (posicao: Posicao | null): void => {
    if (posicao === null) return;
    if (ws.store.get(posicao.abaId) !== null) {
      ws.ativar(posicao.abaId);
      // Depois da troca de aba: o editor só carrega no efeito seguinte.
      window.setTimeout(() => ws.editorRef.current?.goToLine(posicao.linha), 0);
      return;
    }
    const caminho = posicao.caminho;
    if (caminho === undefined) return;
    // `abrirArquivoEm` e não abrir e saltar: o arquivo vem do servidor, e o
    // salto tem de esperar o conteúdo chegar ao editor. Foi o defeito da spec
    // 032, e a saída de lá serve aqui inteira.
    avisar(ws.abrirArquivoEm(caminho, posicao.linha, 1));
  };

  const irParaSimbolo = (arquivo: string, linha: number): void => {
    const atual = (ws.active?.meta as { path?: string | null } | undefined)?.path ?? null;
    // De onde se saiu já está no histórico: o efeito de `activeId` registrou ao
    // chegar aqui. O que falta é a linha de destino, que não é troca de aba.
    const pular = () => window.setTimeout(() => {
      ws.editorRef.current?.goToLine(linha);
      const destino = ws.store.list().find(
        (t) => (t.meta as { path?: string | null }).path === arquivo
      );
      if (destino !== undefined) nav.registrarSalto(saltoDe(destino.id, linha));
    }, 0);
    if (arquivo === atual) {
      pular();
      return;
    }
    ws.abrirArquivo(arquivo).then(pular).catch(onErro);
  };

  return { irPara, irParaSimbolo, saltoDe };
}
