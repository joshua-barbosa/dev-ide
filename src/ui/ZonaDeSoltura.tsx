// O indicador que aparece durante o arraste, mostrando onde a aba vai cair.
//
// É a metade da feature que o usuário descreveu: *"ele mostra como que vai
// ficar a divisão, pra esquerda, pra direita, pra cima, pra baixo"*. Sem ele,
// arrastar vira adivinhação — e a diferença entre soltar na borda e no meio é de
// poucos pixels.
//
// Fica sobre o grupo inteiro, sem receber ponteiro: quem trata `dragover` e
// `drop` é o grupo embaixo. Um retângulo que capturasse o mouse faria o próprio
// indicador cancelar o arraste ao aparecer.
import Box from '@mui/material/Box';
import type { Zona } from '../shared/arrastar';

export interface ZonaDeSolturaProps {
  /** `null` quando não há arraste sobre este grupo. */
  readonly zona: Zona | null;
}

/** Onde o retângulo se encosta, por zona. Centro ocupa tudo. */
const POSICAO: Record<Zona, Record<string, string | number>> = {
  centro: { inset: 0 },
  esquerda: { top: 0, bottom: 0, left: 0, width: '50%' },
  direita: { top: 0, bottom: 0, right: 0, width: '50%' },
  cima: { left: 0, right: 0, top: 0, height: '50%' },
  baixo: { left: 0, right: 0, bottom: 0, height: '50%' },
};

export function ZonaDeSoltura({ zona }: ZonaDeSolturaProps) {
  if (zona === null) return null;

  return (
    <Box
      data-zona-de-soltura={zona}
      sx={{
        position: 'absolute',
        zIndex: 5,
        // Sem isto o indicador roubaria o `dragover` do grupo e o arraste
        // piscaria entre "sobre o alvo" e "sobre nada".
        pointerEvents: 'none',
        bgcolor: 'primary.main',
        opacity: 0.22,
        border: 2,
        borderStyle: 'solid',
        borderColor: 'primary.main',
        transition: 'all 80ms ease-out',
        ...POSICAO[zona],
      }}
    />
  );
}
