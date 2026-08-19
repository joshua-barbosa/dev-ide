// Painel inferior: Output, Problems e Terminal.
//
// Substituiu o `OutputPanel` de 43 linhas com altura fixa de 160 px, sempre
// visível mesmo vazio, sem abas e com uma ação só. Ele também recebia **apenas**
// a execução de código — erro de driver e falha de conexão não passavam por ele,
// apesar de se chamar "saída". A aba `Problems` nasceu dessa observação.
//
// **Não há `Debug Console`** de propósito: pressupõe depurador, e a IDE decidiu
// não ter um. Ver `product.md`.
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { Icon } from './Icon';
import { tokens } from './theme';
import type { LinhaSaida } from './useExecution';
import { ABAS_DO_PAINEL, type AbaDoPainel, type Problema } from '../shared/painel';
import { paresDe, type EstadoDeTerminais } from '../shared/terminais';

export interface AcoesDoPainel {
  readonly onLimpar: () => void;
  readonly onAbrirNoEditor: () => void;
  readonly onSalvarComo: () => void;
  readonly onLimparProblemas: () => void;
  readonly onNovoTerminal: () => void;
  readonly onDividirTerminal: () => void;
  readonly onFecharTerminal: (id: string) => void;
  readonly onAtivarTerminal: (id: string) => void;
  readonly onEsconder: () => void;
}

export interface BottomPanelProps extends AcoesDoPainel {
  readonly aba: AbaDoPainel;
  readonly onAba: (aba: AbaDoPainel) => void;
  readonly altura: number;
  readonly linhas: readonly LinhaSaida[];
  readonly status: { readonly texto: string; readonly erro: boolean };
  readonly problemas: readonly Problema[];
  readonly terminais: EstadoDeTerminais;
  /** Conteúdo dos terminais, montado por fora — ver a nota sobre desmontar. */
  readonly children?: React.ReactNode;
}

function horaDe(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR');
}

