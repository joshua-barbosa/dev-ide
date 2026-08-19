// Desenha o arranjo dos grupos de editor.
//
// A árvore de `shared/layout-editor.ts` vira flexbox aninhado: divisão
// `horizontal` é uma linha, `vertical` é uma coluna, e cada folha é um
// `EditorGroup`. Recursivo porque o modelo é recursivo — e é o que permite
// dividir de novo dentro de um lado já dividido.
//
// Não decide nada: recebe a árvore e uma função que monta o grupo. Toda a
// política (o que pode dividir, onde o novo entra, o que colapsa) mora no módulo
// puro, testada sem navegador.
import Box from '@mui/material/Box';
import type { NoDeLayout } from '../shared/layout-editor';

export interface EditorGridProps {
  readonly layout: NoDeLayout;
  /** Monta o conteúdo de um grupo. O grid não sabe o que tem dentro. */
  readonly grupo: (numero: number) => React.ReactNode;
}

export function EditorGrid({ layout, grupo }: EditorGridProps) {
  if (layout.tipo === 'grupo') return <>{grupo(layout.grupo)}</>;

  return (
    <Box
      data-divisao={layout.orientacao}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: layout.orientacao === 'horizontal' ? 'row' : 'column',
        // Os dois mínimos, e não um: sem eles um filho com conteúdo largo
        // (uma linha longa, uma tabela) empurra o irmão para fora em vez de
        // rolar dentro de si.
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {layout.filhos.map((filho, i) => (
        <Box
          key={chaveDe(filho, i)}
          sx={{
            // Partes iguais: `flex: 1` sozinho usa o conteúdo como base e faz o
            // lado com mais texto nascer maior.
            flex: '1 1 0',
            display: 'flex',
            minWidth: 0,
            minHeight: 0,
            // A divisa entre irmãos, do lado certo conforme a orientação.
            ...(i === 0
              ? {}
              : layout.orientacao === 'horizontal'
                ? { borderLeft: 1, borderColor: 'divider' }
                : { borderTop: 1, borderColor: 'divider' }),
          }}
        >
          <EditorGrid layout={filho} grupo={grupo} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * Chave estável para o React.
 *
 * O número do grupo identifica a folha; uma divisão usa os grupos que ela
 * contém. Usar o índice sozinho faria o React reaproveitar o nó errado ao
 * remover um lado — e, com ele, a instância do editor de dentro.
 */
function chaveDe(no: NoDeLayout, indice: number): string {
  if (no.tipo === 'grupo') return `g${no.grupo}`;
  return `d${indice}:${gruposEmTexto(no)}`;
}

function gruposEmTexto(no: NoDeLayout): string {
  return no.tipo === 'grupo' ? String(no.grupo) : no.filhos.map(gruposEmTexto).join('-');
}
