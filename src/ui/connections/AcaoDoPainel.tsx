// O botão de ícone do cabeçalho do painel de conexões.
//
// Ganhou arquivo próprio quando o `ConnectionsPanel` bateu no teto de 800 linhas
// (Artigo IV) e a ação de importar saiu para o lado: os dois precisavam dele, e
// importar um do outro faria um ciclo.
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';

/** Botão de ação do cabeçalho: só ícone, com dica. */
export function AcaoDoPainel({
  icone, rotulo, onClick, desabilitada = false,
}: {
  readonly icone: string;
  readonly rotulo: string;
  readonly onClick: () => void;
  readonly desabilitada?: boolean;
}) {
  return (
    <Tooltip title={rotulo} placement="bottom">
      {/* O `span` existe porque um botão desabilitado não dispara eventos, e sem
          ele a dica sumiria justo quando explica por que a ação não está ativa. */}
      <Box component="span" sx={{ display: 'flex' }}>
        <IconButton
          size="small"
          disabled={desabilitada}
          onClick={onClick}
          aria-label={rotulo}
          sx={{ p: 0.5, borderRadius: 0.5 }}
        >
          <Icon name={icone} size={13} />
        </IconButton>
      </Box>
    </Tooltip>
  );
}
