// A aba de uma chave de chave-valor (spec 089).
//
// Ele em 03/09/2026: *"não abre as informações dentro da chave... nada"*. Esta
// é a tela que faltava.
//
// Duas divisórias, como na ferramenta que ele usa: `Data`, com o valor, e
// `Status`, com o estado do servidor. O terminal já existe como aba própria —
// duplicá-lo aqui seria uma segunda verdade sobre a mesma sessão.
import { Fragment, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { Icon } from '../Icon';
import { valorLegivel } from '../../shared/chaves/valor-legivel';
import { tokens } from '../theme';
import { useChave } from './useChave';
import { EstadoDoServidor } from './EstadoDoServidor';
import { prazoLegivel, tamanhoLegivel } from '../../shared/sql/redis-chave';

export interface ChaveHostProps {
  readonly conexaoId: string;
  readonly chave: string;
  readonly somenteLeitura: boolean;
}

export function ChaveHost({ conexaoId, chave, somenteLeitura }: ChaveHostProps) {
  const [divisoria, setDivisoria] = useState<'dados' | 'estado'>('dados');
  const c = useChave(conexaoId, chave);

  return (
    <Box
      data-aba-de-chave={chave}
      sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ display: 'flex', gap: 0.5, px: 1, py: 0.5, borderBottom: `1px solid ${tokens.border}` }}>
        {(['dados', 'estado'] as const).map((qual) => (
          <Button
            key={qual}
            size="small"
            onClick={() => setDivisoria(qual)}
            sx={{
              minWidth: 0, px: 1, fontSize: 12, textTransform: 'none',
              color: divisoria === qual ? 'text.primary' : 'text.secondary',
              borderBottom: divisoria === qual ? '2px solid' : '2px solid transparent',
              borderRadius: 0,
            }}
          >
            {qual === 'dados' ? 'Data' : 'Status'}
          </Button>
        ))}
      </Box>

      {divisoria === 'estado' ? (
        <EstadoDoServidor conexaoId={conexaoId} />
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 1, gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {c.valor !== null && (
              <Chip size="small" label={c.valor.tipo} sx={{ fontSize: 11, height: 20 }} />
            )}
            <Box sx={{ fontSize: 12, fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {chave}
            </Box>
            {c.valor?.bytes !== undefined && (
              <Box sx={{ fontSize: 11, color: 'text.secondary' }}>
                Size: {tamanhoLegivel(c.valor.bytes)}
              </Box>
            )}
            <TextField
              size="small"
              label="TTL"
              value={c.prazo}
              onChange={(e) => c.definirPrazo(e.target.value)}
              disabled={somenteLeitura}
              placeholder="sem prazo"
              helperText={c.valor === null ? undefined : prazoLegivel(c.valor.ttl)}
              sx={{ width: 130, '& input': { fontSize: 12 } }}
            />
            <Button
              size="small"
              startIcon={<Icon name="lucide:save" size={13} />}
              onClick={() => void c.salvar()}
              disabled={somenteLeitura || c.valor === null}
              sx={{ textTransform: 'none', fontSize: 12 }}
            >
              Save
            </Button>
            <Button
              size="small"
              onClick={() => void c.recarregar()}
              sx={{ minWidth: 0, px: 0.5 }}
              aria-label="Recarregar a chave"
            >
              <Icon name="lucide:refresh-cw" size={13} />
            </Button>
          </Box>

          {c.erro !== null && (
            <Box role="alert" sx={{ color: 'error.main', fontSize: 12 }}>{c.erro}</Box>
          )}

          {c.carregando ? (
            <Box sx={{ fontSize: 12, color: 'text.secondary' }}>Lendo a chave…</Box>
          ) : c.valor === null ? null : c.valor.forma === 'texto' ? (
            <TextField
              multiline
              value={c.rascunho}
              onChange={(e) => c.definirRascunho(e.target.value)}
              disabled={somenteLeitura}
              slotProps={{ htmlInput: { 'data-valor-da-chave': chave } }}
              sx={{
                flex: 1, minHeight: 0,
                '& .MuiInputBase-root': { height: '100%', alignItems: 'flex-start', p: 1 },
                '& textarea': { height: '100% !important', overflow: 'auto !important', fontFamily: 'monospace', fontSize: 12 },
              }}
            />
          ) : (
            <Grade valor={c.valor} />
          )}
        </Box>
      )}
    </Box>
  );
}

/** Coleção: uma linha por elemento, e o corte DITO quando houve corte. */
function Grade({ valor }: { readonly valor: NonNullable<ReturnType<typeof useChave>['valor']> }) {
  // Qual linha está aberta. Uma por vez: duas abertas empurram a terceira para
  // fora da tela, e o gesto vira rolagem em vez de leitura.
  const [aberta, setAberta] = useState<number | null>(null);
  const colunas = valor.colunas ?? [];

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <Box component="thead">
          <Box component="tr">
            {colunas.map((coluna) => (
              <Box
                key={coluna}
                component="th"
                sx={{
                  textAlign: 'left', px: 1.25, py: 0.75, position: 'sticky', top: 0,
                  bgcolor: tokens.bgEditor, borderBottom: `1px solid ${tokens.border}`,
                  fontWeight: 600,
                }}
              >
                {coluna}
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {(valor.linhas ?? []).map((linha, i) => (
            <Fragment key={i}>
              <Box
                component="tr"
                onClick={() => setAberta((atual) => (atual === i ? null : i))}
                sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
              >
                {linha.map((celula, j) => (
                  <Box
                    key={j}
                    component="td"
                    sx={{
                      px: 1.25, py: 0.4, fontFamily: 'monospace',
                      borderBottom: `1px solid ${tokens.border}`,
                      maxWidth: 900, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    title="Clique para abrir o valor inteiro"
                  >
                    {celula}
                  </Box>
                ))}
              </Box>
              {aberta === i && (
                // O valor INTEIRO, com recuo quando é JSON. Antes só havia o
                // `title` do navegador, que mostra uma linha só e some sozinho.
                <Box component="tr">
                  <Box
                    component="td"
                    colSpan={Math.max(1, colunas.length)}
                    sx={{ p: 0, borderBottom: `1px solid ${tokens.border}` }}
                  >
                    <Box
                      component="pre"
                      data-valor-aberto
                      sx={{
                        m: 0, px: 1.5, py: 1, fontFamily: 'monospace', fontSize: 12,
                        bgcolor: tokens.bgEditor, whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word', maxHeight: 420, overflow: 'auto',
                      }}
                    >
                      {valorLegivel(linha[linha.length - 1] ?? '').texto}
                    </Box>
                  </Box>
                </Box>
              )}
            </Fragment>
          ))}
        </Box>
      </Box>
      {valor.cortado && (
        <Box data-corte sx={{ p: 1, fontSize: 11, color: 'warning.main' }}>
          Mostrando {valor.linhas?.length ?? 0} de {valor.total} — a leitura foi cortada
          para não travar a tela.
        </Box>
      )}
    </Box>
  );
}
