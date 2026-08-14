// Esqueleto da interface: a moldura que os painéis preenchem.
//
// A estrutura é a mesma de antes — barra de ferramentas, lateral, divisória,
// área de editor com abas e saída, barra de status — porque o critério desta
// migração é paridade, não redesenho.
import { useEffect } from 'react';
import Box from '@mui/material/Box';
import { tokens } from './theme';
import { Sidebar } from './Sidebar';
import { Resizer } from './Resizer';
import { useSidebarWidth } from './useSidebarWidth';
import { useWorkspace } from './useWorkspace';
import { EditorHost } from './editor/EditorHost';
import { TabBar } from './tabs/TabBar';

export function App() {
  const lateral = useSidebarWidth();
  const ws = useWorkspace();

  // Ctrl+S salva a aba ativa.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void ws.salvar().catch((err: Error) => window.alert(err.message));
      }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [ws]);

  const semAbas = ws.tabs.length === 0;

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        color: 'text.primary',
        // Durante o arraste o cursor não pode mudar ao passar sobre o editor.
        ...(lateral.dragging ? { cursor: 'col-resize', userSelect: 'none' } : {}),
      }}
    >
      <Box
        component="header"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.25,
          py: 0.75,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ fontFamily: tokens.fontMono, fontWeight: 700, color: 'primary.main' }}>
          dev-ide
        </Box>
      </Box>

      <Box component="main" sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar width={lateral.width} onAbrirArquivo={ws.abrirArquivo} />
        <Resizer dragging={lateral.dragging} onStart={lateral.startDrag} onReset={lateral.reset} />

        <Box
          component="section"
          sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
        >
          <TabBar
            tabs={ws.tabs}
            activeId={ws.activeId}
            onActivate={ws.ativar}
            onClose={ws.fechar}
          />

          {/* O editor fica montado sempre: desmontá-lo ao ficar sem abas perderia
              a instância e a ref imperativa. Some de vista, não do DOM. */}
          <Box sx={{ flex: 1, display: semAbas ? 'none' : 'flex', minHeight: 0 }}>
            <EditorHost ref={ws.editorRef} onChange={ws.marcarSujo} onCursor={ws.aoMoverCursor} />
          </Box>

          {semAbas && (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: tokens.bgEditor,
                color: 'text.secondary',
                fontSize: 13,
              }}
            >
              Nenhuma aba aberta — abra um arquivo pela árvore lateral.
            </Box>
          )}
        </Box>
      </Box>

      <Box
        component="footer"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.25,
          py: 0.4,
          bgcolor: 'background.paper',
          borderTop: 1,
          borderColor: 'divider',
          color: 'text.secondary',
          fontFamily: tokens.fontMono,
          fontSize: 11,
        }}
      >
        <span>{ws.active === null ? 'nenhum arquivo' : ws.active.title}</span>
        {ws.active?.dirty === true && (
          <Box component="span" sx={{ color: 'primary.main' }}>
            ● não salvo
          </Box>
        )}
        <Box component="span" sx={{ ml: 'auto' }}>
          Ln {ws.cursor.linha}, Col {ws.cursor.coluna}
        </Box>
      </Box>
    </Box>
  );
}
