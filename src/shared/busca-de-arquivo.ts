// Achar arquivo pelo nome, do jeito do `Ctrl+P` (T051, spec 073).
//
// O que existia antes era uma caixa pedindo **caminho absoluto**, digitado
// inteiro. Isso não é achar arquivo: é ter que saber onde ele está.
//
// A regra é a que todo editor usa e ninguém explica: as letras digitadas
// precisam aparecer **na ordem**, mas não precisam ser vizinhas — `usli` acha
// `usa-lib.ts`. O que separa um bom resultado de um ruim é ONDE elas caem, e é
// disso que a pontuação trata.
//
// Puro de propósito: ranking é aritmética, e aritmética se confere sem
// navegador. Provar no Playwright que `usli` traz `usa-lib.ts` antes de
// `utils.ts` custaria um teste lento para cada caso de borda.

import { nomeParaExibir } from './caminho-local';

const SEPARADORES = new Set(['/', '-', '_', '.', ' ']);

/** Um caractere que começa palavra: início do texto, ou logo após separador. */
function comecaPalavra(alvo: string, i: number): boolean {
  if (i === 0) return true;
  const anterior = alvo[i - 1] ?? '';
  if (SEPARADORES.has(anterior)) return true;
  // `camelCase`: o `C` de `parseConfig` começa palavra tanto quanto o `c` de
  // `parse_config`, e quem digita `pc` espera achar os dois.
  const atual = alvo[i] ?? '';
  return anterior === anterior.toLowerCase() && atual !== atual.toLowerCase();
}

const PONTO_POR_LETRA = 10;
const BONUS_VIZINHA = 8;
const BONUS_INICIO_DE_PALAVRA = 8;
/** Cada letra pulada custa um ponto: casar de perto vale mais que casar longe. */
const CUSTO_DO_PULO = 1;

/**
 * Quanto `termo` casa em `alvo`, ou `null` quando não casa.
 *
 * Varredura gulosa da esquerda para a direita: cada letra do termo pega a
 * primeira ocorrência livre. Não é o casamento ÓTIMO — achar o ótimo é
 * programação dinâmica, e para nomes de arquivo a diferença não aparece —, mas
 * é previsível, que é o que importa para quem digita.
 */
export function pontuar(alvo: string, termo: string): number | null {
  if (termo === '') return 0;
  const a = alvo.toLowerCase();
  const t = termo.toLowerCase();

  let pontos = 0;
  let procurarDe = 0;
  let anterior = -2;

  for (const letra of t) {
    const i = a.indexOf(letra, procurarDe);
    if (i === -1) return null;

    pontos += PONTO_POR_LETRA;
    if (i === anterior + 1) pontos += BONUS_VIZINHA;
    if (comecaPalavra(alvo, i)) pontos += BONUS_INICIO_DE_PALAVRA;
    pontos -= (i - procurarDe) * CUSTO_DO_PULO;

    anterior = i;
    procurarDe = i + 1;
  }
  // Pontuação nunca negativa: um caminho muito longo poderia acumular pulos
  // até virar número negativo e cair abaixo de quem não casou nada.
  return Math.max(0, pontos);
}

/** O nome do arquivo, sem as pastas. */
export function nomeDe(caminho: string): string {
  return nomeParaExibir(caminho);
}

/**
 * Casar no NOME vale o dobro de casar no caminho.
 *
 * Quem digita `config` quer o `config.py`, não os doze arquivos dentro de uma
 * pasta chamada `config/`. Somar os dois em vez de escolher um faz a pasta
 * ainda contar como desempate.
 */
const PESO_DO_NOME = 2;

export function pontuarCaminho(caminho: string, termo: string): number | null {
  const noNome = pontuar(nomeDe(caminho), termo);
  const noCaminho = pontuar(caminho, termo);
  if (noNome === null && noCaminho === null) return null;
  return (noNome ?? 0) * PESO_DO_NOME + (noCaminho ?? 0);
}

export interface OpcoesDaBusca {
  /** Caminhos abertos recentemente, do mais recente para o mais antigo. */
  readonly recentes?: readonly string[];
  readonly max?: number;
}

/**
 * Os arquivos que casam com o termo, do melhor para o pior.
 *
 * **Com o campo vazio, a lista é a dos recentes** — é o pedido dele, *"fuzzy
 * por nome, com os recentes no topo"*, e é o que faz o `Ctrl+P` seguido de
 * `Enter` voltar ao arquivo anterior sem digitar nada.
 *
 * Assim que se digita, quem manda é a QUALIDADE do casamento, e a recência vira
 * desempate. O contrário — recente sempre na frente — poria um arquivo que
 * casou de raspão acima do que casou perfeitamente, e isso se sente como a
 * busca ignorando o que foi digitado.
 */
export function acharArquivos(
  caminhos: readonly string[],
  termo: string,
  opcoes: OpcoesDaBusca = {}
): readonly string[] {
  const max = opcoes.max ?? 50;
  const recentes = opcoes.recentes ?? [];
  const posicaoRecente = new Map(recentes.map((c, i) => [c, i]));
  const recencia = (c: string): number => posicaoRecente.get(c) ?? Number.MAX_SAFE_INTEGER;

  const limpo = termo.trim();
  if (limpo === '') {
    const vistos = new Set<string>();
    const saida: string[] = [];
    for (const c of recentes) {
      if (caminhos.includes(c) && !vistos.has(c)) {
        vistos.add(c);
        saida.push(c);
      }
    }
    for (const c of caminhos) {
      if (saida.length >= max) break;
      if (!vistos.has(c)) saida.push(c);
    }
    return saida.slice(0, max);
  }

  const casados: Array<{ caminho: string; pontos: number }> = [];
  for (const caminho of caminhos) {
    const pontos = pontuarCaminho(caminho, limpo);
    if (pontos !== null) casados.push({ caminho, pontos });
  }

  casados.sort((a, b) => {
    if (a.pontos !== b.pontos) return b.pontos - a.pontos;
    const ra = recencia(a.caminho);
    const rb = recencia(b.caminho);
    if (ra !== rb) return ra - rb;
    // Empate total: o caminho mais curto é o mais provável de ser o procurado.
    return a.caminho.length - b.caminho.length;
  });
  return casados.slice(0, max).map((c) => c.caminho);
}
