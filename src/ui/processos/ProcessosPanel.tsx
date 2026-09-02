// A lista de processos do servidor (spec 047).
//
// É a tela que salva o dia: uma query travou, a tabela está trancada, e é
// preciso descobrir qual e matá-la.
//
// **Recarregar é manual, de propósito.** Uma consulta a cada segundo contra um
// banco de produção é ruído que a IDE criaria sozinha. Quem está caçando um
// processo travado aperta recarregar; quem não está, não paga nada.
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import type { ProcessoDoBanco } from '../../shared/contracts';

export interface ProcessosPanelProps {
  /** `null` = este banco não tem o conceito. Diferente de lista vazia. */
  readonly processos: readonly ProcessoDoBanco[] | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly podeMatar: boolean;
  onRecarregar(): void;
  onMatar(processo: ProcessoDoBanco): void;
  /** Segundos entre atualizações automáticas; `0` = desligada (T069). */
  readonly intervalo: number;
  onIntervalo(segundos: number): void;
  /** Os marcados para o kill em lote (T071). */
  readonly marcados: ReadonlySet<string>;
  onMarcar(ids: ReadonlySet<string>): void;
  onMatarLote(): void;
}

/**
 * As cadências oferecidas.
 *
 * Começa em 2s, e não em 1s: a lista de processos é uma consulta ao banco DELE,
 * e a diferença entre um e dois segundos não muda o que se enxerga — mas dobra
 * o que se pesa no servidor.
 */
const CADENCIAS: readonly { readonly valor: number; readonly rotulo: string }[] = [
  { valor: 0, rotulo: 'desligada' },
  { valor: 2, rotulo: '2s' },
  { valor: 5, rotulo: '5s' },
  { valor: 10, rotulo: '10s' },
  { valor: 30, rotulo: '30s' },
];