export function BottomPanel({
  aba, onAba, altura, linhas, status, problemas, terminais, children,
  onLimpar, onAbrirNoEditor, onSalvarComo, onLimparProblemas,
  onNovoTerminal, onDividirTerminal, onFecharTerminal, onAtivarTerminal, onEsconder,
}: BottomPanelProps) {
  // Um item por PAR na lista lateral, com os panes dentro — é a unidade de
  // navegação, e o lado a lado é detalhe de layout dela.
  const pares = paresDe(terminais);
  const botao = (
    titulo: string,
    icone: string,
    aoClicar: () => void,
    rotulo = titulo
  ): React.ReactNode => (
    <Tooltip title={titulo} placement="top">
      <Button onClick={aoClicar} aria-label={rotulo} sx={{ minWidth: 26, px: 0.5 }}>
        <Icon name={icone} size={13} />
      </Button>
    </Tooltip>
  );

  return (
    <Box
      data-painel-inferior
      sx={{ height: altura, display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0 }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25,
          bgcolor: 'background.paper', borderTop: 1, borderBottom: 1, borderColor: 'divider',
          color: 'text.secondary', fontSize: 11, flexShrink: 0,
        }}
      >
        {ABAS_DO_PAINEL.map(([id, rotulo]) => (
          <Box
            key={id}
            role="tab"
            aria-selected={aba === id}
            data-aba-painel={id}
            onClick={() => onAba(id)}
            sx={{
              px: 1, py: 0.4, cursor: 'pointer', textTransform: 'uppercase',
              letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 0.5,
              borderBottom: '1px solid',
              borderBottomColor: aba === id ? 'primary.main' : 'transparent',
              color: aba === id ? 'text.primary' : 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {rotulo}
            {id === 'problems' && problemas.length > 0 && (
              <Box
                data-contagem-problemas
                sx={{
                  bgcolor: 'error.main', color: 'background.default', borderRadius: '8px',
                  px: 0.6, fontSize: 9, lineHeight: '14px', minWidth: 14, textAlign: 'center',
                }}
              >
                {problemas.length}
              </Box>
            )}
          </Box>
        ))}

        {aba === 'output' && (
          <Box data-status-execucao sx={{ ml: 1, color: status.erro ? 'error.main' : 'success.main' }}>
            {status.texto}
          </Box>
        )}

        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {aba === 'output' && (
            <>
              {botao('Abrir no editor', 'lucide:files', onAbrirNoEditor)}
              {botao('Salvar como…', 'lucide:save', onSalvarComo)}
              {botao('Limpar', 'lucide:trash-2', onLimpar, 'Limpar saída')}
            </>
          )}
          {aba === 'problems' && botao('Limpar', 'lucide:trash-2', onLimparProblemas, 'Limpar problemas')}
          {aba === 'terminal' && (
            <>
              {botao('Novo terminal', 'lucide:plus', onNovoTerminal)}
              {terminais.ativo !== null &&
                botao('Dividir terminal', 'lucide:columns-2', onDividirTerminal)}
              {terminais.ativo !== null &&
                botao('Fechar terminal', 'lucide:trash-2',
                  () => onFecharTerminal(terminais.ativo as string), 'Fechar terminal')}
            </>
          )}
          {botao('Esconder o painel (Ctrl+J)', 'lucide:x', onEsconder, 'Esconder o painel')}
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {aba === 'output' && (
          <Box
            component="pre"
            data-output
            sx={{
              flex: 1, m: 0, p: 1.25, overflow: 'auto', bgcolor: tokens.bgEditor,
              fontFamily: tokens.fontMono, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}
          >
            {linhas.map((linha, i) => (
              <Box key={i} component="span" sx={{ color: linha.erro ? 'error.main' : 'text.primary' }}>
                {linha.texto}
              </Box>
            ))}
          </Box>
        )}

        {aba === 'problems' && (
          <Box data-problemas sx={{ flex: 1, overflow: 'auto', bgcolor: tokens.bgEditor, py: 0.5 }}>
            {problemas.length === 0 ? (
              <Box sx={{ px: 1.25, color: 'text.secondary', fontSize: 11 }}>
                Nenhum problema.
              </Box>
            ) : (
              problemas.map((p) => (
                <Box
                  key={p.id}
                  data-problema
                  sx={{
                    display: 'flex', gap: 1, px: 1.25, py: 0.4, fontSize: 12,
                    fontFamily: tokens.fontMono, alignItems: 'baseline',
                  }}
                >
                  <Box sx={{ color: 'error.main', flexShrink: 0 }}>{p.origem}</Box>
                  <Box sx={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' }}>{p.mensagem}</Box>
                  <Box sx={{ color: 'text.secondary', fontSize: 10, flexShrink: 0 }}>
                    {horaDe(p.quando)}
                  </Box>
                </Box>
              ))
            )}
          </Box>
        )}

        {aba === 'terminal' && (
          <>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', bgcolor: tokens.bgEditor }}>
              {terminais.lista.length === 0 ? (
                <Box sx={{ p: 1.25, color: 'text.secondary', fontSize: 11 }}>
                  Nenhum terminal aberto — use o ＋ acima.
                </Box>
              ) : (
                children
              )}
            </Box>

            {terminais.lista.length > 0 && (
              // Lista à direita, como no VS Code: alternar sem perder de vista o
              // que está rodando nos outros.
              <Box
                sx={{
                  width: 150, flexShrink: 0, borderLeft: 1, borderColor: 'divider',
                  overflow: 'auto', bgcolor: 'background.paper', py: 0.5,
                }}
              >
                {pares.map((panes) =>
                  panes.map((t, i) => (
                    <Box
                      key={t.id}
                      data-terminal-item={t.titulo}
                      aria-selected={terminais.ativo === t.id}
                      onClick={() => onAtivarTerminal(t.id)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 0.75, py: 0.4,
                        // Panes do mesmo par entram recuados, com um traço à
                        // esquerda: é o que mostra que dividem a tela.
                        pl: panes.length > 1 && i > 0 ? 2 : 1,
                        pr: 1,
                        fontSize: 11, cursor: 'pointer',
                        bgcolor: terminais.ativo === t.id ? 'action.selected' : 'transparent',
                        color: terminais.ativo === t.id ? 'text.primary' : 'text.secondary',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Icon
                        name={panes.length > 1 && i > 0 ? 'lucide:corner-down-right' : 'lucide:square-terminal'}
                        size={12}
                      />
                      <Box sx={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        {t.titulo}
                      </Box>
                    </Box>
                  ))
                )}
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
