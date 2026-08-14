// Barra lateral com as quatro abas de painel.
//
// As abas são dirigidas por dados: acrescentar um painel é acrescentar uma
// entrada em PAINEIS, sem mexer na renderização.
import { useState } from 'react';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

const PAINEIS = [
  { id: 'files', label: 'Arquivos' },
  { id: 'symbols', label: 'Símbolos' },
  { id: 'database', label: 'Database' },
  { id: 'service', label: 'Service' },
] as const;

type PainelId = (typeof PAINEIS)[number]['id'];

export interface SidebarProps {
  readonly width: number;
}

export function Sidebar({ width }: SidebarProps) {
  const [ativo, setAtivo] = useState<PainelId>('files');

  return (
    <Box
      component="aside"
      sx={{
        width,
        flexShrink: 0,
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <Tabs
        value={ativo}
        onChange={(_, valor: PainelId) => setAtivo(valor)}
        variant="fullWidth"
        sx={{
          minHeight: 34,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 34, fontSize: 12, py: 0, minWidth: 0, px: 0.5 },
        }}
      >
        {PAINEIS.map((painel) => (
          <Tab key={painel.id} value={painel.id} label={painel.label} />
        ))}
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', py: 0.75 }}>
        <Box sx={{ px: 1.25, color: 'text.secondary', fontSize: 11 }}>
          {PAINEIS.find((p) => p.id === ativo)?.label}
        </Box>
      </Box>
    </Box>
  );
}
