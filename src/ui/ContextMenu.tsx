// Menu de contexto (botão direito).
//
// Posicionado por coordenada do cursor, não ancorado num elemento — é o
// comportamento esperado de árvore, e evita que a linha clicada precise virar
// referência de layout.
import { useCallback, useState } from 'react';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';

export interface ItemMenu {
  readonly label: string;
  readonly danger?: boolean;
  onClick(): void | Promise<void>;
}

/** `null` no lugar de um item vira separador. */
export type EntradaMenu = ItemMenu | null;

export interface ContextMenuControl {
  readonly elemento: React.ReactNode;
  abrir(e: React.MouseEvent, entradas: readonly EntradaMenu[]): void;
}

export function useContextMenu(): ContextMenuControl {
  const [posicao, setPosicao] = useState<{ x: number; y: number } | null>(null);
  const [entradas, setEntradas] = useState<readonly EntradaMenu[]>([]);

  const abrir = useCallback((e: React.MouseEvent, novas: readonly EntradaMenu[]) => {
    e.preventDefault();
    e.stopPropagation();
    setEntradas(novas);
    setPosicao({ x: e.clientX, y: e.clientY });
  }, []);

  const fechar = useCallback(() => setPosicao(null), []);

  const elemento = (
    <Menu
      open={posicao !== null}
      onClose={fechar}
      anchorReference="anchorPosition"
      anchorPosition={posicao === null ? undefined : { top: posicao.y, left: posicao.x }}
      slotProps={{ paper: { sx: { minWidth: 190 } } }}
    >
      {entradas.map((entrada, i) =>
        entrada === null ? (
          <Divider key={`sep-${i}`} />
        ) : (
          <MenuItem
            key={entrada.label}
            onClick={() => {
              fechar();
              Promise.resolve(entrada.onClick()).catch((err: Error) => window.alert(err.message));
            }}
            sx={{
              fontSize: 12,
              ...(entrada.danger === true ? { color: 'error.main' } : {}),
            }}
          >
            {entrada.label}
          </MenuItem>
        )
      )}
    </Menu>
  );

  return { elemento, abrir };
}
