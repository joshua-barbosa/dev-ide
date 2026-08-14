// Largura da barra lateral, com arraste e persistência.
//
// Portado de resizer.js sem mudança de comportamento. Os detalhes que importam:
// o arraste escuta no documento, não na alça — senão mover o mouse rápido
// "escapa" dela e o arraste trava — e a largura é medida pela distância até a
// borda esquerda da lateral, para o cursor não deslizar em relação à borda.
import { useCallback, useEffect, useRef, useState } from 'react';

const LARGURA_MIN = 160;
const LARGURA_PADRAO = 240;
/** Espaço mínimo que sobra para o editor; impede engolir a área de trabalho. */
const RESERVA_EDITOR = 320;
const CHAVE = 'dev-ide.sidebar-width';

function limitar(largura: number): number {
  const maximo = Math.max(LARGURA_MIN, window.innerWidth - RESERVA_EDITOR);
  return Math.min(Math.max(largura, LARGURA_MIN), maximo);
}

function larguraGuardada(): number {
  try {
    const guardada = Number(localStorage.getItem(CHAVE));
    return Number.isFinite(guardada) && guardada > 0 ? limitar(guardada) : LARGURA_PADRAO;
  } catch {
    // Modo privativo ou storage indisponível: fica o padrão.
    return LARGURA_PADRAO;
  }
}

function guardar(largura: number): void {
  try {
    localStorage.setItem(CHAVE, String(largura));
  } catch {
    // Sem storage a largura só não persiste; não é motivo para falhar.
  }
}

export interface SidebarWidth {
  readonly width: number;
  readonly dragging: boolean;
  readonly startDrag: () => void;
  readonly reset: () => void;
}

export function useSidebarWidth(): SidebarWidth {
  const [width, setWidth] = useState(larguraGuardada);
  const [dragging, setDragging] = useState(false);
  const larguraAtual = useRef(width);
  larguraAtual.current = width;

  useEffect(() => {
    if (!dragging) return;

    const mover = (e: MouseEvent) => setWidth(limitar(e.clientX));
    const soltar = () => {
      setDragging(false);
      guardar(larguraAtual.current);
    };

    document.addEventListener('mousemove', mover);
    document.addEventListener('mouseup', soltar);
    return () => {
      document.removeEventListener('mousemove', mover);
      document.removeEventListener('mouseup', soltar);
    };
  }, [dragging]);

  // Janela menor pode deixar a lateral maior que o permitido.
  useEffect(() => {
    const ajustar = () => setWidth((atual) => limitar(atual));
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, []);

  const reset = useCallback(() => {
    const valor = limitar(LARGURA_PADRAO);
    setWidth(valor);
    guardar(valor);
  }, []);

  return { width, dragging, startDrag: () => setDragging(true), reset };
}
