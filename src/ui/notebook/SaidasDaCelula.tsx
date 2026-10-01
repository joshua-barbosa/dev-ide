// O que uma célula do notebook produziu, desenhado EMBAIXO dela (spec 112).
//
// Como no Jupyter, e não em abas de Results como o sqlbook: o notebook é para
// ler de cima a baixo, com o dado ao lado do código que o produziu.
//
// A tabela é a MESMA grade da IDE (lupa, busca, CSV/JSON) — uma grade só,
// pela lição da spec 070: duas grades é o mesmo erro duas vezes.
import { memo } from 'react';
import Box from '@mui/material/Box';
import { tokens } from '../theme';
import { ResultGrid } from '../grid/ResultGrid';
import type { QueryResult } from '../../shared/contracts';
import type { Saida } from '../../shared/notebook/modelo';

/**
 * Altura da grade dentro da célula: a das linhas, até um teto.
 *
 * Era fixa em 320 px, e duas linhas deixavam um vão maior que a própria
 * tabela — visto na captura da guarda. Barra + cabeçalho ≈ 80 px, linha ≈ 26.
 */
const ALTURA_MAXIMA_DA_TABELA = 360;
const alturaDaTabela = (linhas: number): number =>
  Math.min(ALTURA_MAXIMA_DA_TABELA, 84 + Math.max(1, linhas) * 26);

function comoResultado(s: Extract<Saida, { tipo: 'tabela' }>): QueryResult {
  return {
    columns: s.colunas.map((name) => ({ name })),
    rows: s.linhas,
    rowCount: s.total,
    durationMs: 0,
    truncated: s.total > s.linhas.length,
  };
}

function UmaSaida({ saida }: { readonly saida: Saida }) {
  switch (saida.tipo) {
    case 'tabela':
      return (
        <Box
          data-saida="tabela"
          sx={{
            height: alturaDaTabela(saida.linhas.length), display: 'flex', minHeight: 0,
            // A grade não é virtualizada (500 linhas inteiras no DOM): fora da
            // tela, o navegador pula o layout e a pintura dela. Seis tabelas
            // guardadas custavam ~85 ms a cada tecla em outra célula.
            contentVisibility: 'auto',
            containIntrinsicSize: `auto ${alturaDaTabela(saida.linhas.length)}px`,
          }}
        >
          <ResultGrid
            resultado={comoResultado(saida)}
            rotulo={
              saida.total > saida.linhas.length
                ? `${saida.linhas.length} de ${saida.total} linhas`
                : undefined
            }
          />
        </Box>
      );
    case 'texto':
      return (
        <Box
          component="pre"
          data-saida={saida.fluxo === 'erro' ? 'stderr' : 'stdout'}
          sx={{
            m: 0, px: 1.5, py: 0.75, fontFamily: tokens.fontMono, fontSize: 12,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            color: saida.fluxo === 'erro' ? 'error.main' : 'text.primary',
          }}
        >
          {saida.texto}
        </Box>
      );
    case 'erro':
      return (
        <Box
          data-saida="erro"
          sx={{
            px: 1.5, py: 0.75, fontFamily: tokens.fontMono, fontSize: 12,
            whiteSpace: 'pre-wrap', color: 'error.main',
            borderLeft: 2, borderColor: 'error.main',
          }}
        >
          {saida.mensagem}
        </Box>
      );
    case 'imagem':
      return (
        <Box sx={{ px: 1.5, py: 0.75 }}>
          <Box
            component="img"
            data-saida="imagem"
            alt="imagem produzida pela célula"
            src={`data:${saida.mime};base64,${saida.dados}`}
            sx={{ maxWidth: '100%' }}
          />
        </Box>
      );
    default:
      return null;
  }
}

/**
 * Redesenha só quando as saídas DESTA célula mudam. Sem o `memo`, cada tecla
 * em qualquer célula redesenhava todas as grades do notebook — com 6 tabelas
 * de 500 linhas, 1,5 s por tecla (relato de 01/10: "fica lento de editar").
 * O modelo é imutável: editar outra célula preserva este array.
 */
export const SaidasDaCelula = memo(function SaidasDaCelula({ saidas }: { readonly saidas: readonly Saida[] }) {
  if (saidas.length === 0) return null;
  return (
    <Box data-saidas sx={{ borderTop: 1, borderColor: 'divider' }}>
      {saidas.map((s, i) => (
        <UmaSaida key={i} saida={s} />
      ))}
    </Box>
  );
});
