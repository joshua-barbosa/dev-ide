// Ler a saúde de um servidor Linux (spec 056).
//
// Tudo aqui é **puro**: recebe texto, devolve número. Foi assim de propósito —
// medir servidor é uma sequência de contas em cima de formatos antigos e
// esquisitos, e cada uma delas erra em silêncio. Um `/proc/stat` mal somado não
// quebra nada: só mostra 3% de CPU num servidor a 90%.
//
// Os formatos foram conferidos contra um Debian 13 de verdade em 2026-08-24.

/** Uma amostra crua do `/proc/stat`, para a conta de porcentagem. */
export interface AmostraDeCpu {
  readonly total: number;
  readonly ocioso: number;
  readonly usuario: number;
  readonly sistema: number;
  readonly espera: number;
}

/**
 * A primeira linha do `/proc/stat`.
 *
 * `cpu  217976840 9742 33834639 2326511088 1337386 0 15493366 170468 0 0`
 *  user nice system idle iowait irq softirq steal guest guest_nice
 *
 * `idle` e `iowait` contam como ocioso: a CPU não está trabalhando em nenhum
 * dos dois. Somar `iowait` ao trabalho — engano comum — faz um servidor parado
 * esperando disco aparecer com 100% de uso.
 */
export function lerCpu(procStat: string): AmostraDeCpu | null {
  const linha = procStat.split('\n').find((l) => l.startsWith('cpu '));
  if (linha === undefined) return null;
  const n = linha
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
  if (n.length < 5) return null;

  const [usuario = 0, nice = 0, sistema = 0, idle = 0, iowait = 0] = n;
  return {
    total: n.reduce((a, b) => a + b, 0),
    ocioso: idle + iowait,
    usuario: usuario + nice,
    sistema,
    espera: iowait,
  };
}

export interface UsoDeCpu {
  readonly total: number;
  readonly usuario: number;
  readonly sistema: number;
  readonly espera: number;
}

/**
 * A porcentagem entre duas amostras.
 *
 * Uma amostra sozinha não diz nada: os números do `/proc/stat` são contadores
 * desde o boot. Uma leitura só daria a média da vida inteira do servidor —
 * que num servidor de 37 dias é sempre perto de zero.
 */
export function usoDeCpu(antes: AmostraDeCpu, agora: AmostraDeCpu): UsoDeCpu | null {
  const dTotal = agora.total - antes.total;
  // Contador que andou para trás ou não andou: reboot, ou duas leituras no
  // mesmo instante. Zero seria uma mentira convincente; `null` é a verdade.
  if (dTotal <= 0) return null;
  const pct = (delta: number): number =>
    Math.max(0, Math.min(100, Math.round((delta / dTotal) * 1000) / 10));
  return {
    total: pct(dTotal - (agora.ocioso - antes.ocioso)),
    usuario: pct(agora.usuario - antes.usuario),
    sistema: pct(agora.sistema - antes.sistema),
    espera: pct(agora.espera - antes.espera),
  };
}

export interface UsoDeMemoria {
  readonly totalBytes: number;
  readonly usadoBytes: number;
  readonly porcentagem: number;
}

/**
 * `/proc/meminfo`, em kB.
 *
 * Usa **`MemAvailable`**, e não `MemFree`. A diferença é enorme e é a razão de
 * este comentário existir: `MemFree` ignora cache e buffers, que o Linux
 * devolve na hora que alguém precisar. Num servidor com 16 GB, `MemFree` diz
 * 3,9 GB livres e `MemAvailable` diz 12,5 GB — e é o segundo que responde
 * "cabe mais alguma coisa aqui?". A ferramenta de referência usa o mesmo:
 * conferido contra o servidor do usuário, que ela mostra com 23,2%.
 */
export function lerMemoria(procMeminfo: string): UsoDeMemoria | null {
  const campo = (nome: string): number | null => {
    const m = new RegExp(`^${nome}:\\s+(\\d+)\\s*kB`, 'm').exec(procMeminfo);
    const valor = m?.[1];
    return valor === undefined ? null : Number(valor) * 1024;
  };
  const total = campo('MemTotal');
  const disponivel = campo('MemAvailable') ?? campo('MemFree');
  if (total === null || disponivel === null || total <= 0) return null;

  const usado = Math.max(0, total - disponivel);
  return {
    totalBytes: total,
    usadoBytes: usado,
    porcentagem: Math.round((usado / total) * 1000) / 10,
  };
}

export interface UsoDeDisco {
  readonly totalBytes: number;
  readonly usadoBytes: number;
  readonly livreBytes: number;
  readonly porcentagem: number;
}

/**
 * Uma linha de `df -P -k`.
 *
 * `-P` é obrigatório: sem ele, um ponto de montagem com nome longo quebra a
 * linha em duas e as colunas saem trocadas. `-k` fixa a unidade em kB, senão o
 * `df` escolhe sozinho e devolve `39G` como texto.
 */
