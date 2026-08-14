// Grade de resultados.
//
// Um só componente para todos os drivers: como `QueryResult` é o mesmo formato
// para SQL, chave-valor e documento, a grade não sabe de qual banco vieram as
// linhas.
//
// Paridade apenas nesta servidor-1 — paginação, ordenação, busca e edição de célula
// têm spec própria, e misturá-las aqui confundiria regressão com feature.
import Box from '@mui/material/Box';
import type { CellValue, QueryResult } from '../../shared/contracts';
import { tokens } from '../theme';

/** Largura máxima de coluna, para um BLOB não empurrar a tabela inteira. */
const LARGURA_MAX = 420;

export interface ResultGridProps {
  readonly resultado: QueryResult | null;
  readonly erro?: string | null;
  readonly carregando?: boolean;
  readonly rotulo?: string;
}

export function ResultGrid({ resultado, erro = null, carregando = false, rotulo }: ResultGridProps) {
  if (carregando) return <Mensagem texto="executando…" />;
  if (erro !== null) return <Mensagem texto={erro} erro />;
  if (resultado === null) return <Mensagem texto="Execute uma consulta para ver o resultado." />;

  const { columns, rows, rowCount, durationMs, truncated, message } = resultado;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: tokens.bgEditor }}>
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
        <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <Box
            component="table"
            sx={{
              borderCollapse: 'collapse',
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
                maxWidth: LARGURA_MAX,
              },
              '& thead th': {
                position: 'sticky',
                top: 0,
                bgcolor: 'background.paper',
                zIndex: 1,
              },
            }}
          >
            <thead>
              <tr>
                <Box component="th" sx={{ bgcolor: 'background.paper' }} />
                {columns.map((coluna, i) => (
                  <th key={`${coluna.name}-${i}`}>
                    <Box>{coluna.name}</Box>
                    {coluna.type !== undefined && (
                      <Box sx={{ color: 'text.secondary', fontSize: 10, fontWeight: 400 }}>
                        {coluna.type}
                      </Box>
                    )}
                  </th>
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
