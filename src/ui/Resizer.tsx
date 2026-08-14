// Alça de redimensionamento entre a lateral e o editor.
import Box from '@mui/material/Box';

export interface ResizerProps {
  readonly dragging: boolean;
  readonly onStart: () => void;
  readonly onReset: () => void;
}

export function Resizer({ dragging, onStart, onReset }: ResizerProps) {
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      title="Arraste para redimensionar · duplo clique restaura"
      onMouseDown={(e) => {
        e.preventDefault(); // evita selecionar texto ao arrastar
        onStart();
      }}
      onDoubleClick={onReset}
      sx={{
        width: '4px',
        flexShrink: 0,
        cursor: 'col-resize',
        bgcolor: dragging ? 'primary.main' : 'divider',
        transition: 'background-color 120ms',
        '&:hover': { bgcolor: 'primary.main' },
      }}
    />
  );
}
