// O que o git sabe e o `.gitignore` do projeto não diz (T042, spec 073).
//
// Duas coisas, e as duas eu tinha recusado com desculpa escrita no rodapé de
// `shared/gitignore.ts`:
//
// - **`.gitignore` global do usuário e `.git/info/exclude`.** A desculpa era
//   *"são configuração da máquina, não do projeto"*. É verdade — e é exatamente
//   por isso que valem: quem põe `*.log` no global espera que TODO projeto o
//   ignore, inclusive dentro desta IDE.
// - **Arquivo já rastreado pelo git.** A desculpa era *"ler o índice seria
//   trazer um segundo modelo de estado"*. O git é claro: **arquivo no índice
//   nunca é ignorado**, mesmo casando com uma regra. Sem isso a IDE deixa de
//   fora da busca justamente o arquivo que alguém versionou de propósito, com
//   `git add -f`.
//
// O índice é lido do binário, sem chamar o `git`: um executável a mais seria
// dependência nova (Artigo III), e o formato v2/v3 é estável desde 2005.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * O `excludesfile` declarado num `.gitconfig`.
 *
 * Formato INI com seções; só a chave dentro de `[core]` conta. `~` é expandido
 * porque o git o expande, e um caminho com til não abre em `fs`.
 */
export function lerExcludesFile(conteudo: string, home: string): string | null {
  let dentroDeCore = false;
  for (const bruta of conteudo.split('\n')) {
    const linha = bruta.trim();
    if (linha === '' || linha.startsWith('#') || linha.startsWith(';')) continue;
    if (linha.startsWith('[')) {
      // `[core]` e `[core "algo"]` — a subseção não muda a chave que importa.
      dentroDeCore = /^\[core(\s|\])/i.test(linha);
      continue;
    }
    if (!dentroDeCore) continue;
    const igual = linha.indexOf('=');
    if (igual === -1) continue;
    if (linha.slice(0, igual).trim().toLowerCase() !== 'excludesfile') continue;

    const valor = linha.slice(igual + 1).trim().replace(/^["']|["']$/g, '');
    if (valor === '') return null;
    if (valor === '~') return home;
    if (valor.startsWith('~/')) return path.join(home, valor.slice(2));
    return valor;
  }
  return null;
}

/**
 * Onde procurar regras que valem para todo projeto, na ordem em que o git olha.
 *
 * O `.git/info/exclude` vem por último de propósito: é o mais específico dos
 * três, e a última regra que casa é a que vence.
 */
export function caminhosDeExclusaoGlobal(
  raiz: string,
  ambiente: { home: string; xdg?: string | undefined },
  existe: (caminho: string) => boolean,
  lerTexto: (caminho: string) => string
): readonly string[] {
  const candidatos: string[] = [];

  const gitconfig = path.join(ambiente.home, '.gitconfig');
  if (existe(gitconfig)) {
    try {
      const declarado = lerExcludesFile(lerTexto(gitconfig), ambiente.home);
      if (declarado !== null) candidatos.push(declarado);
    } catch {
      // `.gitconfig` ilegível: segue para o padrão.
    }
  }

  // O padrão quando ninguém declarou nada. `XDG_CONFIG_HOME` vence o `~/.config`
  // por ser o que o próprio git consulta primeiro.
  const base = ambiente.xdg !== undefined && ambiente.xdg !== ''
    ? ambiente.xdg
    : path.join(ambiente.home, '.config');
  candidatos.push(path.join(base, 'git', 'ignore'));

  candidatos.push(path.join(raiz, '.git', 'info', 'exclude'));
  return candidatos.filter((c) => existe(c));
}

const cacheGlobal = new Map<string, { assinatura: string; texto: string }>();

/**
 * As linhas de exclusão global, já concatenadas para `lerRegras`.
 *
 * Guardadas por raiz e invalidadas pelo `mtime` dos arquivos: editar o
 * `~/.config/git/ignore` passa a valer sem reabrir a IDE, e a árvore não relê
 * três arquivos a cada pasta expandida.
 */
export function textoDasExclusoesGlobais(raiz: string): string {
  const caminhos = caminhosDeExclusaoGlobal(
    raiz,
    { home: os.homedir(), xdg: process.env.XDG_CONFIG_HOME },
    (c) => fs.existsSync(c),
    (c) => fs.readFileSync(c, 'utf8')
  );
  const marca = assinatura(caminhos);
  const guardado = cacheGlobal.get(raiz);
  if (guardado !== undefined && guardado.assinatura === marca) return guardado.texto;

  const partes: string[] = [];
  for (const caminho of caminhos) {
    try {
      partes.push(fs.readFileSync(caminho, 'utf8'));
    } catch {
      // Sem permissão: as demais continuam valendo.
    }
  }
  const texto = partes.join('\n');
  cacheGlobal.set(raiz, { assinatura: marca, texto });
  return texto;
}

// ---------------------------------------------------------------------------
// O índice do git
// ---------------------------------------------------------------------------

const CABECALHO = 12;
/** ctime, mtime, dev, ino, mode, uid, gid, size, sha1, flags. */
const ENTRADA_FIXA = 62;

/**
 * Os caminhos rastreados, lidos do `.git/index`.
 *
 * Devolve `null` quando não dá para ler com confiança — arquivo ausente,
 * assinatura errada, ou **versão 4**, que comprime os nomes com prefixo e
 * varint. Nesses casos quem chama simplesmente não usa a regra do índice, que é
 * o desfecho seguro: volta a valer o `.gitignore` puro, como antes desta spec.
 */
export function lerIndice(dados: Buffer): readonly string[] | null {
  if (dados.length < CABECALHO) return null;
  if (dados.toString('latin1', 0, 4) !== 'DIRC') return null;

  const versao = dados.readUInt32BE(4);
  if (versao !== 2 && versao !== 3) return null;
  const total = dados.readUInt32BE(8);

  const caminhos: string[] = [];
  let pos = CABECALHO;
  for (let n = 0; n < total; n += 1) {
    if (pos + ENTRADA_FIXA > dados.length) return null;
    const flags = dados.readUInt16BE(pos + 60);
    let inicio = pos + ENTRADA_FIXA;
    // Bit 0x4000 liga os flags estendidos, dois bytes a mais antes do nome.
    if ((flags & 0x4000) !== 0) inicio += 2;

    // O tamanho do nome vive nos 12 bits baixos, e `0xfff` significa "maior que
    // isto" — aí o NUL é a única marca de fim.
    const declarado = flags & 0x0fff;
    let fim: number;
    if (declarado < 0x0fff) {
      fim = inicio + declarado;
      if (fim > dados.length) return null;
    } else {
      fim = dados.indexOf(0, inicio);
      if (fim === -1) return null;
    }

    caminhos.push(dados.toString('utf8', inicio, fim));
    // Cada entrada é múltipla de 8 bytes, completada com NUL — e há pelo menos
    // um NUL sempre, que é o terminador do nome.
    const bruto = fim - pos;
    pos += Math.ceil((bruto + 1) / 8) * 8;
  }
  return caminhos;
}

export interface Rastreados {
  readonly arquivos: ReadonlySet<string>;
  /**
   * As pastas que CONTÊM algum arquivo rastreado, em todos os níveis.
   *
   * Sem elas, a varredura pararia na pasta ignorada e nunca chegaria ao arquivo
   * que o `git add -f` versionou lá dentro. Calculadas uma vez aqui, e não com
   * uma busca por prefixo a cada pasta visitada.
   */
  readonly pastas: ReadonlySet<string>;
}

function montarRastreados(caminhos: readonly string[]): Rastreados {
  const arquivos = new Set(caminhos);
  const pastas = new Set<string>();
  for (const caminho of caminhos) {
    let corte = caminho.lastIndexOf('/');
    while (corte > 0) {
      const pasta = caminho.slice(0, corte);
      if (pastas.has(pasta)) break; // os ancestrais já entraram por outro arquivo
      pastas.add(pasta);
      corte = pasta.lastIndexOf('/');
    }
  }
  return { arquivos, pastas };
}

/**
 * Assinatura barata de um conjunto de arquivos, para invalidar o cache.
 *
 * `mtime` e tamanho, e não o conteúdo: um `statSync` custa microssegundos, e o
 * índice de um repositório grande tem megabytes que não vale reler por pasta
 * expandida na árvore.
 */
function assinatura(caminhos: readonly string[]): string {
  return caminhos
    .map((c) => {
      try {
        const st = fs.statSync(c);
        return `${c}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${c}:-`;
      }
    })
    .join('|');
}

const cacheIndice = new Map<string, { assinatura: string; valor: Rastreados | null }>();

/** O que o git rastreia neste projeto, ou `null` quando não dá para saber. */
export function arquivosRastreados(raiz: string): Rastreados | null {
  const indice = path.join(raiz, '.git', 'index');
  const marca = assinatura([indice]);
  const guardado = cacheIndice.get(raiz);
  if (guardado !== undefined && guardado.assinatura === marca) return guardado.valor;

  let valor: Rastreados | null = null;
  try {
    if (fs.existsSync(indice)) {
      const caminhos = lerIndice(fs.readFileSync(indice));
      if (caminhos !== null) valor = montarRastreados(caminhos);
    }
  } catch {
    valor = null;
  }
  cacheIndice.set(raiz, { assinatura: marca, valor });
  return valor;
}
