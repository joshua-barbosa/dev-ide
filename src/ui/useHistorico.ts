// Navegação Back/Forward, do lado da interface.
//
// A lógica (cortar o futuro, pular aba fechada, teto) mora em
// `shared/historico.ts`, testada sem navegador. Aqui fica o que precisa do
// React.
//
// **A verdade mora num `ref`, e o estado é só espelho.** A primeira versão
// guardava o histórico em `useState` e lia o destino de dentro do atualizador —
// mas `setState(fn)` não executa `fn` na hora, então `voltar()` devolvia o
// destino de antes ou `null`. O `Alt+→` simplesmente não andava, e o teste
// pegou. Com o `ref`, andar é síncrono; o estado existe só para o menu saber
// quando habilitar os itens.
import { useCallback, useRef, useState } from 'react';
import {
  avancar, HISTORICO_VAZIO, podeAvancar, podeVoltar, registrar, voltar,
  type Historico, type Posicao,
} from '../shared/historico';

export interface Navegacao {
  readonly podeVoltar: boolean;
  readonly podeAvancar: boolean;
  /** Guarda um salto. Ignorado enquanto o próprio Back/Forward está andando. */
  registrarSalto(posicao: Posicao): void;
  voltar(): Posicao | null;
  avancar(): Posicao | null;
}

export interface NavegacaoDeps {
  /**
   * Falso para posição que não dá mais para alcançar — ela é pulada.
   *
   * Desde o T011, aba fechada COM caminho continua alcançável: quem vai até lá
   * reabre o arquivo. Sem caminho — aba sem título, aba de query — não há o que
   * reabrir, e a posição segue sendo pulada.
   */
  alcancavel(posicao: Posicao): boolean;
}

export function useHistorico({ alcancavel }: NavegacaoDeps): Navegacao {
  const historico = useRef<Historico>(HISTORICO_VAZIO);
  const [espelho, setEspelho] = useState(HISTORICO_VAZIO);
  // Sem isto, o `Back` ativaria a aba de destino, e essa ativação seria
  // registrada como salto novo — apagando o futuro e prendendo o usuário entre
  // duas posições.
  const andando = useRef(false);
  const existe = useRef(alcancavel);
  existe.current = alcancavel;

  const aplicar = useCallback((novo: Historico) => {
    historico.current = novo;
    setEspelho(novo);
  }, []);

  const registrarSalto = useCallback(
    (posicao: Posicao) => {
      if (andando.current) return;
      aplicar(registrar(historico.current, posicao));
    },
    [aplicar]
  );

  const mover = useCallback(
    (paraTras: boolean): Posicao | null => {
      const r = paraTras
        ? voltar(historico.current, existe.current)
        : avancar(historico.current, existe.current);
      if (r.destino === null) return null;

      aplicar(r.historico);
      andando.current = true;
      // Solta na próxima volta do laço de eventos: a ativação da aba e o pulo
      // de linha acontecem depois deste retorno.
      window.setTimeout(() => {
        andando.current = false;
      }, 0);
      return r.destino;
    },
    [aplicar]
  );

  return {
    podeVoltar: podeVoltar(espelho),
    podeAvancar: podeAvancar(espelho),
    registrarSalto,
    voltar: () => mover(true),
    avancar: () => mover(false),
  };
}
