// Varre a pasta aberta procurando (e trocando) texto.
//
// A parte que decide o que casa mora em `shared/busca.ts`, testada sem disco.
// Aqui fica o que é I/O — e os **tetos**, que são o que separa uma busca de um
// travamento.
//
// Buscar é a primeira operação da IDE que toca cada arquivo do projeto. Sem
// limite, uma expressão infeliz numa pasta grande segura o processo que serve a
// interface, e a IDE inteira congela sem erro. É a mesma lição do teto da árvore
// de pastas, na spec 012 — e por isso os limites aqui são quatro, não um.
import * as fs from 'fs';
import * as path from 'path';
import {
  buscarNoConteudo, montarRegex, substituirNoConteudo,
  type ArquivoComOcorrencias, type OpcoesDeBusca,
} from '../shared/busca';
import { varrerArquivos } from './pastas';
import {
  passaNoFiltro, SEM_FILTRO, type FiltroDeArquivos,
} from '../shared/busca-filtro';

/** Arquivo maior que isto não é código: é dado, e varrer não ajuda ninguém. */
export const MAX_BYTES_POR_ARQUIVO = 2 * 1024 * 1024;
/** Teto de arquivos visitados numa busca. */
export const MAX_ARQUIVOS = 2_000;
/** Teto de ocorrências no total. Acima disso, refinar o termo é o caminho. */
export const MAX_OCORRENCIAS = 2_000;
/**
 * Teto de tempo.
 *
 * É a defesa contra expressão catastrófica: um `(a+)+b` numa linha longa pode
 * levar minutos, e nenhum dos outros tetos o alcança — ele trava dentro de um
 * arquivo só.
 */
export const MAX_MS = 10_000;

export interface ResultadoDaBusca {
  readonly arquivos: readonly ArquivoComOcorrencias[];
  readonly totalDeOcorrencias: number;
  /** Verdadeiro quando algum teto cortou a varredura. */
  readonly truncado: boolean;
  /** Quantos arquivos foram efetivamente lidos. */
  readonly arquivosVisitados: number;
}

const VAZIO: ResultadoDaBusca = {
  arquivos: [],
  totalDeOcorrencias: 0,
  truncado: false,
  arquivosVisitados: 0,
};

/** O caminho como os padrões do filtro o enxergam: relativo, com `/`. */
function relativo(pasta: string, caminho: string): string {
  return path.relative(pasta, caminho).split(path.sep).join('/');
}

/** Lê um arquivo de texto, ou `null` se não vale a pena (grande, ilegível). */
function lerTexto(caminho: string): string | null {
  try {
    if (fs.statSync(caminho).size > MAX_BYTES_POR_ARQUIVO) return null;
    return fs.readFileSync(caminho, 'utf8');
  } catch {
    return null;
  }
}

export function buscarNaPasta(
  pasta: string,
  termo: string,
  opcoes: OpcoesDeBusca,
  filtro: FiltroDeArquivos = SEM_FILTRO
): ResultadoDaBusca {
  const regex = montarRegex(termo, opcoes);
  if (regex === null) return VAZIO;

  // Varredura com as regras de `.gitignore`: procurar dentro de `node_modules`
  // devolve milhares de acertos que ninguém quer ler.
  const { arquivos: caminhos, truncated } = varrerArquivos(pasta, { max: MAX_ARQUIVOS });
  const limite = Date.now() + MAX_MS;

  const arquivos: ArquivoComOcorrencias[] = [];
  let total = 0;
  let visitados = 0;
  let truncado = truncated;

  for (const caminho of caminhos) {
    if (Date.now() > limite || total >= MAX_OCORRENCIAS) {
      truncado = true;
      break;
    }
    // O filtro (T031) é aplicado ao caminho RELATIVO, que é o vocabulário dos
    // padrões — `src/**/*.ts` não faria sentido contra um caminho absoluto.
    // Vem antes de ler o arquivo: filtrar depois pagaria a leitura à toa.
    if (!passaNoFiltro(relativo(pasta, caminho), filtro)) continue;
    const conteudo = lerTexto(caminho);
    if (conteudo === null) continue;
    visitados += 1;

    const ocorrencias = buscarNoConteudo(conteudo, regex, MAX_OCORRENCIAS - total);
    if (ocorrencias.length === 0) continue;
    arquivos.push({ caminho, ocorrencias });
    total += ocorrencias.length;
  }

  return { arquivos, totalDeOcorrencias: total, truncado, arquivosVisitados: visitados };
}

