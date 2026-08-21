// A barra que aparece quando há alterações pendentes (spec 044).
//
// Só existe com rascunho: uma barra permanente com "0 alterações" seria ruído
// nas 99% das vezes em que a aba é usada para ler.
//
// Os três botões são deliberadamente assimétricos. Acrescentar e descartar são
// baratos e imediatos; **gravar mostra o SQL antes**, porque é o único que
// escreve no banco de outra pessoa.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { tokens } from '../theme';
import type { Rascunho } from './useRascunho';

export interface BarraDeRascunhoProps {
  readonly rascunho: Rascunho;
  readonly gravando: boolean;
  readonly onGravar: () => void;
}

export function BarraDeRascunho({ rascunho, gravando, onGravar }: BarraDeRascunhoProps) {
  if (rascunho.vazio) return null;

  const partes: string[] = [];
  if (rascunho.alteracoes.size > 0) partes.push(`${rascunho.alteracoes.size} alterada(s)`);
  if (rascunho.novas.length > 0) partes.push(`${rascunho.novas.length} nova(s)`);
  if (rascunho.remocoes.size > 0) partes.push(`${rascunho.remocoes.size} a apagar`);

  return (
    <Box
      data-rascunho
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5,
        bgcolor: 'warning.main', color: 'background.default',
        fontSize: 11, fontFamily: tokens.fontMono, flexShrink: 0,
      }}
    >
      <Box component="span" sx={{ fontWeight: 600 }}>
        {partes.join(' · ')} — ainda não gravado
      </Box>
      <Box sx={{ flex: 1 }} />
      <Button
        size="small"
        onClick={rascunho.descartar}
        disabled={gravando}
        sx={{ fontSize: 11, color: 'inherit', minWidth: 0 }}
      >
        Descartar
      </Button>
      <Button
        size="small"
        variant="contained"
        color="inherit"
        onClick={onGravar}
        disabled={gravando}
        sx={{ fontSize: 11, minWidth: 0, color: 'warning.main' }}
      >
        {gravando ? 'gravando…' : 'Gravar…'}
      </Button>
    </Box>
  );
}
