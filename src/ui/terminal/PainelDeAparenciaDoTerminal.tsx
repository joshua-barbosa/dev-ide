// A aparência de UM terminal (T086 · spec 058).
//
// O motivo dele, textual: *"eu posso querer ter uma visão diferente para cada
// terminal na hora, se eu tenho N terminais abertos, eu posso querer
// diferenciar de algum jeito"*.
//
// Isso é marcação, não configuração — e é por isso que some no F5 e herda o
// `config.json` em vez de substituí-lo. A "segunda verdade" que eu temia só
// existiria se isto persistisse.
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import { Icon } from '../Icon';
import {
  ESTILOS_DE_CURSOR, FONTE_MAXIMA, FONTE_MINIMA, HERDA_TUDO, foiMexida,
  type AparenciaDoTerminal,
} from '../../shared/terminal/aparencia';

/** Aparado aqui TAMBÉM, para o botão desabilitar na parede em vez de só não
 *  ter efeito — `resolverAparencia` já apara, mas o usuário não vê isso. */
const naFaixa = (n: number): number => Math.min(FONTE_MAXIMA, Math.max(FONTE_MINIMA, n));

export interface PainelDeAparenciaDoTerminalProps {
  readonly ancora: HTMLElement | null;
  readonly aparencia: AparenciaDoTerminal;
  readonly onMudar: (nova: AparenciaDoTerminal) => void;
  readonly onFechar: () => void;
}

const SCROLLBACKS = [1_000, 5_000, 20_000, 100_000];

export function PainelDeAparenciaDoTerminal({
  ancora, aparencia, onMudar, onFechar,
}: PainelDeAparenciaDoTerminalProps) {
  return (
    <Popover
      open={ancora !== null}
      anchorEl={ancora}
      onClose={onFechar}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Box data-aparencia-do-terminal sx={{ p: 1.25, minWidth: 260, fontSize: 12 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Box sx={{ fontWeight: 600 }}>Aparência deste terminal</Box>
          <Box sx={{ flex: 1 }} />
          <Box
            component="button"
            type="button"
            aria-label="Voltar a herdar as preferências"
            title="Voltar a herdar as preferências"
            disabled={!foiMexida(aparencia)}
            onClick={() => onMudar(HERDA_TUDO)}
            sx={{
              border: 1, borderColor: 'divider', bgcolor: 'transparent',
              color: 'text.secondary', p: 0.35, borderRadius: 0.5, display: 'flex',
              cursor: foiMexida(aparencia) ? 'pointer' : 'default',
              opacity: foiMexida(aparencia) ? 1 : 0.35,
            }}
          >
            <Icon name="lucide:rotate-ccw" size={12} />
          </Box>
        </Box>

        <Linha rotulo="Fonte">
          <Passo
            rotulo="Diminuir a fonte deste terminal"
            icone="lucide:minus"
            desabilitada={(aparencia.fontSize ?? 13) <= FONTE_MINIMA}
            onClick={() =>
              onMudar({ ...aparencia, fontSize: naFaixa((aparencia.fontSize ?? 13) - 1) })
            }
          />
          <Box data-fonte-do-terminal sx={{ minWidth: 28, textAlign: 'center' }}>
            {aparencia.fontSize ?? 'herda'}
          </Box>
          <Passo
            rotulo="Aumentar a fonte deste terminal"
            icone="lucide:plus"
            desabilitada={(aparencia.fontSize ?? 13) >= FONTE_MAXIMA}
            onClick={() =>
              onMudar({ ...aparencia, fontSize: naFaixa((aparencia.fontSize ?? 13) + 1) })
            }
          />
        </Linha>

        <Escolha
          rotulo="Cursor"
          opcoes={ESTILOS_DE_CURSOR.map((e) => ({
            valor: e ?? 'block',
            rotulo: e === 'block' ? 'Bloco' : e === 'underline' ? 'Traço' : 'Barra',
          }))}
          atual={aparencia.cursorStyle ?? 'block'}
          onEscolher={(v) => onMudar({ ...aparencia, cursorStyle: v })}
        />

        <Linha rotulo="Cursor piscando">
          <Box
            component="button"
            type="button"
            role="switch"
            aria-checked={aparencia.cursorBlink ?? true}
            aria-label="Cursor piscando"
            onClick={() => onMudar({ ...aparencia, cursorBlink: !(aparencia.cursorBlink ?? true) })}
            sx={{
              width: 32, height: 18, borderRadius: 9, border: 1, cursor: 'pointer', p: 0,
              borderColor: (aparencia.cursorBlink ?? true) ? 'primary.main' : 'divider',
              bgcolor: (aparencia.cursorBlink ?? true) ? 'primary.main' : 'transparent',
              display: 'flex', alignItems: 'center',
              justifyContent: (aparencia.cursorBlink ?? true) ? 'flex-end' : 'flex-start',
            }}
          >
            <Box
              sx={{
                width: 12, height: 12, borderRadius: '50%', mx: '2px',
                bgcolor: (aparencia.cursorBlink ?? true) ? 'background.default' : 'text.secondary',
              }}
            />
          </Box>
        </Linha>

        <Escolha
          rotulo="Histórico (linhas)"
          opcoes={SCROLLBACKS.map((n) => ({ valor: String(n), rotulo: n.toLocaleString('pt-BR') }))}
          atual={String(aparencia.scrollback ?? 5_000)}
          onEscolher={(v) => onMudar({ ...aparencia, scrollback: Number(v) })}
        />

        <Box sx={{ mt: 1, color: 'text.secondary', fontSize: 10.5, lineHeight: 1.4 }}>
          Vale só para este terminal e some ao recarregar. O padrão de todos fica
          no <code>config.json</code>.
        </Box>
      </Box>
    </Popover>
  );
}

function Linha({ rotulo, children }: { readonly rotulo: string; readonly children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.4 }}>
      <Box sx={{ flex: 1, color: 'text.secondary' }}>{rotulo}</Box>
      {children}
    </Box>
  );
}

