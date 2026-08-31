// Ler pastas do sistema de arquivos: navegador e árvore.
//
// **O teto desta árvore não é enfeite.** Enquanto a IDE só abria `projects/`,
// percorrer tudo recursivamente era seguro por acidente: as pastas eram
// pequenas. Com "abra qualquer pasta", apontar para `~` ou `/` percorreria o
// disco inteiro, de forma síncrona, no mesmo processo que serve a interface — a
// IDE congelaria sem nem dar erro.
//
// O corte é **incremental**: para de descer ao atingir o teto, em vez de ler
// tudo e cortar depois. É a mesma regra que o Artigo III impõe ao limite de
// linhas dos drivers.
import * as fs from 'fs';
import * as path from 'path';
import { ignorado, lerRegras, REGRAS_PADRAO, type Regra } from '../shared/gitignore';
import { arquivosRastreados, textoDasExclusoesGlobais, type Rastreados } from './git-repo';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
  /**
   * O `.gitignore` (ou o padrão embutido) manda ignorar isto.
   *
   * A árvore continua MOSTRANDO — o cinza só diz que a IDE não vai indexar
   * aquilo. É a mesma regra da varredura, e é de propósito: assim o cinza tem
   * um significado exato ("não entra na busca") em vez de ser decoração.
   */
  ignored?: boolean;
}

export interface ArvoreDaPasta {
  readonly nodes: readonly FileNode[];
  /** Verdadeiro quando o teto cortou. A interface avisa — ver AC-13. */
  readonly truncated: boolean;
}

export interface Subpasta {
  readonly name: string;
  readonly path: string;
}

export interface ListagemDePastas {
  readonly path: string;
  /** `null` na raiz do sistema de arquivos. */
  readonly parent: string | null;
  readonly dirs: readonly Subpasta[];
}

/**
 * Quantas entradas de UMA pasta a árvore devolve.
 *
 * Não é o antigo teto da árvore inteira — esse deixou de existir quando a
 * árvore passou a carregar um nível por vez (spec 034). É proteção contra a
 * pasta patológica: um diretório com 200 mil arquivos trava a rolagem do
 * navegador, e não há como ler 200 mil nomes de qualquer jeito.
 */
export const MAX_ENTRADAS = 5_000;

/**
 * O que a árvore não mostra, por decisão do usuário em 2026-08-19.
 *
 * **Lista curta e de um tipo só:** metadado de controle de versão e sujeira de
 * sistema operacional. Nada aqui se edita, nunca. É o mesmo `files.exclude`
 * padrão do VS Code.
 *
 * **Não é o lugar de `node_modules`, `.venv` ou `vendor`** — essas aparecem, e
 * quem decide não varrê-las é o `.gitignore`. Foi exatamente essa confusão que
 * a spec 034 desfez; misturar as duas coisas de novo aqui desfaria o conserto.
 */
const NAO_MOSTRADAS: ReadonlySet<string> = new Set([
  '.git', '.hg', '.svn', 'CVS', '.DS_Store', 'Thumbs.db',
]);

/** Até onde uma varredura desce. Ciclo de link simbólico não vira laço eterno. */
export const MAX_PROFUNDIDADE = 12;

/**
 * Teto de arquivos numa varredura.
 *
 * Com o `.gitignore` respeitado, um projeto normal fica bem abaixo. O teto
 * existe para o caso anormal — e para DIZER que ficou cortado, em vez de fingir
 * que acabou.
 */
export const MAX_ARQUIVOS_VARRIDOS = 20_000;

/** Recusa o que não é pasta existente, com mensagem que diz o caminho. */
export function pastaValida(bruto: string): string {
  if (bruto.includes('\0')) throw new Error('Caminho inválido.');
  const alvo = path.resolve(bruto);
  if (!fs.existsSync(alvo) || !fs.statSync(alvo).isDirectory()) {
    throw new Error(`Pasta não encontrada: ${alvo}`);
  }
  return alvo;
}

/**
 * Subpastas de um diretório, para o navegador.
 *
 * Mostra as ocultas? Não: `.cache`, `.local` e companhia são ruído, e quem
 * precisa de uma sabe digitar o caminho. Já as ignoradas da árvore
 * (`node_modules`) APARECEM aqui — abrir `node_modules` de propósito é raro,
 * mas escondê-la seria mentir sobre o que existe no disco.
 */