/** `2h 13m`, `4m 02s`, `37s` — o que se lê de relance. */
function duracao(segundos: number | null): string {
  if (segundos === null) return '';
  if (segundos < 60) return `${segundos}s`;
  const m = Math.floor(segundos / 60);
  if (m < 60) return `${m}m ${String(segundos % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function ProcessosPanel({
  processos, carregando, erro, podeMatar, onRecarregar, onMatar,
  intervalo, onIntervalo, marcados, onMarcar, onMatarLote,
}: ProcessosPanelProps) {
  /** Os que dá para marcar: a conexão da própria IDE fica de fora. */
  const matáveis = (processos ?? []).filter((p) => !p.euMesmo);
  const todosMarcados = matáveis.length > 0 && matáveis.every((p) => marcados.has(p.id));
  return (
    <Box
      sx={{
        flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
        bgcolor: tokens.bgEditor,
      }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5,
          borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper',
          fontSize: 11, color: 'text.secondary', flexShrink: 0,
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label="Recarregar os processos"
          onClick={onRecarregar}
          sx={{
            border: 0, bgcolor: 'transparent', color: 'inherit', p: 0.4, borderRadius: 0.5,
            display: 'flex', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Icon name="lucide:refresh-cw" size={13} />
        </Box>
        <Box component="span" data-total-processos>
          {processos === null ? '' : `${processos.length} processo(s)`}
          {carregando ? ' · carregando…' : ''}
        </Box>
        {/* A cadência da atualização automática (T069). */}
        {processos !== null && (
          <Box
            component="select"
            data-cadencia
            aria-label="Atualizar sozinho"
            value={String(intervalo)}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onIntervalo(Number(e.target.value))
            }
            sx={{
              bgcolor: 'transparent', color: 'inherit', font: 'inherit', fontSize: 11,
              border: 1, borderColor: 'divider', borderRadius: 0.5, px: 0.5, py: '1px',
            }}
          >
            {CADENCIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.valor === 0 ? 'sem atualizar' : `a cada ${c.rotulo}`}
              </option>
            ))}
          </Box>
        )}

        {/* O kill em lote (T071). Só aparece com algo marcado — um botão
            vermelho permanente numa tela de produção é um convite ao acidente. */}
        {podeMatar && marcados.size > 0 && (
          <Box
            component="button"
            type="button"
            data-matar-lote
            onClick={onMatarLote}
            sx={{
              border: 1, borderColor: 'error.main', bgcolor: 'transparent',
              color: 'error.main', font: 'inherit', fontSize: 11, cursor: 'pointer',
              px: 0.75, py: '1px', borderRadius: 0.5,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            Matar {marcados.size} marcado(s)
          </Box>
        )}

        {!podeMatar && processos !== null && (
          <Box component="span" sx={{ ml: 'auto' }}>
            somente-leitura: matar processo está desligado
          </Box>
        )}
      </Box>

      {erro !== null ? (
        <Aviso texto={erro} erro />
      ) : processos === null ? (
        <Aviso texto="Este banco não tem processos: ele é um arquivo, não um servidor." />
      ) : processos.length === 0 ? (
        <Aviso texto="Nenhum processo." />
      ) : (
        <Grade
          processos={processos}
          podeMatar={podeMatar}
          onMatar={onMatar}
          marcados={marcados}
          todosMarcados={todosMarcados}
          onMarcar={onMarcar}
          matáveis={matáveis}
        />
      )}
    </Box>
  );
}

function Grade({
  processos, podeMatar, onMatar, marcados, todosMarcados, onMarcar, matáveis,
}: {
  readonly processos: readonly ProcessoDoBanco[];
  readonly podeMatar: boolean;
  onMatar(processo: ProcessoDoBanco): void;
  readonly marcados: ReadonlySet<string>;
  readonly todosMarcados: boolean;
  onMarcar(ids: ReadonlySet<string>): void;
  readonly matáveis: readonly ProcessoDoBanco[];
}) {
  const alternar = (id: string): void => {
    const proximo = new Set(marcados);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    onMarcar(proximo);
  };
  return (
    <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      <Box
        component="table"
        sx={{
          borderCollapse: 'collapse', width: '100%',
          fontFamily: tokens.fontMono, fontSize: 11.5,
          '& th, & td': {
            borderBottom: 1, borderColor: 'divider', px: 1, py: '3px',
            textAlign: 'left', whiteSpace: 'nowrap',
          },
          '& thead th': {
            position: 'sticky', top: 0, bgcolor: 'background.paper',
            color: 'text.secondary', fontWeight: 600,
          },
        }}
      >
        <thead>
          <tr>
            {podeMatar && (
              <th>
                {/* Marcar todos de uma vez — menos a conexão da própria IDE,
                    que não é matável e por isso nem entra na conta. */}
                <Box
                  component="input"
                  type="checkbox"
                  data-marcar-todos
                  aria-label="Marcar todos os processos"
                  checked={todosMarcados}
                  onChange={() =>
                    onMarcar(todosMarcados ? new Set() : new Set(matáveis.map((p) => p.id)))
                  }
                  sx={{ cursor: 'pointer' }}
                />
              </th>
            )}
            {['Id', 'Usuário', 'Banco', 'Comando', 'Estado', 'Tempo', 'SQL'].map((c) => (
              <th key={c}>{c}</th>
            ))}
            {podeMatar && <th>Ação</th>}
          </tr>
        </thead>
        <tbody>
          {processos.map((p) => (
            <Box
              component="tr"
              key={p.id}
              data-processo={p.id}
              // A conexão da própria IDE aparece na lista como qualquer outra, e
              // matá-la derrubaria a sessão. Marcada, não escondida: esconder
              // faria a contagem não bater com o que o banco diz.
              sx={p.euMesmo ? { bgcolor: 'action.selected' } : undefined}
            >
              {podeMatar && (
                <td>
                  {/* A conexão da IDE não ganha caixa: marcá-la para o lote
                      derrubaria a própria sessão no meio da operação. */}
                  {p.euMesmo ? null : (
                    <Box
                      component="input"
                      type="checkbox"
                      data-marcar={p.id}
                      aria-label={`Marcar o processo ${p.id}`}
                      checked={marcados.has(p.id)}
                      onChange={() => alternar(p.id)}
                      sx={{ cursor: 'pointer' }}
                    />
                  )}
                </td>
              )}
              <td>{p.id}</td>
              <td>{p.usuario ?? ''}</td>
              <td>{p.banco ?? ''}</td>
              <td>{p.comando ?? ''}</td>
              <td>{p.estado ?? ''}</td>
              <td>{duracao(p.segundos)}</td>
              <Box
                component="td"
                title={p.sql ?? ''}
                sx={{ maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {p.sql ?? ''}
              </Box>
              {podeMatar && (
                <td>
                  {p.euMesmo ? (
                    <Tooltip title="Esta é a conexão da própria IDE" placement="left" describeChild>
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        (a IDE)
                      </Box>
                    </Tooltip>
                  ) : (
                    <Box
                      component="button"
                      type="button"
                      aria-label={`Matar o processo ${p.id}`}
                      onClick={() => onMatar(p)}
                      sx={{
                        border: 0, bgcolor: 'transparent', color: 'error.main',
                        font: 'inherit', fontSize: 11, cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      matar
                    </Box>
                  )}
                </td>
              )}
            </Box>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function Aviso({ texto, erro = false }: { readonly texto: string; readonly erro?: boolean }) {
  return (
    <Box
      data-aviso-processos
      sx={{
        p: 1.75, color: erro ? 'error.main' : 'text.secondary', fontSize: 12,
        whiteSpace: 'pre-wrap', fontFamily: erro ? tokens.fontMono : 'inherit',
      }}
    >
      {texto}
    </Box>
  );
}
