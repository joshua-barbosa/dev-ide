// `HostMonitor` sobre SSH (spec 056).
//
// Quarta e última capacidade da spec 005 a ser exercida — e a que mais precisou
// mudar de forma. O `HostMetrics` original tinha sete números soltos; a tela do
// usuário mostra CPU repartida, top de processos e tráfego de rede, e nada disso
// cabia ali. O contrato mudou LÁ, e não foi contornado aqui.
//
// **Uma ida ao servidor por amostra.** Sete comandos separados seriam sete
// viagens de rede a cada segundo, e a soma delas — não os comandos — é o que
// pesaria no servidor de alguém.
import {
  lerCarga,
  lerCpu,
  lerDisco,
  lerMemoria,
  lerProcessos,
  lerRede,
  lerUptime,
  usoDeCpu,
  type AmostraDeCpu,
} from './ssh-metricas';
import type { ComandoRemoto, HostMetrics, HostMonitor } from '../types';

const SEP = '@@dev-ide@@';

/**
 * Tudo numa linha só.
 *
 * `2>/dev/null` em cada pedaço: um servidor sem `/proc/net/dev` (contêiner
 * mínimo, BSD) devolve vazio naquela seção e o resto continua chegando. Sem
 * isso, uma seção que falha derruba a amostra inteira.
 */
const COMANDO = [
  'cat /proc/stat 2>/dev/null | head -1',
  `echo ${SEP}`,
  'cat /proc/meminfo 2>/dev/null | head -5',
  `echo ${SEP}`,
  'df -P -k / 2>/dev/null',
  `echo ${SEP}`,
  'cat /proc/uptime 2>/dev/null',
  `echo ${SEP}`,
  'cat /proc/loadavg 2>/dev/null',
  `echo ${SEP}`,
  'ps -eo pid,user:20,pcpu,pmem,rss,args --sort=-pmem 2>/dev/null | head -11',
  `echo ${SEP}`,
  'cat /proc/net/dev 2>/dev/null',
].join('; ');

export function criarMonitorRemoto(
  executar: (comando: string) => Promise<ComandoRemoto>
): HostMonitor {
  // A amostra anterior de CPU, para a diferença. Vive aqui porque é da SESSÃO:
  // duas abas do mesmo servidor devem ver o mesmo número, e não uma cada.
  let anterior: AmostraDeCpu | null = null;

  return {
    sample: async (): Promise<HostMetrics> => {
      const { stdout } = await executar(COMANDO);
      const [stat = '', meminfo = '', df = '', uptime = '', loadavg = '', ps = '', netdev = ''] =
        stdout.split(SEP);

      const agora = lerCpu(stat);
      const cpu = anterior !== null && agora !== null ? usoDeCpu(anterior, agora) : null;
      if (agora !== null) anterior = agora;

      return {
        // Na PRIMEIRA amostra `cpu` é `null`, e é a verdade: porcentagem exige
        // duas leituras. A tela mostra "—" em vez de um zero convincente.
        cpu,
        memoria: lerMemoria(meminfo),
        disco: lerDisco(df),
        uptimeSegundos: lerUptime(uptime),
        carga: lerCarga(loadavg),
        processos: lerProcessos(ps),
        rede: lerRede(netdev),
      };
    },
  };
}
