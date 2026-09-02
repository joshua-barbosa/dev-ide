// A trilha acima do editor (T075).
//
// Pasta › arquivo › classe › método. Num arquivo de oitocentas linhas, saber
// que se está dentro de `TabelaHost › carregarPagina` é a diferença entre
// navegar e rolar.
//
// A conta mora em `shared/breadcrumb.ts` e é testada sem navegador; aqui é só o
// desenho e o clique.
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { trilha } from '../../shared/breadcrumb';
import { iconeDeArquivo } from '../../shared/editor/arquivos';
import type { SimboloDaTrilha } from '../../shared/breadcrumb';

export interface BreadcrumbProps {
  /** `null` esconde a trilha — aba de terminal, grade, formulário. */
  readonly caminho: string | null;
  readonly raiz: string;
  readonly simbolos: readonly SimboloDaTrilha[];
  readonly linha: number;
  /** Pula para a linha do símbolo clicado. */
  onIrParaLinha(linha: number): void;
}

/** O ícone de cada degrau. Pasta e arquivo têm os seus; símbolo usa o do tipo. */
const ICONE_DO_TIPO: Readonly<Record<string, string>> = {
  pasta: 'lucide:folder',
  class: 'lucide:box',
  interface: 'lucide:box',
  enum: 'lucide:box',
  function: 'lucide:square-function',
  method: 'lucide:square-function',
  const: 'lucide:variable',
  variable: 'lucide:variable',
  object: 'lucide:braces',
};

export function Breadcrumb({
  caminho, raiz, simbolos, linha, onIrParaLinha,
}: BreadcrumbProps) {
  if (caminho === null) return null;

  const degraus = trilha(caminho, raiz, simbolos, linha);
  if (degraus.length === 0) return null;

  return (
    <Box
      data-breadcrumb
      sx={{
        display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 0.25,
        px: 1, py: 0.3, fontSize: 11, color: 'text.secondary',
        borderBottom: 1, borderColor: 'divider', bgcolor: tokens.bgEditor,
        // Caminho longo rola em vez de quebrar a linha: a trilha tem de ocupar
        // sempre a mesma altura, senão o editor pula quando ela cresce.
        overflowX: 'auto', whiteSpace: 'nowrap', flexShrink: 0,
        '&::-webkit-scrollbar': { height: 0 },
      }}
    >
      {degraus.map((d, i) => (
        <Box key={`${d.tipo}-${d.rotulo}-${i}`} sx={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && (
            <Box sx={{ opacity: 0.5, display: 'flex', mx: 0.1 }}>
              <Icon name="lucide:chevron-right" size={11} />
            </Box>
          )}
          <Box
            component={d.linha === undefined ? 'span' : 'button'}
            type={d.linha === undefined ? undefined : 'button'}
            data-degrau={d.rotulo}
            onClick={d.linha === undefined ? undefined : () => onIrParaLinha(d.linha as number)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.35,
              border: 0, bgcolor: 'transparent', color: 'inherit', font: 'inherit',
              px: 0.35, borderRadius: 0.5,
              // Só o degrau de SÍMBOLO clica: pasta não tem para onde levar
              // dentro do arquivo, e um cursor de mão que não faz nada mente.
              cursor: d.linha === undefined ? 'default' : 'pointer',
              ...(d.linha === undefined
                ? {}
                : { '&:hover': { bgcolor: 'action.hover', color: 'text.primary' } }),
            }}
          >
            <Icon
              name={
                d.tipo === 'arquivo'
                  ? iconeDeArquivo(caminho)
                  : (ICONE_DO_TIPO[d.tipo] ?? 'lucide:circle-small')
              }
              size={11}
            />
            {d.rotulo}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
