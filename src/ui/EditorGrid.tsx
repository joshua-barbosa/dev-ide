// Desenha o arranjo dos grupos de editor.
//
// A árvore de `shared/layout-editor.ts` vira flexbox aninhado: divisão
// `horizontal` é uma linha, `vertical` é uma coluna, e cada folha é um
// `EditorGroup`. Recursivo porque o modelo é recursivo — e é o que permite
// dividir de novo dentro de um lado já dividido.
//
// Não decide nada: recebe a árvore, uma função que monta o grupo e uma que
// avisa quando uma fronteira foi arrastada. Toda a política — o que pode
// dividir, onde o novo entra, o que colapsa, o mínimo de uma fatia — mora no
// módulo puro, testada sem navegador.
import { useRef } from 'react';
import Box from '@mui/material/Box';
import { tamanhosDe, type NoDeLayout, type Orientacao } from '../shared/layout-editor';

export interface EditorGridProps {
  readonly layout: NoDeLayout;
  /** Monta o conteúdo de um grupo. O grid não sabe o que tem dentro. */
  readonly grupo: (numero: number) => React.ReactNode;
  /**
   * Uma fronteira foi arrastada (T021).
   *
   * `caminho` são os índices da raiz até a divisão; `indice` é a fronteira
   * dentro dela; `fracao` é quanto o filho da ESQUERDA (ou de cima) passa a
   * ocupar do par. Quem apara no mínimo é o módulo puro.
   */
  readonly onRedimensionar?: (
    caminho: readonly number[],
    indice: number,
    fracao: number
  ) => void;
  /** Só na raiz: o caminho de cada nível é montado descendo. */
  readonly caminho?: readonly number[];
}

export function EditorGrid({ layout, grupo, onRedimensionar, caminho = [] }: EditorGridProps) {
  if (layout.tipo === 'grupo') return <>{grupo(layout.grupo)}</>;

  const tamanhos = tamanhosDe(layout);

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
        <Box key={chaveDe(filho, i)} sx={{ display: 'contents' }}>
          {i > 0 && (
            <Divisor
              orientacao={layout.orientacao}
              rotulo={`Redimensionar a divisão ${i}`}
              fracaoInicial={tamanhos[i - 1] ?? 0}
              onArrastar={(fracao) => onRedimensionar?.(caminho, i - 1, fracao)}
            />
          )}
          <Box
            data-fatia={i}
            sx={{
              // A fração vem do MODELO. `flex: 1 1 0` para todos daria partes
              // iguais e ignoraria o que ele arrastou.
              flex: `0 0 ${(tamanhos[i] ?? 1 / layout.filhos.length) * 100}%`,
              display: 'flex',
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <EditorGrid
              layout={filho}
              grupo={grupo}
              onRedimensionar={onRedimensionar}
              caminho={[...caminho, i]}
            />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/**
 * A fronteira arrastável entre dois irmãos (T021).
 *
 * Quatro pixels, com a cor só sob o mouse — como a alça de coluna da spec 062.
 * Os ouvintes vão na `window`, e não no elemento: o mouse ultrapassa a alça no
 * primeiro movimento rápido, e ouvir só nela faria o arraste parar sozinho. É
 * a mesma lição de `useLarguras`.
 */
function Divisor({
  orientacao, rotulo, fracaoInicial, onArrastar,
}: {
  readonly orientacao: Orientacao;
  readonly rotulo: string;
  /** Quanto o vizinho da esquerda (ou de cima) ocupa HOJE, de 0 a 1. */
  readonly fracaoInicial: number;
  onArrastar(fracaoDoPrimeiro: number): void;
}) {
  const arraste = useRef<{ inicio: number; total: number } | null>(null);
  const horizontal = orientacao === 'horizontal';

  const comecar = (e: React.MouseEvent): void => {
    e.preventDefault();
    // A régua é a DIVISÃO que contém este divisor. `closest` em vez de subir
    // dois `parentElement`: o `display: contents` do meio é detalhe de
    // desenho, e amarrar a conta a ele quebraria na primeira mudança de HTML.
    const caixa = (e.currentTarget as HTMLElement).closest('[data-divisao]');
    const retangulo = caixa?.getBoundingClientRect();
    const total = retangulo === undefined ? 0 : horizontal ? retangulo.width : retangulo.height;
    if (total === 0) return;
    arraste.current = { inicio: horizontal ? e.clientX : e.clientY, total };

    const mover = (ev: MouseEvent): void => {
      const atual = arraste.current;
      if (atual === null) return;
      const delta = (horizontal ? ev.clientX : ev.clientY) - atual.inicio;
      onArrastar(fracaoInicial + delta / atual.total);
    };
    const soltar = (): void => {
      arraste.current = null;
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
      document.body.style.userSelect = '';
    };
    // Sem isto o arraste seleciona o texto do editor por baixo.
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  };

  return (
    <Box
      data-divisor={orientacao}
      role="separator"
      aria-label={rotulo}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      onMouseDown={comecar}
      sx={{
        flex: '0 0 4px',
        cursor: horizontal ? 'col-resize' : 'row-resize',
        bgcolor: 'divider',
        '&:hover': { bgcolor: 'primary.main' },
        zIndex: 1,
      }}
    />
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