function Escolha<T extends string>({
  rotulo, opcoes, atual, onEscolher,
}: {
  readonly rotulo: string;
  readonly opcoes: readonly { readonly valor: T; readonly rotulo: string }[];
  readonly atual: T;
  readonly onEscolher: (v: T) => void;
}) {
  return (
    <Box sx={{ py: 0.4 }}>
      <Box sx={{ color: 'text.secondary', mb: 0.4 }}>{rotulo}</Box>
      <Box role="radiogroup" aria-label={rotulo} sx={{ display: 'flex', gap: 0.4 }}>
        {opcoes.map((o) => (
          <Box
            key={o.valor}
            component="button"
            type="button"
            role="radio"
            aria-checked={atual === o.valor}
            aria-label={`${rotulo}: ${o.rotulo}`}
            onClick={() => onEscolher(o.valor)}
            sx={{
              flex: 1, border: 1,
              borderColor: atual === o.valor ? 'primary.main' : 'divider',
              bgcolor: 'transparent',
              color: atual === o.valor ? 'primary.main' : 'text.secondary',
              font: 'inherit', fontSize: 10.5, py: 0.25, borderRadius: 0.5, cursor: 'pointer',
            }}
          >
            {o.rotulo}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Passo({
  rotulo, icone, onClick, desabilitada = false,
}: {
  readonly rotulo: string;
  readonly icone: string;
  readonly onClick: () => void;
  readonly desabilitada?: boolean;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      disabled={desabilitada}
      onClick={onClick}
      sx={{
        border: 1, borderColor: 'divider', bgcolor: 'transparent', color: 'inherit',
        p: 0.25, borderRadius: 0.5, display: 'flex',
        cursor: desabilitada ? 'default' : 'pointer', opacity: desabilitada ? 0.35 : 1,
      }}
    >
      <Icon name={icone} size={11} />
    </Box>
  );
}
