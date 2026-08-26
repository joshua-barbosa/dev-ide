// Grade de resultados.
//
// Um só componente para todos os drivers: como `QueryResult` é o mesmo formato
// para SQL, chave-valor e documento, a grade não sabe de qual banco vieram as
// linhas.
//
// Paridade apenas nesta servidor-1 — paginação, ordenação, busca e edição de célula
// têm spec própria, e misturá-las aqui confundiria regressão com feature.
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import type { CellValue, QueryResult } from '../../shared/contracts';
import { tokens } from '../theme';
import { Icon } from '../Icon';
import { useLarguras } from '../tabela/useLarguras';
import { larguraDoConteudo } from '../../shared/grade/larguras';

/** Ver a nota da aba de tabela: estas duas não se arrastam. */
const LARGURA_DO_NUMERO = 44;
const POR_CARACTERE = 12 * 0.6;
const POR_CARACTERE_DO_TIPO = 10 * 0.6;

export interface ResultGridProps {
  readonly resultado: QueryResult | null;
  readonly erro?: string | null;
  readonly carregando?: boolean;
  readonly rotulo?: string;
  /** Interrompe a consulta em andamento (T005). */
  readonly parar?: () => void;
}

export function ResultGrid({
  resultado, erro = null, carregando = false, rotulo, parar,
}: ResultGridProps) {
  // Antes de qualquer `return`: gancho não pode viver depois de saída
  // condicional, e as três abaixo são exatamente isso.
  const larguras = useLarguras();
  const automaticas = useMemo(() => {
    const cols = resultado?.columns ?? [];
    const rs = resultado?.rows ?? [];
    return Object.fromEntries(
      cols.map((c, j) => [
        c.name,
        Math.max(
          larguraDoConteudo([c.name, ...rs.map((l) => String(l[j] ?? ''))], POR_CARACTERE),
          larguraDoConteudo([c.type ?? ''], POR_CARACTERE_DO_TIPO)
        ),
      ])
    );
  }, [resultado]);
  const larguraDe = (coluna: string): number =>
    larguras.larguraDe(coluna) ?? automaticas[coluna] ?? 120;

  if (carregando) {
    return (
      <Box
        sx={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 1.5,
          p: 1.75, color: 'text.secondary', fontSize: 12,
        }}
      >
        <span>executando…</span>
        {parar !== undefined && (
          <Box
            component="button"
            type="button"
            aria-label="Parar esta consulta"
            onClick={parar}
            sx={{
              border: 1, borderColor: 'error.main', bgcolor: 'transparent',
              color: 'error.main', font: 'inherit', fontSize: 11,
              px: 1, py: 0.25, borderRadius: 0.5, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 0.5,
            }}
          >
            <Icon name="lucide:square" size={11} />
            Parar
          </Box>
        )}
      </Box>
    );
  }
  if (erro !== null) return <Mensagem texto={erro} erro />;
  if (resultado === null) return <Mensagem texto="Execute uma consulta para ver o resultado." />;

  const { columns, rows, rowCount, durationMs, truncated, message } = resultado;

  return (
    // `minWidth: 0` pelo mesmo motivo da aba de tabela — ver a nota na spec 062.
    <Box
      data-grade-de-resultado
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column',
        minHeight: 0, minWidth: 0, bgcolor: tokens.bgEditor,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.25,
          py: 0.6,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          color: 'text.secondary',
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        <span>
          {rotulo === undefined ? '' : `${rotulo} · `}
          {rowCount} linha(s) · {durationMs}ms
        </span>
        {truncated && (
          // Explícito de propósito: confundir o corte com o total real da tabela
          // seria um erro caro.
          <Box component="span" sx={{ color: 'primary.main' }}>
            ⚠ resultado cortado no limite de linhas
          </Box>
        )}
      </Box>

      {columns.length === 0 ? (
        <Mensagem texto={message ?? 'Comando executado.'} />
      ) : (
        <Box data-grade sx={{ flex: 1, overflow: 'auto', minHeight: 0, minWidth: 0 }}>
          <Box
            component="table"
            sx={{
              // A mesma decisão da aba de tabela (spec 062, fase C): arranjo
              // fixo com largura somada, porque `fixed` com largura automática
              // não vale nada. E o teto de 420 virou largura INICIAL.
              borderCollapse: 'collapse',
              tableLayout: 'fixed',
              width:
                LARGURA_DO_NUMERO +
                columns.reduce((soma, c) => soma + larguraDe(c.name), 0),
              fontFamily: tokens.fontMono,
              fontSize: 12,
              '& th, & td': {
                borderRight: 1,
                borderBottom: 1,
                borderColor: 'divider',
                px: 1,
                py: '3px',
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
              '& thead th': {
                position: 'sticky',
                top: 0,
                bgcolor: 'background.paper',
                zIndex: 1,
              },
            }}
          >
            <colgroup>
              <col style={{ width: LARGURA_DO_NUMERO }} />
              {columns.map((coluna, i) => (
                <col key={`${coluna.name}-${i}`} style={{ width: larguraDe(coluna.name) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <Box component="th" sx={{ bgcolor: 'background.paper' }} />
                {columns.map((coluna, i) => (
                  <Box
                    component="th"
                    key={`${coluna.name}-${i}`}
                    data-coluna={coluna.name}
                    sx={{ position: 'relative' }}
                  >
                    <Box>{coluna.name}</Box>
                    {coluna.type !== undefined && (
                      <Box sx={{ color: 'text.secondary', fontSize: 10, fontWeight: 400 }}>
                        {coluna.type}
                      </Box>
                    )}
                    <Box
                      aria-hidden
                      data-alca={coluna.name}
                      onMouseDown={(e: React.MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        larguras.comecar(coluna.name, e.clientX, larguraDe(coluna.name));
                      }}
                      onDoubleClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        larguras.ajustar(
                          coluna.name,
                          [coluna.name, ...rows.map((l) => String(l[i] ?? ''))],
                          POR_CARACTERE
                        );
                      }}
                      sx={{
                        position: 'absolute', top: 0, right: 0, width: 8, height: '100%',
                        cursor: 'col-resize', zIndex: 2,
                        '&:hover': { bgcolor: 'primary.main' },
                      }}
                    />
                  </Box>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((linha, i) => (
                <tr key={i}>
                  <Box
                    component="td"
                    sx={{
                      color: 'text.secondary',
                      bgcolor: 'background.paper',
                      textAlign: 'right',
                      userSelect: 'none',
                    }}
                  >
                    {i + 1}
                  </Box>
                  {linha.map((valor, j) => (
                    <Celula key={j} valor={valor} />
                  ))}
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function Celula({ valor }: { readonly valor: CellValue }) {
  const nulo = valor === null;
  return (
    <Box
      component="td"
      title={nulo ? 'NULL' : String(valor)}
      // Clicar copia: o caso mais comum é levar um id para a próxima consulta.
      onClick={() => void navigator.clipboard?.writeText(nulo ? '' : String(valor))}
      sx={{
        cursor: 'pointer',
        color: nulo ? 'text.secondary' : 'text.primary',
        fontStyle: nulo ? 'italic' : 'normal',
        '&:hover': { bgcolor: 'action.hover' },
        '&:active': { bgcolor: 'primary.main', color: 'background.default' },
      }}
    >
      {nulo ? 'NULL' : String(valor)}
    </Box>
  );
}

function Mensagem({ texto, erro = false }: { readonly texto: string; readonly erro?: boolean }) {
  return (
    <Box
      sx={{
        flex: 1,
        p: 1.75,
        bgcolor: tokens.bgEditor,
        color: erro ? 'error.main' : 'text.secondary',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        fontFamily: erro ? tokens.fontMono : 'inherit',
      }}
    >
      {texto}
    </Box>
  );
}
