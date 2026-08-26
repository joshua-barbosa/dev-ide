// Barra de abas.
//
// O ponto de "não salvo" ocupa o mesmo lugar do X e vira X ao passar o mouse:
// a aba não muda de largura ao ficar suja, então a fila não dança.
import Box from '@mui/material/Box';
import type { Tab } from '../../shared/tabs';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { codificarCarga, MIME_DE_ARRASTE } from '../../shared/arrastar';

export interface TabBarProps {
  readonly tabs: readonly Tab[];
  readonly activeId: string | null;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  /** Ausente quando não há o que executar; aí o botão não aparece. */
  readonly onExecutar?: () => void;
  /** Numa aba SQL o mesmo botão manda para o banco. */
  readonly ehSql?: boolean;
  /** Ausente quando a aba ativa não é pré-visualizável (só markdown, hoje). */

  /** Verdadeiro quando a aba ativa já está mostrando o renderizado. */

}

export function TabBar({
  tabs, activeId, onActivate, onClose, onExecutar, ehSql = false,
}: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        overflowX: 'auto',
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const ativa = tab.id === activeId;
        return (
          <Box
            key={tab.id}
            data-tab={tab.title}
            data-tab-active={ativa ? 'true' : 'false'}
            data-tab-dirty={tab.dirty ? 'true' : 'false'}
            onClick={() => onActivate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(tab.id); // botão do meio fecha
            }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(MIME_DE_ARRASTE, codificarCarga({ tipo: 'aba', id: tab.id }));
              e.dataTransfer.effectAllowed = 'move';
            }}
            title={tab.title}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              pl: 1.25,
              pr: 1,
              py: 0.75,
              maxWidth: 220,
              borderRight: 1,
              borderColor: 'divider',
              borderTop: '2px solid',
              borderTopColor: ativa ? 'primary.main' : 'transparent',
              bgcolor: ativa ? tokens.bgEditor : 'transparent',
              color: ativa ? 'text.primary' : 'text.secondary',
              cursor: 'pointer',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              '&:hover': { bgcolor: ativa ? tokens.bgEditor : 'background.default' },
              '&:hover .aba-fechar': { opacity: 1 },
              '&:hover .aba-ponto': { display: 'none' },
              '&:hover .aba-x': { display: 'block' },
            }}
          >
            <Icon name={tab.icon ?? tab.type} size={12} />

            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 }}
            >
              {tab.title}
            </Box>

            <Box
              className="aba-fechar"
              component="button"
              type="button"
              title="Fechar"
              // O nome precisa dizer QUAL aba: com várias abertas, "Fechar"
              // repetido não distingue nada para quem navega pelo teclado.
              aria-label={`Fechar ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation(); // não ativar a aba ao fechá-la
                onClose(tab.id);
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                p: 0,
                border: 'none',
                borderRadius: '3px',
                bgcolor: 'transparent',
                color: tab.dirty ? 'primary.main' : 'inherit',
                opacity: tab.dirty ? 1 : 0.55,
                cursor: 'pointer',
                flexShrink: 0,
                '&:hover': { bgcolor: 'divider', opacity: 1 },
              }}
            >
              {tab.dirty ? (
                <>
                  <Box className="aba-ponto" component="span" sx={{ fontSize: 14, lineHeight: 1 }}>
                    ●
                  </Box>
                  <Box className="aba-x" sx={{ display: 'none' }}>
                    <Icon name="lucide:x" size={12} />
                  </Box>
                </>
              ) : (
                <Icon name="lucide:x" size={12} />
              )}
            </Box>
          </Box>
        );
      })}

      {onExecutar !== undefined && (
        <Box
          component="button"
          type="button"
          onClick={onExecutar}
          title={ehSql ? 'Executar consulta (Ctrl+Enter)' : 'Executar arquivo (Ctrl+Enter)'}
          aria-label={ehSql ? 'Executar consulta' : 'Executar arquivo'}
          sx={{
            // `auto` SEMPRE. Era condicional ao preview não existir, e com os
            // dois na tela nenhum ganhava o empurrão: eles grudavam no fim das
            // abas, no meio da barra. Ele mandou o print.
            ml: 'auto',
            border: 0, bgcolor: 'transparent', cursor: 'pointer',
            color: 'success.main', px: 1.25, display: 'flex', alignItems: 'center',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Icon name="lucide:play" size={13} />
        </Box>
      )}
    </Box>
  );
}
