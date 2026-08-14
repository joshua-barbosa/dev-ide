// Linha de árvore, compartilhada pelos painéis de arquivos e de conexões.
//
// Foi mantida com implementação própria em vez do componente de árvore da
// biblioteca porque ela tem colunas: seta, ícone, rótulo e um detalhe alinhado
// à direita (contagem de linhas, tamanho, versão).
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { tokens } from '../theme';

export interface TreeRowProps {
  readonly nivel: number;
  readonly rotulo: string;
  readonly icone: string;
  readonly detalhe?: string;
  readonly expansivel?: boolean;
  readonly aberto?: boolean;
  readonly ativo?: boolean;
  readonly titulo?: string;
  readonly esmaecido?: boolean;
  readonly onClick?: () => void;
  readonly onDoubleClick?: () => void;
  readonly onContextMenu?: (e: React.MouseEvent) => void;
}

export function TreeRow({
  nivel,
  rotulo,
  icone,
  detalhe,
  expansivel = false,
  aberto = false,
  ativo = false,
  titulo,
  esmaecido = false,
  onClick,
  onDoubleClick,
  onContextMenu,
}: TreeRowProps) {
  return (
    <Box
      // Marcado para ser endereçável por teste (e pelo Playwright, adiante).
      data-tree-row={rotulo}
      title={titulo}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        pl: `${4 + nivel * 12}px`,
        pr: 1,
        py: '2px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: tokens.fontMono,
        fontSize: 12,
        color: ativo ? 'primary.main' : esmaecido ? 'text.secondary' : 'text.primary',
        bgcolor: ativo ? 'action.selected' : 'transparent',
        fontStyle: esmaecido ? 'italic' : 'normal',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ width: 10, flexShrink: 0, display: 'flex', color: 'text.secondary' }}>
        {expansivel && <Icon name={aberto ? 'lucide:chevron-down' : 'lucide:chevron-right'} size={10} />}
      </Box>

      <Icon name={icone} size={12} />

      <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{rotulo}</Box>

      {detalhe !== undefined && detalhe !== '' && (
        <Box sx={{ ml: 'auto', pl: 1, color: 'text.secondary', fontSize: 10, flexShrink: 0 }}>
          {detalhe}
        </Box>
      )}
    </Box>
  );
}
