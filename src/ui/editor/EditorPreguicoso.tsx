// A fronteira entre o primeiro desenho e o Monaco (P7, spec 101).
//
// O `index.js` da IDE tinha 5,7 MB num arquivo só, e quase tudo era o Monaco.
// O navegador precisava baixar, analisar e executar os 5,7 MB inteiros antes
// de pintar QUALQUER pixel — inclusive a árvore de arquivos, o painel de
// conexões e a barra de status, que não têm nada a ver com o editor de texto.
//
// Aqui o Monaco vira um pedaço à parte, carregado enquanto o resto da tela já
// está de pé.
//
// **Por que isto não quebra a fachada imperativa.** O `useGruposDeEditor` já
// sabia lidar com um editor que chega DEPOIS: o registro conta
// `setVersaoDosEditores`, e o efeito que carrega a aba tem escrito, desde a
// spec 025, *"o editor do grupo ainda não existe: NÃO marca como carregada e
// sai. O contador de editores traz o efeito de volta assim que ele nascer"*.
// Isso nasceu para a divisão de tela remontar editores, e é exatamente a
// mesma situação. Sem essa peça pronta, esta troca teria sido perigosa.
import { forwardRef, lazy, Suspense } from 'react';
import Box from '@mui/material/Box';
import { tokens } from '../theme';
import type { EditorHandle, EditorHostProps } from './EditorHost';

const Real = lazy(async () => ({ default: (await import('./EditorHost')).EditorHost }));

/**
 * O que ocupa o lugar enquanto o Monaco não chegou.
 *
 * Um retângulo com a cor do fundo do editor e mais nada: qualquer texto ou
 * animação aqui apareceria e sumiria em fração de segundo na máquina dele, o
 * que é pior que não aparecer — pisca sem informar.
 */
function Espera() {
  return <Box sx={{ flex: 1, minHeight: 0, bgcolor: tokens.bgEditor }} />;
}

export const EditorPreguicoso = forwardRef<EditorHandle, EditorHostProps>(
  function EditorPreguicoso(props, ref) {
    return (
      <Suspense fallback={<Espera />}>
        <Real ref={ref} {...props} />
      </Suspense>
    );
  }
);
