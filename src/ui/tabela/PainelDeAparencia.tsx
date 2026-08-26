// O `👁` da barra de comando: como a grade se parece (spec 062, fase E · D56).
//
// O que NÃO está aqui, e por quê: `Font Size` e `Font Family`. A IDE já tem as
// duas chaves no `config.json` desde a spec 011, e uma segunda fonte da mesma
// verdade é o defeito, não a feature — mudar a fonte aqui e no arquivo daria
// duas respostas para a mesma pergunta.
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import { Icon } from '../Icon';
import {
  ALTURA_MAXIMA, ALTURA_MINIMA, PASSO_DA_ALTURA, comAltura,
  type Alinhamento, type Aparencia, type Borda,
} from '../../shared/grade/aparencia';

export interface PainelDeAparenciaProps {
  readonly ancora: HTMLElement | null;
  readonly aparencia: Aparencia;
  readonly onMudar: (nova: Aparencia) => void;
  readonly onFechar: () => void;
  /** Volta ao padrão. Sem isto, um ajuste ruim não teria desfazer. */
  readonly onPadrao: () => void;
}

const ALINHAMENTOS: readonly { readonly valor: Alinhamento; readonly rotulo: string }[] = [
  { valor: 'auto', rotulo: 'Auto' },
  { valor: 'esquerda', rotulo: 'Esquerda' },
  { valor: 'centro', rotulo: 'Centro' },
  { valor: 'direita', rotulo: 'Direita' },
];

const BORDAS: readonly { readonly valor: Borda; readonly rotulo: string }[] = [
  { valor: 'nenhuma', rotulo: 'Nenhuma' },
  { valor: 'horizontal', rotulo: 'Horizontal' },
  { valor: 'vertical', rotulo: 'Vertical' },
  { valor: 'todas', rotulo: 'Todas' },
];

export function PainelDeAparencia({
  ancora, aparencia, onMudar, onFechar, onPadrao,
}: PainelDeAparenciaProps) {
  return (
    <Popover
      open={ancora !== null}
      anchorEl={ancora}
      onClose={onFechar}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Box data-painel-de-aparencia sx={{ p: 1.5, minWidth: 280, fontSize: 12 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Box sx={{ fontWeight: 600 }}>Aparência da grade</Box>
          <Box sx={{ flex: 1 }} />
          <Box
            component="button"
            type="button"
            aria-label="Voltar ao padrão"
            title="Voltar ao padrão"
            onClick={onPadrao}
            sx={{
              border: 1, borderColor: 'divider', bgcolor: 'transparent', color: 'text.secondary',
              p: 0.4, borderRadius: 0.5, display: 'flex', cursor: 'pointer',
            }}
          >
            <Icon name="lucide:rotate-ccw" size={13} />
          </Box>
        </Box>

        <Linha rotulo="Altura da linha">
          <Passo
            rotulo="Diminuir a altura da linha"
            icone="lucide:minus"
            desabilitada={aparencia.alturaDaLinha <= ALTURA_MINIMA}
            onClick={() => onMudar(comAltura(aparencia, aparencia.alturaDaLinha - PASSO_DA_ALTURA))}
          />
          <Box data-altura-da-linha sx={{ minWidth: 34, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {aparencia.alturaDaLinha}
          </Box>
          <Passo
            rotulo="Aumentar a altura da linha"
            icone="lucide:plus"
            desabilitada={aparencia.alturaDaLinha >= ALTURA_MAXIMA}
            onClick={() => onMudar(comAltura(aparencia, aparencia.alturaDaLinha + PASSO_DA_ALTURA))}
          />
        </Linha>

        <Linha rotulo="Número da linha">
          <Interruptor
            rotulo="Número da linha"
            ligado={aparencia.numeroDaLinha}
            onMudar={(v) => onMudar({ ...aparencia, numeroDaLinha: v })}
          />
        </Linha>

        <Linha rotulo="Coluna de controle">
          <Interruptor
            rotulo="Coluna de controle"
            ligado={aparencia.colunaDeControle}
            onMudar={(v) => onMudar({ ...aparencia, colunaDeControle: v })}
          />
        </Linha>

        <Escolha
          rotulo="Alinhamento"
          opcoes={ALINHAMENTOS}
          atual={aparencia.alinhamento}
          onEscolher={(v) => onMudar({ ...aparencia, alinhamento: v })}
        />
        <Escolha
          rotulo="Borda"
          opcoes={BORDAS}
          atual={aparencia.borda}
          onEscolher={(v) => onMudar({ ...aparencia, borda: v })}
        />

        <Box sx={{ mt: 1, color: 'text.secondary', fontSize: 10.5 }}>
          Vale para esta aba. Fonte e tamanho ficam no <code>config.json</code>.
        </Box>
      </Box>
    </Popover>
  );
}

function Linha({ rotulo, children }: { readonly rotulo: string; readonly children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
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
    <Box sx={{ py: 0.5 }}>
      <Box sx={{ color: 'text.secondary', mb: 0.5 }}>{rotulo}</Box>
      <Box role="radiogroup" aria-label={rotulo} sx={{ display: 'flex', gap: 0.5 }}>
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
              font: 'inherit', fontSize: 11, py: 0.3, borderRadius: 0.5, cursor: 'pointer',
            }}
          >
            {o.rotulo}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Interruptor({
  rotulo, ligado, onMudar,
}: {
  readonly rotulo: string;
  readonly ligado: boolean;
  readonly onMudar: (v: boolean) => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      onClick={() => onMudar(!ligado)}
      sx={{
        width: 32, height: 18, borderRadius: 9, border: 1, cursor: 'pointer', p: 0,
        borderColor: ligado ? 'primary.main' : 'divider',
        bgcolor: ligado ? 'primary.main' : 'transparent',
        display: 'flex', alignItems: 'center',
        justifyContent: ligado ? 'flex-end' : 'flex-start',
      }}
    >
      <Box
        sx={{
          width: 12, height: 12, borderRadius: '50%', mx: '2px',
          bgcolor: ligado ? 'background.default' : 'text.secondary',
        }}
      />
    </Box>
  );
}

function Passo({
  rotulo, icone, onClick, desabilitada,
}: {
  readonly rotulo: string;
  readonly icone: string;
  readonly onClick: () => void;
  readonly desabilitada: boolean;
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
        p: 0.3, borderRadius: 0.5, display: 'flex',
        cursor: desabilitada ? 'default' : 'pointer', opacity: desabilitada ? 0.35 : 1,
      }}
    >
      <Icon name={icone} size={12} />
    </Box>
  );
}
