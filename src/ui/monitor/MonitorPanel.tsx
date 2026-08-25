// A sub-aba Monitor (spec 056).
//
// A tela que o usuário chama de `Server Status`: CPU, memória e disco em barras,
// o top de processos e o tráfego de rede no tempo.
//
// **Ela para de medir quando não está à vista.** A sub-aba escondida continua
// montada (emenda constitucional), e um relógio que sobrevive à troca de aba
// mediria um servidor que ninguém está olhando — a cada segundo, para sempre.
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { Api } from '../api';
import { tokens } from '../theme';
import { GraficoDeRede, type PontoDeRede } from './GraficoDeRede';
import type { HostMetrics } from '../../shared/contracts';

/** De quanto em quanto tempo. Um segundo é o que a ferramenta de referência usa. */
const INTERVALO_MS = 1_000;

/** Quantos pontos o gráfico guarda — seis segundos, como no print dele. */
const PONTOS = 6;

function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '--';
  // Arredondado: a TAXA de rede é uma divisão, e sem isto ela sai como
  // `265.748031496063 B/s`. Visto no navegador.
  if (n < 1024) return `${Math.round(n)} B`;
  const u = ['K', 'M', 'G', 'T'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(2) : Math.round(v)}${u[i]}`;
}

function porSegundo(n: number): string {
  return `${bytes(n)}/s`;
}

/** `37 days`, como no print — dias é a unidade em que se fala de servidor. */
function tempoDePe(segundos: number | null): string {
  if (segundos === null) return '--';
  const dias = Math.floor(segundos / 86_400);
  if (dias >= 1) return `${dias} dia${dias === 1 ? '' : 's'}`;
  const horas = Math.floor(segundos / 3_600);
  if (horas >= 1) return `${horas} h`;
  return `${Math.floor(segundos / 60)} min`;
}

export interface MonitorPanelProps {
  readonly conexaoId: string;
  /** Está à vista? Escondido, o monitor PARA — ver o cabeçalho. */
  readonly ativo: boolean;
  onErro(erro: unknown): void;
}

export function MonitorPanel({ conexaoId, ativo, onErro }: MonitorPanelProps) {
  const [metricas, setMetricas] = useState<HostMetrics | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [historico, setHistorico] = useState<readonly PontoDeRede[]>([]);
  const [ordem, setOrdem] = useState<'cpu' | 'mem'>('mem');
  // O contador anterior de rede: o `/proc/net/dev` conta desde o boot, e o que
  // interessa é a taxa. Num ref porque não desenha nada sozinho.
  const redeAnterior = useRef<{ rx: number; tx: number; quando: number } | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;

    const medir = async (): Promise<void> => {
      try {
        const m = await Api.metricasDoServidor(conexaoId);
        if (!vivo) return;
        setMetricas(m);
        setErro(null);

        if (m.rede !== null) {
          const agora = Date.now();
          const antes = redeAnterior.current;
          if (antes !== null) {
            const dt = (agora - antes.quando) / 1000;
            if (dt > 0) {
              setHistorico((h) =>
                [
                  ...h,
                  {
                    quando: agora,
                    // `max(0, …)`: um contador de 32 bits dá a volta, e a
                    // diferença negativa viraria um pico gigante para baixo.
                    recebido: Math.max(0, (m.rede!.recebidoBytes - antes.rx) / dt),
                    enviado: Math.max(0, (m.rede!.enviadoBytes - antes.tx) / dt),
                  },
                ].slice(-PONTOS)
              );
            }
          }
          redeAnterior.current = {
            rx: m.rede.recebidoBytes,
            tx: m.rede.enviadoBytes,
            quando: agora,
          };
        }
      } catch (e) {
        if (!vivo) return;
        setErro((e as Error).message);
      }
    };

    void medir();
    const relogio = setInterval(() => void medir(), INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, [ativo, conexaoId, onErro]);

  const processos = [...(metricas?.processos ?? [])].sort((a, b) =>
    ordem === 'cpu' ? b.cpu - a.cpu : b.memoria - a.memoria
  );

  return (
    <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, p: 1.5, bgcolor: tokens.bgEditor }}>
      {erro !== null && (
        <Box
          data-erro-monitor
          sx={{
            mb: 1.5, px: 1.25, py: 0.5, bgcolor: 'error.main',
            color: 'background.default', fontSize: 11,
          }}
        >
          {erro}
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, fontSize: 11.5 }}>
        <Box sx={{ ml: 'auto', color: 'text.secondary' }} data-uptime>
          Up {tempoDePe(metricas?.uptimeSegundos ?? null)}
          {metricas?.carga != null && ` · carga ${metricas.carga.join(' ')}`}
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5, mb: 1.5 }}>
        <Cartao
          titulo="CPU"
          marca="cpu"
          porcentagem={metricas?.cpu?.total ?? null}
          detalhe={
            metricas?.cpu == null
              ? 'medindo…'
              : `user ${metricas.cpu.usuario}% · sys ${metricas.cpu.sistema}% · iowait ${metricas.cpu.espera}%`
          }
        />
        <Cartao
          titulo="MEMORY"
          marca="memoria"
          porcentagem={metricas?.memoria?.porcentagem ?? null}
          detalhe={
            metricas?.memoria == null
              ? '--'
              : `${bytes(metricas.memoria.usadoBytes)} / ${bytes(metricas.memoria.totalBytes)}`
          }
        />
        <Cartao
          titulo="DISK"
          marca="disco"
          porcentagem={metricas?.disco?.porcentagem ?? null}
          detalhe={
            metricas?.disco == null
              ? '--'
              : `${bytes(metricas.disco.usadoBytes)} / ${bytes(metricas.disco.totalBytes)} · ${bytes(metricas.disco.livreBytes)} livres`
          }
        />
      </Box>

      <Painel titulo="TOP PROCESSES">
        <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
          {(['cpu', 'mem'] as const).map((qual) => (
            <Box
              key={qual}
              component="button"
              type="button"
              data-ordem={qual}
              onClick={() => setOrdem(qual)}
              sx={{
                border: 0, font: 'inherit', fontSize: 10, px: 0.75, py: 0.25, borderRadius: 0.5,
                cursor: 'pointer',
                bgcolor: ordem === qual ? 'action.selected' : 'transparent',
                color: ordem === qual ? 'primary.main' : 'text.secondary',
              }}
            >
              {qual.toUpperCase()}
            </Box>
          ))}
        </Box>
      </Painel>

      <Box sx={{ mb: 1.5, border: 1, borderColor: 'divider', borderRadius: 0.5 }}>
        <Grade cabecalho />
        {processos.map((p) => (
          <Grade key={p.pid} pid={p.pid}>
            <Box>{p.pid}</Box>
            <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.usuario}</Box>
            <Box>{p.cpu.toFixed(1)}</Box>
            <Box>{p.memoria.toFixed(1)}</Box>
            <Box>{bytes(p.rssBytes)}</Box>
            <Box
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={p.comando}
            >
              {p.comando}
            </Box>
          </Grade>
        ))}
        {processos.length === 0 && (
          <Box sx={{ p: 1.5, fontSize: 11.5, color: 'text.secondary' }}>medindo…</Box>
        )}
      </Box>

      <Painel titulo="NETWORK">
        <Box sx={{ display: 'flex', gap: 1.5, fontSize: 11, color: 'text.secondary' }}>
          <Box data-rede-taxa>
            ↓ {porSegundo(historico.at(-1)?.recebido ?? 0)} ↑{' '}
            {porSegundo(historico.at(-1)?.enviado ?? 0)}
          </Box>
          <Box sx={{ ml: 'auto' }}>
            Total ↓ {bytes(metricas?.rede?.recebidoBytes ?? null)} ↑{' '}
            {bytes(metricas?.rede?.enviadoBytes ?? null)}
          </Box>
        </Box>
      </Painel>
      <GraficoDeRede pontos={historico} />
    </Box>
  );
}

function Cartao({
  titulo, marca, porcentagem, detalhe,
}: {
  readonly titulo: string;
  readonly marca: string;
  readonly porcentagem: number | null;
  readonly detalhe: string;
}) {
  return (
    <Box
      data-cartao={marca}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 0.5, p: 1.25 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', mb: 0.75 }}>
        <Box sx={{ fontSize: 10.5, letterSpacing: 0.5, color: 'text.secondary' }}>{titulo}</Box>
        <Box
          data-valor={marca}
          sx={{ ml: 'auto', fontSize: 15, color: porcentagem === null ? 'text.secondary' : 'success.main' }}
        >
          {porcentagem === null ? '--' : `${porcentagem.toFixed(1)}%`}
        </Box>
      </Box>
      <Box sx={{ height: 4, bgcolor: 'action.hover', borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{
            height: '100%',
            width: `${porcentagem ?? 0}%`,
            bgcolor: (porcentagem ?? 0) > 85 ? 'error.main' : 'success.main',
            transition: 'width 400ms ease-out',
          }}
        />
      </Box>
      <Box sx={{ mt: 0.75, fontSize: 10.5, color: 'text.secondary' }}>{detalhe}</Box>
    </Box>
  );
}

function Painel({ titulo, children }: { readonly titulo: string; readonly children?: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, mb: 0.75,
        fontSize: 10.5, letterSpacing: 0.5, color: 'text.secondary',
      }}
    >
      {titulo}
      {children}
    </Box>
  );
}

const COLUNAS_DE_PROCESSO = '90px 150px 60px 60px 90px 1fr';

function Grade({
  children, cabecalho = false, pid,
}: {
  readonly children?: React.ReactNode;
  readonly cabecalho?: boolean;
  readonly pid?: number;
}) {
  return (
    <Box
      data-processo={pid}
      sx={{
        display: 'grid', gridTemplateColumns: COLUNAS_DE_PROCESSO, gap: 1, px: 1.25, py: 0.4,
        fontSize: 11.5,
        color: cabecalho ? 'text.secondary' : 'text.primary',
        borderBottom: cabecalho ? 1 : 0,
        borderColor: 'divider',
        fontFamily: cabecalho ? undefined : tokens.fontMono,
      }}
    >
      {cabecalho ? (
        <>
          <Box>PID</Box>
          <Box>USER</Box>
          <Box>CPU%</Box>
          <Box>MEM%</Box>
          <Box>RSS</Box>
          <Box>COMMAND</Box>
        </>
      ) : (
        children
      )}
    </Box>
  );
}