export function listarSubpastas(alvo: string): ListagemDePastas {
  const dirs: Subpasta[] = [];
  for (const entrada of fs.readdirSync(alvo, { withFileTypes: true })) {
    if (entrada.name.startsWith('.')) continue;
    if (!entrada.isDirectory()) continue;
    dirs.push({ name: entrada.name, path: path.join(alvo, entrada.name) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  const pai = path.dirname(alvo);
  return { path: alvo, parent: pai === alvo ? null : pai, dirs };
}

/**
 * O conteúdo de UMA pasta, sem descer.
 *
 * **Mostra tudo que existe no disco**, inclusive `.venv`, `vendor` e
 * `node_modules`. Esconder pasta é mentir sobre o projeto — e era o que a
 * versão anterior fazia, por um motivo que deixou de existir: ela lia a árvore
 * INTEIRA de uma vez, então uma `.venv` gastava o teto de nós e a árvore
 * chegava truncada. Lendo um nível por vez, pasta grande custa exatamente o que
 * custa abrir pasta grande: nada, até alguém abrir.
 *
 * O que **não** se varre continua governado por `.gitignore` — mas isso é a
 * busca e a indexação, e não o que aparece na tela. Ver `shared/gitignore.ts`.
 */
export function filhosDaPasta(
  dir: string,
  raiz: string = dir
): { nodes: FileNode[]; truncated: boolean } {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Pasta sem permissão de leitura: vazia em vez de derrubar o painel.
    return { nodes: [], truncated: false };
  }

  const regras = regrasAte(raiz, dir);
  const rastreados = arquivosRastreados(raiz);
  const nodes: FileNode[] = [];
  for (const entrada of entradas) {
    if (nodes.length >= MAX_ENTRADAS) break;
    if (NAO_MOSTRADAS.has(entrada.name)) continue;
    const full = path.join(dir, entrada.name);
    const relativo = path.relative(raiz, full).split(path.sep).join('/');
    const cinza = ehIgnorado(relativo, entrada.isDirectory(), regras, rastreados);
    if (entrada.isDirectory()) {
      // `children` ausente significa "ainda não carregada" para a interface —
      // diferente de `[]`, que significa "carregada e vazia".
      nodes.push({ name: entrada.name, path: full, type: 'dir', ...(cinza ? { ignored: true } : {}) });
    } else if (entrada.isFile()) {
      nodes.push({ name: entrada.name, path: full, type: 'file', ...(cinza ? { ignored: true } : {}) });
    }
  }
  nodes.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
  );
  return { nodes, truncated: entradas.length > MAX_ENTRADAS };
}

/**
 * As regras que valem dentro de `dir`, somando os `.gitignore` do caminho.
 *
 * Da raiz até a pasta pedida, como o git faz: cada nível pode acrescentar, e o
 * de baixo vê o de cima. Sem isto, abrir uma subpasta perderia as regras da
 * raiz e nada ficaria cinza lá dentro.
 */
function regrasBase(raiz: string): readonly Regra[] {
  // As exclusões globais entram DEPOIS das padrão e ANTES das do projeto: quem
  // põe `*.log` no `~/.config/git/ignore` espera que valha aqui, e o
  // `.gitignore` do projeto ainda pode reabrir com `!`.
  const global = textoDasExclusoesGlobais(raiz);
  return global === '' ? REGRAS_PADRAO : [...REGRAS_PADRAO, ...lerRegras(global)];
}

/**
 * O `ignorado` desta IDE, com a regra que o git tem e a nossa não tinha (T042).
 *
 * **Arquivo no índice nunca é ignorado.** Alguém que fez `git add -f` num
 * arquivo dentro de `dist/` quer aquele arquivo versionado — e deixá-lo fora da
 * busca seria esconder justamente o que foi posto ali de propósito.
 *
 * Vale também para a PASTA que o contém: parar nela nunca chegaria ao arquivo.
 */
function ehIgnorado(
  relativo: string,
  ehPasta: boolean,
  regras: readonly Regra[],
  rastreados: Rastreados | null
): boolean {
  if (!ignorado(relativo, ehPasta, regras)) return false;
  if (rastreados === null) return true;
  return ehPasta ? !rastreados.pastas.has(relativo) : !rastreados.arquivos.has(relativo);
}

function regrasAte(raiz: string, dir: string): readonly Regra[] {
  let regras: readonly Regra[] = regrasBase(raiz);
  const relativo = path.relative(raiz, dir);
  const partes = relativo === '' ? [] : relativo.split(path.sep);

  let atual = raiz;
  for (let i = 0; i <= partes.length; i += 1) {
    try {
      const arquivo = path.join(atual, '.gitignore');
      if (fs.existsSync(arquivo)) {
        regras = [...regras, ...lerRegras(fs.readFileSync(arquivo, 'utf8'))];
      }
    } catch {
      // Ilegível: segue com o que já tem.
    }
    const proxima = partes[i];
    if (proxima === undefined) break;
    atual = path.join(atual, proxima);
  }
  return regras;
}

/**
 * Varre a pasta inteira, aplicando as regras de `.gitignore`.
 *
 * É o outro lado da moeda: quem MOSTRA não filtra, quem VARRE filtra. Busca,
 * símbolos e serviço de linguagem passam por aqui, e nenhum deles tem o que
 * fazer dentro de `node_modules`.
 *
 * Lê o `.gitignore` de cada pasta pelo caminho, como o git faz — um monorepo
 * tem um por pacote.
 */
export function varrerArquivos(
  raiz: string,
  opcoes: { readonly extensoes?: ReadonlySet<string>; readonly max?: number } = {}
): { arquivos: string[]; truncated: boolean } {
  const max = opcoes.max ?? MAX_ARQUIVOS_VARRIDOS;
  const rastreados = arquivosRastreados(raiz);
  const arquivos: string[] = [];
  let truncated = false;

  const andar = (dir: string, profundidade: number, herdadas: readonly Regra[]): void => {
    if (profundidade > MAX_PROFUNDIDADE || truncated) return;

    let entradas: fs.Dirent[];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // O `.gitignore` desta pasta vale para ela e para as de baixo.
    let regras = herdadas;
    const proprio = path.join(dir, '.gitignore');
    if (entradas.some((e) => e.name === '.gitignore' && e.isFile())) {
      try {
        regras = [...herdadas, ...lerRegras(fs.readFileSync(proprio, 'utf8'))];
      } catch {
        // Ilegível: segue com as herdadas.
      }
    }

    for (const entrada of entradas) {
      if (arquivos.length >= max) {
        truncated = true;
        return;
      }
      const full = path.join(dir, entrada.name);
      const relativo = path.relative(raiz, full).split(path.sep).join('/');
      if (ehIgnorado(relativo, entrada.isDirectory(), regras, rastreados)) continue;

      if (entrada.isDirectory()) andar(full, profundidade + 1, regras);
      else if (entrada.isFile()) {
        if (opcoes.extensoes === undefined || opcoes.extensoes.has(path.extname(entrada.name))) {
          arquivos.push(full);
        }
      }
    }
  };

  andar(raiz, 0, regrasBase(raiz));
  return { arquivos, truncated };
}

/** Caminhos dos arquivos da árvore, opcionalmente filtrados por extensão. */
export function arquivosDaArvore(
  nodes: readonly FileNode[],
  extensoes?: ReadonlySet<string>
): string[] {
  const saida: string[] = [];
  const andar = (lista: readonly FileNode[]): void => {
    for (const no of lista) {
      if (no.type === 'dir') andar(no.children ?? []);
      else if (extensoes === undefined || extensoes.has(path.extname(no.name))) saida.push(no.path);
    }
  };
  andar(nodes);
  return saida;
}

/** Resolve um nome relativo dentro da pasta, recusando o que escapa dela. */
export function dentroDaPasta(pasta: string, relativo: string): string {
  if (relativo.includes('\0')) throw new Error('Caminho inválido.');
  const alvo = path.resolve(pasta, relativo);
  if (alvo !== pasta && !alvo.startsWith(pasta + path.sep)) {
    throw new Error('O arquivo precisa ficar dentro da pasta aberta.');
  }
  return alvo;
}