export interface ResultadoDaSubstituicao {
  readonly arquivosAlterados: number;
  readonly trocas: number;
  /** O que desfazer isto exigiria: caminho → conteúdo ANTES (T032). */
  readonly antes: ReadonlyMap<string, string>;
}

/**
 * Substitui nos arquivos indicados.
 *
 * Recebe a lista de caminhos em vez de descobri-la: é o que permite trocar **num
 * arquivo só**, e é o que garante que o que se altera é exatamente o que estava
 * na tela quando o usuário decidiu. Refazer a busca aqui poderia pegar um
 * arquivo que mudou no meio.
 */
export function substituirNaPasta(
  pasta: string,
  caminhos: readonly string[],
  termo: string,
  opcoes: OpcoesDeBusca,
  substituto: string
): ResultadoDaSubstituicao {
  const regex = montarRegex(termo, opcoes);
  if (regex === null) return { arquivosAlterados: 0, trocas: 0, antes: new Map() };

  const raiz = path.resolve(pasta);
  const antes = new Map<string, string>();
  let alterados = 0;
  let trocas = 0;

  for (const bruto of caminhos) {
    const caminho = path.resolve(bruto);
    // Fora da pasta aberta não se mexe. O caminho vem do cliente, e substituir
    // é destrutivo — esta é a única checagem entre um erro de digitação e um
    // arquivo de sistema reescrito.
    if (caminho !== raiz && !caminho.startsWith(raiz + path.sep)) continue;

    const conteudo = lerTexto(caminho);
    if (conteudo === null) continue;

    const { texto, trocas: n } = substituirNoConteudo(conteudo, regex, substituto, opcoes.regex);
    if (n === 0) continue;

    // O "antes" é guardado ANTES de escrever, e só de quem de fato muda (T032).
    // Guardar arquivo sem troca incharia o histórico com cópias idênticas.
    antes.set(caminho, conteudo);
    fs.writeFileSync(caminho, texto, 'utf8');
    alterados += 1;
    trocas += n;
  }

  return { arquivosAlterados: alterados, trocas, antes };
}

/**
 * Desfaz uma substituição, devolvendo cada arquivo ao conteúdo anterior (T032).
 *
 * A cerca da pasta é conferida de novo, e não confiada ao que foi guardado: o
 * histórico vive em memória do servidor, e reescrever caminho absoluto é a
 * operação mais destrutiva desta IDE. Conferir duas vezes custa nada.
 *
 * Arquivo que sumiu no meio-tempo é PULADO, e não recriado: recriar traria de
 * volta algo que o usuário pode ter apagado de propósito depois.
 */
export function desfazerSubstituicao(
  pasta: string,
  antes: ReadonlyMap<string, string>
): { readonly restaurados: number; readonly pulados: number } {
  const raiz = path.resolve(pasta);
  let restaurados = 0;
  let pulados = 0;

  for (const [bruto, conteudo] of antes) {
    const caminho = path.resolve(bruto);
    if (caminho !== raiz && !caminho.startsWith(raiz + path.sep)) {
      pulados += 1;
      continue;
    }
    if (!fs.existsSync(caminho)) {
      pulados += 1;
      continue;
    }
    fs.writeFileSync(caminho, conteudo, 'utf8');
    restaurados += 1;
  }

  return { restaurados, pulados };
}
