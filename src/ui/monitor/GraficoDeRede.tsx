// O gráfico de rede no tempo (spec 056).
//
// SVG à mão, e não uma biblioteca de gráficos. São duas linhas e seis pontos: o
// pacote mais leve que faria isso pesa mais que a IDE inteira em disco, e o
// Artigo III pede que dependência nova se justifique. Esta não se justificaria.
import Box from '@mui/material/Box';
import { tokens } from '../theme';

export interface PontoDeRede {
  readonly quando: number;
  /** Bytes por segundo. */
  readonly recebido: number;
  readonly enviado: number;
}

const ALTURA = 120;
const LARGURA = 1000;
const RECEBIDO = '#7bc86c';
const ENVIADO = '#4a9eff';

function escalaCurta(bytesPorSegundo: number): string {
  if (bytesPorSegundo < 1024) return `${Math.round(bytesPorSegundo)}B`;
  const u = ['KB', 'MB', 'GB'];
  let v = bytesPorSegundo / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}${u[i]}`;
}

function caminho(pontos: readonly PontoDeRede[], valor: (p: PontoDeRede) => number, teto: number): string {
  if (pontos.length === 0) return '';
  const passo = pontos.length === 1 ? 0 : LARGURA / (pontos.length - 1);
  return pontos
    .map((p, i) => {
      const y = ALTURA - (teto <= 0 ? 0 : (valor(p) / teto) * ALTURA);
      return `${i === 0 ? 'M' : 'L'} ${(i * passo).toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function GraficoDeRede({ pontos }: { readonly pontos: readonly PontoDeRede[] }) {
  // O teto acompanha o maior valor, com um piso de 1 KB/s: sem o piso, um
  // servidor parado desenharia ruído de poucos bytes como se fosse um pico.
  const maior = Math.max(1024, ...pontos.flatMap((p) => [p.recebido, p.enviado]));

  return (
    <Box
      data-grafico-de-rede
      sx={{ border: 1, borderColor: 'divider', borderRadius: 0.5, p: 1, position: 'relative' }}
    >
      <Box
        sx={{
          display: 'flex', gap: 1.5, justifyContent: 'center', mb: 0.5,
          fontSize: 10, color: 'text.secondary',
        }}
      >
        <Legenda cor={RECEBIDO} texto="recebido" />
        <Legenda cor={ENVIADO} texto="enviado" />
      </Box>
      <Box
        component="svg"
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        preserveAspectRatio="none"
        sx={{ width: '100%', height: ALTURA, display: 'block' }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={LARGURA}
            y1={ALTURA * f}
            y2={ALTURA * f}
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeWidth={1}
          />
        ))}
        <path d={caminho(pontos, (p) => p.recebido, maior)} fill="none" stroke={RECEBIDO} strokeWidth={2} />
        <path d={caminho(pontos, (p) => p.enviado, maior)} fill="none" stroke={ENVIADO} strokeWidth={2} />
      </Box>
      <Box
        sx={{
          display: 'flex', justifyContent: 'space-between', mt: 0.25,
          fontFamily: tokens.fontMono, fontSize: 9.5, color: 'text.secondary',
        }}
      >
        <Box>{escalaCurta(maior)}/s</Box>
        <Box>
          {pontos.length === 0
            ? 'medindo…'
            : new Date(pontos[pontos.length - 1]?.quando ?? 0).toLocaleTimeString('pt-BR')}
        </Box>
      </Box>
    </Box>
  );
}

function Legenda({ cor, texto }: { readonly cor: string; readonly texto: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: 18, height: 8, bgcolor: cor, borderRadius: 0.5 }} />
      {texto}
    </Box>
  );
}
