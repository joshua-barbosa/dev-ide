// Painel inferior: saída da execução de código.
//
// O rótulo é "Output", em inglês, para acompanhar a barra de menu — que é
// File/Edit/View e não Arquivo/Editar. A regra do projeto: **nome de painel e de
// aba segue o vocabulário do VS Code**; o texto corrido e as ações pequenas
// ("limpar") ficam em português.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { LinhaSaida } from './useExecution';
import { tokens } from './theme';

export interface OutputPanelProps {
  readonly linhas: readonly LinhaSaida[];
  readonly status: { readonly texto: string; readonly erro: boolean };
  readonly onLimpar: () => void;
}

export function OutputPanel({ linhas, status, onLimpar }: OutputPanelProps) {
  return (
    <Box sx={{ height: 160, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, px: 1.25, py: 0.4,
          bgcolor: 'background.paper', borderTop: 1, borderBottom: 1, borderColor: 'divider',
          color: 'text.secondary', fontSize: 11,
        }}
      >
        <Box sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>Output</Box>
        <Box sx={{ color: status.erro ? 'error.main' : 'success.main' }}>{status.texto}</Box>
        <Button sx={{ ml: 'auto' }} onClick={onLimpar}>limpar</Button>
      </Box>

      <Box
        component="pre"
        sx={{
          flex: 1, m: 0, p: 1.25, overflow: 'auto', bgcolor: tokens.bgEditor,
          fontFamily: tokens.fontMono, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        }}
      >
        {linhas.map((linha, i) => (
          <Box key={i} component="span" sx={{ color: linha.erro ? 'error.main' : 'text.primary' }}>
            {linha.texto}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
