// Barra lateral com as quatro abas de painel.
//
// As abas são dirigidas por dados: acrescentar um painel é acrescentar uma
// entrada em PAINEIS, sem mexer na renderização.
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from './Icon';
import { FilesPanel } from './files/FilesPanel';
import { ConnectionsPanel, type ConnectionsPanelProps } from './connections/ConnectionsPanel';
import { SymbolsPanel } from './files/SymbolsPanel';
import type { PastaAberta } from './files/usePasta';

// Só ícone: o nome vira dica ao passar o mouse e rótulo acessível. Ganha
// largura na lateral, que é estreita por natureza.
const PAINEIS = [
  { id: 'files', label: 'Arquivos', icone: 'lucide:files' },
  { id: 'symbols', label: 'Símbolos', icone: 'lucide:boxes' },
  { id: 'database', label: 'Database', icone: 'database' },
  { id: 'service', label: 'Service', icone: 'lucide:layers' },
] as const;

type PainelId = (typeof PAINEIS)[number]['id'];

export interface SidebarProps {
  readonly width: number;
  readonly onAbrirArquivo: (caminho: string) => Promise<void>;
  readonly caminhoAtivo?: string | null;
  readonly conexoes: Omit<ConnectionsPanelProps, 'painel'>;
  readonly pasta: PastaAberta;
  readonly onIrParaSimbolo: (arquivo: string, linha: number) => void;
  readonly onAbrirPasta: () => void;
  readonly onErro: (erro: unknown) => void;
  /** Controlado por fora: o menu View também troca de painel. */
  readonly painelAtivo: string;
  readonly onPainelAtivo: (id: string) => void;
}

export function Sidebar({
  width, onAbrirArquivo, caminhoAtivo = null, conexoes, pasta, onIrParaSimbolo,
  onAbrirPasta,
  onErro,
  painelAtivo,
  onPainelAtivo,
}: SidebarProps) {
  const ativo = painelAtivo as PainelId;

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
        onChange={(_, valor: PainelId) => onPainelAtivo(valor)}
        variant="fullWidth"
        sx={{
          minHeight: 34,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 34, fontSize: 12, py: 0, minWidth: 0, px: 0.5 },
        }}
      >
        {PAINEIS.map((painel) => (
          // O Tooltip fica DENTRO do Tab, envolvendo só o ícone. Envolver o
          // próprio Tab quebra a seleção: o MUI injeta `selected` clonando os
          // filhos DIRETOS de `Tabs`, e um invólucro no meio engole isso — o
          // indicador fica com largura zero e nada aparece marcado.
          <Tab
            key={painel.id}
            value={painel.id}
            aria-label={painel.label}
            icon={
              <Tooltip title={painel.label} placement="bottom">
                <Box sx={{ display: 'flex' }}>
                  <Icon name={painel.icone} size={16} />
                </Box>
              </Tooltip>
            }
          />
        ))}
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', py: 0.75, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {ativo === 'files' && (
          <FilesPanel
            pasta={pasta}
            onAbrirArquivo={onAbrirArquivo}
            caminhoAtivo={caminhoAtivo}
            onAbrirPasta={onAbrirPasta}
            onErro={onErro}
          />
        )}
        {(ativo === 'database' || ativo === 'service') && (
          <ConnectionsPanel painel={ativo} {...conexoes} />
        )}
        {ativo === 'symbols' && (
          <SymbolsPanel simbolos={pasta.simbolos} onIr={onIrParaSimbolo} />
        )}
      </Box>
    </Box>
  );
}
