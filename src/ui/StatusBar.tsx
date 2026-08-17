// Barra de status.
//
// Saiu de dentro do `App` quando ganhou o seletor de linguagem, que antes vivia
// na barra de ferramentas. O lugar é o do VS Code: canto inferior direito, e
// clicar abre a lista — não um `<select>` ocupando a barra de cima.
import Box from '@mui/material/Box';
import { rotuloDaLinguagem } from '../shared/editor/idiomas';
import { tokens } from './theme';

export interface StatusBarProps {
  readonly titulo: string | null;
  readonly sujo: boolean;
  readonly linha: number;
  readonly coluna: number;
  readonly linguagem: string;
  /** Ausente quando não há editor: aí a linguagem é só informação. */
  readonly onTrocarLinguagem?: () => void;
}

export function StatusBar({
  titulo, sujo, linha, coluna, linguagem, onTrocarLinguagem,
}: StatusBarProps) {
  const rotulo = rotuloDaLinguagem(linguagem);

  return (
    <Box
      component="footer"
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, px: 1.25, py: 0.4,
        bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider',
        color: 'text.secondary', fontFamily: tokens.fontMono, fontSize: 11,
      }}
    >
      <span>{titulo ?? 'nenhum arquivo'}</span>
      {sujo && (
        <Box component="span" sx={{ color: 'primary.main' }}>
          ● não salvo
        </Box>
      )}

      <Box component="span" sx={{ ml: 'auto' }}>
        Ln {linha}, Col {coluna}
      </Box>

      <Box
        component="button"
        disabled={onTrocarLinguagem === undefined}
        onClick={onTrocarLinguagem}
        aria-label="Selecionar linguagem"
        sx={{
          border: 0, bgcolor: 'transparent', color: 'inherit', font: 'inherit',
          px: 0.75, py: 0.2, borderRadius: 0.5,
          cursor: onTrocarLinguagem === undefined ? 'default' : 'pointer',
          opacity: onTrocarLinguagem === undefined ? 0.5 : 1,
          '&:hover': { bgcolor: onTrocarLinguagem === undefined ? 'transparent' : 'action.hover' },
        }}
      >
        {rotulo}
      </Box>
    </Box>
  );
}
