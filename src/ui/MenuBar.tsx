// Barra de menu no padrão do VS Code.
//
// Não sabe nada sobre comando nenhum: lê o registro de `shared/commands.ts` e
// desenha. Comando novo aparece aqui sem este arquivo mudar.
//
// Mostra o indisponível de propósito (AC-3, AC-6): o menu é o mapa do que a IDE
// tem, e um item cinza ensina que o comando existe e por que não dá agora. Quem
// esconde é a paleta, que é busca.
import { useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { MENUS, itensDoMenu, type ContextoDeComandos, type MenuId } from '../shared/commands';
import { tokens } from './theme';

export interface MenuBarProps {
  readonly contexto: ContextoDeComandos;
  readonly onComando: (id: string) => void;
}

export function MenuBar({ contexto, onComando }: MenuBarProps) {
  const [aberto, setAberto] = useState<MenuId | null>(null);
  const [ancora, setAncora] = useState<HTMLElement | null>(null);

  const abrir = (menu: MenuId, alvo: HTMLElement): void => {
    setAberto(menu);
    setAncora(alvo);
  };

  const fechar = (): void => {
    setAberto(null);
    setAncora(null);
  };

  return (
    <Box
      component="nav"
      aria-label="Barra de menu"
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.25, px: 1,
        bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider',
      }}
    >
      <Box sx={{ fontFamily: tokens.fontMono, fontWeight: 700, color: 'primary.main', mr: 1.5, fontSize: 12 }}>
        dev-ide
      </Box>

      {MENUS.map(([id, rotulo]) => (
        <Box
          key={id}
          component="button"
          aria-haspopup="menu"
          aria-expanded={aberto === id}
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            if (aberto === id) fechar();
            else abrir(id, e.currentTarget);
          }}
          // Com um menu já aberto, passar o mouse troca sem exigir clique —
          // é o comportamento que a barra do VS Code tem.
          onMouseEnter={(e: React.MouseEvent<HTMLElement>) => {
            if (aberto !== null && aberto !== id) abrir(id, e.currentTarget);
          }}
          sx={{
            border: 0, bgcolor: aberto === id ? 'action.selected' : 'transparent',
            color: 'text.primary', font: 'inherit', fontSize: 12,
            px: 1, py: 0.6, cursor: 'pointer', borderRadius: 0.5,
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {rotulo}
        </Box>
      ))}

      <Menu
        open={aberto !== null}
        anchorEl={ancora}
        onClose={fechar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ list: { dense: true, sx: { minWidth: 260, py: 0.5 } } }}
      >
        {aberto === null
          ? null
          : itensDoMenu(aberto, contexto).flatMap((item) => {
              const pendente = item.cmd.pending === true;
              const linha = (
                <MenuItem
                  key={item.cmd.id}
                  disabled={!item.disponivel}
                  onClick={() => {
                    fechar();
                    onComando(item.cmd.id);
                  }}
                  sx={{ fontSize: 12.5, gap: 3, justifyContent: 'space-between' }}
                >
                  <Box component="span">{item.cmd.label}</Box>
                  <Box component="span" sx={{ color: 'text.secondary', fontSize: 11 }}>
                    {pendente ? 'em breve' : (item.cmd.keybinding ?? '')}
                  </Box>
                </MenuItem>
              );

              return [
                ...(item.separadorAntes ? [<Divider key={`sep-${item.cmd.id}`} sx={{ my: 0.5 }} />] : []),
                pendente ? (
                  // O item desabilitado não recebe eventos, então a dica precisa
                  // de um invólucro — senão não há como explicar o "em breve".
                  <Tooltip key={item.cmd.id} title="Ainda não implementado" placement="right">
                    <Box component="span">{linha}</Box>
                  </Tooltip>
                ) : (
                  linha
                ),
              ];
            })}
      </Menu>
    </Box>
  );
}
