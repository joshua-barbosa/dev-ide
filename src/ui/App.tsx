// Esqueleto da interface: a moldura que os painéis preenchem.
//
// A estrutura é a mesma de antes — barra de ferramentas, lateral, divisória,
// área de editor com abas e saída, barra de status — porque o critério desta
// migração é paridade, não redesenho.
import Box from '@mui/material/Box';
import { tokens } from './theme';
import { Sidebar } from './Sidebar';
import { Resizer } from './Resizer';
import { useSidebarWidth } from './useSidebarWidth';
import { useEffect, useRef, useState } from 'react';
import { EditorHost, type EditorHandle } from './editor/EditorHost';

const EXEMPLO = `-- realce de SQL, sem diferenciar caixa
SELECT id, codigo FROM servidor-2.alunos WHERE ano_prova = 2026;

/* bloco */
select count(*) from \`provas\` where titulo like '%Enac%';
`;

export function App() {
  const lateral = useSidebarWidth();
  const editor = useRef<EditorHandle>(null);
  const [cursor, setCursor] = useState({ linha: 1, coluna: 1 });

  useEffect(() => {
    editor.current?.setLanguage('sql');
    editor.current?.setValue(EXEMPLO);
  }, []);

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
        <Sidebar width={lateral.width} />
        <Resizer
          dragging={lateral.dragging}
          onStart={lateral.startDrag}
          onReset={lateral.reset}
        />
        <Box
          component="section"
          sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
        >
          <EditorHost
            ref={editor}
            onChange={() => undefined}
            onCursor={(linha, coluna) => setCursor({ linha, coluna })}
          />
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
        <span>exemplo.sql</span>
        <span style={{ marginLeft: 'auto' }}>
          Ln {cursor.linha}, Col {cursor.coluna}
        </span>
      </Box>
    </Box>
  );
}
