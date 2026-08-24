// A fresta entre dois blocos (spec 050).
//
// Faz duas coisas que parecem diferentes e são a mesma: **dizer onde um bloco
// entra**. Parada, ela oferece `Add Code` / `Add Markdown` naquela posição
// exata; durante um arraste, ela é o alvo onde o bloco cai.
//
// Some quando o mouse não está por perto porque um caderno de dez blocos com
// dez pares de botões permanentes é uma parede de botões — e o que se lê num
// caderno é o conteúdo.
import Box from '@mui/material/Box';
import type { TipoDeCelula } from '../../shared/sql/caderno';

export interface FrestaProps {
  /** Qual fresta é esta: `0` antes do primeiro bloco, `n` depois do último. */
  readonly indice: number;
  /** Há um bloco sendo arrastado agora? Muda o que a fresta oferece. */
  readonly arrastando: boolean;
  /** É NESTA fresta que o bloco arrastado cai se soltarem agora? */
  readonly alvo: boolean;
  onAcrescentar(tipo: TipoDeCelula, fresta: number): void;
  onEntrarComArraste(indice: number): void;
  onSoltar(indice: number): void;
}

export function Fresta({
  indice, arrastando, alvo, onAcrescentar, onEntrarComArraste, onSoltar,
}: FrestaProps) {
  return (
    <Box
      data-fresta={indice}
      onDragOver={(e: React.DragEvent) => {
        // Sem o `preventDefault` o navegador recusa a soltura — é o jeito de
        // dizer "aqui pode".
        if (!arrastando) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onEntrarComArraste(indice);
      }}
      onDrop={(e: React.DragEvent) => {
        if (!arrastando) return;
        e.preventDefault();
        onSoltar(indice);
      }}
      sx={{
        position: 'relative',
        // Alta o bastante para o mouse acertar sem mirar, baixa o bastante para
        // dez delas não empurrarem o caderno para fora da tela.
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        // Parada, a fresta só se revela sob o mouse. Arrastando, os botões
        // somem — o que ela oferece ali é cair, não acrescentar.
        '& .acoes': { opacity: 0, transition: 'opacity 90ms' },
        '&:hover .acoes': { opacity: arrastando ? 0 : 1 },
        '& .linha': {
          opacity: alvo ? 1 : 0,
          bgcolor: 'primary.main',
          // Em **px**, e não `1` e `2`: no sistema do MUI, medida entre 0 e 1
          // vira porcentagem, então `height: 1` pintava a fresta INTEIRA de
          // âmbar em vez de riscar uma linha. Visto no navegador.
          height: alvo ? '2px' : '1px',
        },
        '&:hover .linha': { opacity: arrastando ? 1 : 0.35 },
      }}
    >
      <Box
        className="linha"
        // O indicador não recebe ponteiro: se recebesse, entrar nele contaria
        // como sair da fresta e o arraste piscaria.
        sx={{ position: 'absolute', left: 8, right: 8, pointerEvents: 'none', transition: 'opacity 90ms' }}
      />
      <Box className="acoes" sx={{ display: 'flex', gap: 1, zIndex: 1 }}>
        <Botao rotulo="Add Code" onClick={() => onAcrescentar('sql', indice)} />
        <Botao rotulo="Add Markdown" onClick={() => onAcrescentar('markdown', indice)} />
      </Box>
    </Box>
  );
}

function Botao({ rotulo, onClick }: { readonly rotulo: string; readonly onClick: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        border: 0,
        bgcolor: 'background.paper',
        color: 'primary.main',
        font: 'inherit',
        fontSize: 10.5,
        px: 0.75,
        borderRadius: 0.5,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {rotulo}
    </Box>
  );
}
