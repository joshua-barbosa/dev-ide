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
  /** Sessão aberta: vira um ponto sobre o ícone, sem escondê-lo. */
  readonly conectado?: boolean;
  readonly titulo?: string;
  readonly esmaecido?: boolean;
  readonly onClick?: () => void;
  readonly onDoubleClick?: () => void;
  readonly onContextMenu?: (e: React.MouseEvent) => void;
  /** Ações que aparecem ao passar o mouse, à direita da linha. */
  readonly acoes?: React.ReactNode;
}

export function TreeRow({
  nivel,
  rotulo,
  icone,
  detalhe,
  expansivel = false,
  aberto = false,
  ativo = false,
  conectado = false,
  titulo,
  esmaecido = false,
  onClick,
  onDoubleClick,
  onContextMenu,
  acoes,
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
        '&:hover .linha-acoes': { opacity: 1, pointerEvents: 'auto' },
      }}
    >
      <Box sx={{ width: 10, flexShrink: 0, display: 'flex', color: 'text.secondary' }}>
        {expansivel && <Icon name={aberto ? 'lucide:chevron-down' : 'lucide:chevron-right'} size={10} />}
      </Box>

      {/* O ponto se sobrepõe ao ícone em vez de substituí-lo: trocar a marca
          por uma tomada perderia o tipo justamente na conexão em uso. */}
      <Box sx={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        <Icon name={icone} size={12} />
        {conectado && (
          <Box
            aria-label="conectado"
            sx={{
              position: 'absolute', right: -2, bottom: -1,
              width: 6, height: 6, borderRadius: '50%',
              bgcolor: 'success.main',
              outline: '1.5px solid',
              outlineColor: 'background.paper',
            }}
          />
        )}
      </Box>

      <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{rotulo}</Box>

      {acoes !== undefined && (
        <Box
          className="linha-acoes"
          onClick={(e) => e.stopPropagation()}
          sx={{
            ml: 'auto', display: 'flex', gap: 0.25, flexShrink: 0,
            // Invisível mas ocupando lugar: aparecer do nada empurraria o
            // rótulo e faria a linha "pular" sob o cursor.
            opacity: 0, pointerEvents: 'none', transition: 'opacity 120ms',
          }}
        >
          {acoes}
        </Box>
      )}

      {detalhe !== undefined && detalhe !== '' && (
        <Box sx={{ ml: acoes === undefined ? 'auto' : 0, pl: 1, color: 'text.secondary', fontSize: 10, flexShrink: 0 }}>
          {detalhe}
        </Box>
      )}
    </Box>
  );
}