export function lerDisco(saidaDoDf: string): UsoDeDisco | null {
  const linha = saidaDoDf
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('Filesystem'))
    .pop();
  if (linha === undefined) return null;

  const partes = linha.split(/\s+/);
  const total = Number(partes[1]);
  const usado = Number(partes[2]);
  const livre = Number(partes[3]);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(usado)) return null;

  const disponivel = Number.isFinite(livre) ? livre : Math.max(0, total - usado);
  // A porcentagem é `usado / (usado + disponível)`, e NÃO `usado / total`.
  //
  // Parece a mesma conta e não é: o `ext4` reserva ~5% do disco para o root, e
  // esse pedaço está no total e não está disponível. O `df` desconta — é a
  // definição do POSIX —, e mostrar outro número faria a IDE discordar do
  // comando que o usuário roda no terminal ao lado. Neste servidor: 44%, e não
  // os 41,4% que a conta ingênua dá.
  const base = usado + disponivel;
  return {
    totalBytes: total * 1024,
    usadoBytes: usado * 1024,
    livreBytes: disponivel * 1024,
    porcentagem: base <= 0 ? 0 : Math.round((usado / base) * 1000) / 10,
  };
}

/** `/proc/uptime`: segundos de pé, e segundos ociosos somados por núcleo. */
export function lerUptime(procUptime: string): number | null {
  const primeiro = Number(procUptime.trim().split(/\s+/)[0]);
  return Number.isFinite(primeiro) && primeiro >= 0 ? Math.round(primeiro) : null;
}

/** `/proc/loadavg`: as três médias. O resto da linha é contagem de processos. */
export function lerCarga(procLoadavg: string): readonly number[] | null {
  const n = procLoadavg
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((x) => Number(x));
  return n.length === 3 && n.every((x) => Number.isFinite(x)) ? n : null;
}

export interface ProcessoRemoto {
  readonly pid: number;
  readonly usuario: string;
  readonly cpu: number;
  readonly memoria: number;
  readonly rssBytes: number;
  readonly comando: string;
}

/**
 * A saída de `ps -eo pid,user:20,pcpu,pmem,rss,args`.
 *
 * `args`, e não `comm`: a tela de referência mostra a linha de comando inteira
 * (`node /mnt/apl/n8n/...`), e `comm` daria só `node` — quatro processos
 * chamados `node` e nenhuma forma de saber qual é qual.
 *
 * Por isso o comando é o **resto da linha**, e não um campo: ele contém
 * espaços, e cortar por espaço o truncaria no primeiro argumento.
 */
export function lerProcessos(saidaDoPs: string, limite = 10): readonly ProcessoRemoto[] {
  const achados: ProcessoRemoto[] = [];
  for (const bruta of saidaDoPs.split('\n')) {
    const linha = bruta.trim();
    if (linha === '' || linha.startsWith('PID')) continue;

    const m = /^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(linha);
    if (m === null) continue;
    const [, pid, usuario, cpu, memoria, rss, comando] = m;
    achados.push({
      pid: Number(pid),
      usuario: usuario ?? '?',
      cpu: Number(cpu),
      memoria: Number(memoria),
      rssBytes: Number(rss) * 1024,
      comando: (comando ?? '').trim(),
    });
    if (achados.length >= limite) break;
  }
  return achados;
}

export interface TrafegoDeRede {
  readonly recebidoBytes: number;
  readonly enviadoBytes: number;
}

/**
 * `/proc/net/dev`, somando as interfaces de verdade.
 *
 * `lo` fica de fora — tráfego consigo mesmo não é rede —, e as virtuais de
 * contêiner (`veth`, `docker`, `br-`) também: num servidor com Docker elas
 * duplicam o que já passou pela interface física, e o gráfico mostraria o dobro.
 */
const IGNORADAS = /^(lo|veth|docker|br-|virbr|tun|tap)/;

export function lerRede(procNetDev: string): TrafegoDeRede | null {
  let recebido = 0;
  let enviado = 0;
  let achou = false;

  for (const linha of procNetDev.split('\n')) {
    const corte = linha.indexOf(':');
    if (corte === -1) continue;
    const nome = linha.slice(0, corte).trim();
    if (nome === '' || IGNORADAS.test(nome)) continue;

    const n = linha.slice(corte + 1).trim().split(/\s+/).map((x) => Number(x));
    const rx = n[0];
    // A coluna de envio é a nona: as oito primeiras são de recepção.
    const tx = n[8];
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
    recebido += rx ?? 0;
    enviado += tx ?? 0;
    achou = true;
  }
  return achou ? { recebidoBytes: recebido, enviadoBytes: enviado } : null;
}
