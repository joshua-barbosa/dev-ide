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
import { Icon } from './Icon';
import { tokens } from './theme';

export interface MenuBarProps {
  readonly contexto: ContextoDeComandos;
  readonly onComando: (id: string) => void;
  /** Estado dos dois painéis, para a dica dizer o que o clique vai fazer. */
  readonly lateralVisivel: boolean;
  readonly painelVisivel: boolean;
  readonly onAlternarLateral: () => void;
  readonly onAlternarPainel: () => void;
  /**
   * Texto à direita de um item, no lugar do atalho.
   *
   * Existe para o `Auto Save` mostrar o modo em que está: um interruptor sem
   * lâmpada não diz se está ligado. Mapa `id → texto`, para o componente
   * continuar sem saber de comando nenhum.
   */
  readonly estados?: Readonly<Record<string, string>>;
}

export function MenuBar({
  contexto, onComando, lateralVisivel, painelVisivel, onAlternarLateral, onAlternarPainel,
  estados = {},
}: MenuBarProps) {
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
        Braytech Code
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

      {/* À direita, como no VS Code. A dica diz o VERBO do próximo clique
          ("Esconder"/"Mostrar"), e não o nome do painel: é o que a pessoa quer
          saber antes de clicar. */}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.25 }}>
        {([
          ['lateral', lateralVisivel, onAlternarLateral, 'lucide:panel-left', 'a barra lateral', 'Ctrl+B'],
          ['painel', painelVisivel, onAlternarPainel, 'lucide:panel-bottom', 'o painel inferior', 'Ctrl+J'],
        ] as const).map(([chave, visivel, alternar, icone, nome, atalho]) => (
          <Tooltip
            key={chave}
            title={`${visivel ? 'Esconder' : 'Mostrar'} ${nome} (${atalho})`}
            placement="bottom"
          >
            <Box
              component="button"
              type="button"
              aria-label={`${visivel ? 'Esconder' : 'Mostrar'} ${nome}`}
              aria-pressed={visivel}
              onClick={alternar}
              sx={{
                border: 0, bgcolor: 'transparent', cursor: 'pointer', p: 0.6,
                display: 'flex', alignItems: 'center', borderRadius: 0.5,
                color: visivel ? 'text.primary' : 'text.secondary',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Icon name={icone} size={14} />
            </Box>
          </Tooltip>
        ))}
      </Box>

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
                    {pendente ? 'em breve' : (estados[item.cmd.id] ?? item.cmd.keybinding ?? '')}
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
