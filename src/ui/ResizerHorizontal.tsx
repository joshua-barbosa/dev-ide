// Divisória horizontal: arrasta a borda superior do painel inferior.
//
// Irmã do `Resizer` vertical, e com o mesmo cuidado que aquele documenta: o
// arraste escuta no DOCUMENTO, e não na alça — mover o mouse rápido "escapa" da
// alça e o arraste trava no meio.
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';

export interface ResizerHorizontalProps {
  /** Recebe a altura desejada, medida do fundo da janela até o cursor. */
  readonly onAltura: (altura: number) => void;
  readonly onReset: () => void;
}

export function ResizerHorizontal({ onAltura, onReset }: ResizerHorizontalProps) {
  const [arrastando, setArrastando] = useState(false);
  const aoAltura = useRef(onAltura);
  aoAltura.current = onAltura;

  useEffect(() => {
    if (!arrastando) return;
    const mover = (e: MouseEvent): void => aoAltura.current(window.innerHeight - e.clientY);
    const soltar = (): void => setArrastando(false);

    document.addEventListener('mousemove', mover);
    document.addEventListener('mouseup', soltar);
    return () => {
      document.removeEventListener('mousemove', mover);
      document.removeEventListener('mouseup', soltar);
    };
  }, [arrastando]);

  return (
    <Box
      role="separator"
      aria-label="Arraste para redimensionar o painel · duplo clique restaura"
      title="Arraste para redimensionar o painel · duplo clique restaura"
      onMouseDown={() => setArrastando(true)}
      onDoubleClick={onReset}
      sx={{
        height: 4,
        flexShrink: 0,
        cursor: 'row-resize',
        bgcolor: arrastando ? 'primary.main' : 'transparent',
        '&:hover': { bgcolor: 'primary.main' },
      }}
    />
  );
}
