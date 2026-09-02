// Navegar em Python, PHP e SQL — sem LSP (T040).
//
// A nota dele é o desenho inteiro: *"Python, PHP e SQL. C# NÃO. No SQL o 'LSP'
// é o próprio banco — encosta no T053"*.
//
// **Isto NÃO é um servidor de linguagem, e o comentário existe para ninguém
// achar que é.** O que há aqui é uma busca no índice de símbolos que a IDE já
// monta para o `Ctrl+Shift+O` (spec 016): quem procura `processar_arquivo` acha
// o `def processar_arquivo` do projeto. Isso resolve o caso comum — pular para
// onde uma função foi definida — e não resolve os difíceis:
//
// - **duas funções com o mesmo nome** em módulos diferentes viram duas
//   respostas, e a IDE mostra as duas em vez de escolher no chute;
// - **método de objeto** (`cliente.salvar()`) acha todo `salvar` do projeto, e
//   não o da classe certa — para isso é preciso saber o TIPO de `cliente`, que
//   é exatamente o que um LSP faz e isto não faz.
//
// Um LSP de verdade (`pylsp`, `intelephense`) resolveria os dois, ao custo de
// um processo por linguagem, instalado na máquina dele. Está registrado como
// caminho possível, e não como dívida escondida.
import * as path from 'path';
import { extractSymbols, EXTENSOES_DE_SIMBOLO, type SymbolInfo } from './symbols';
import { varrerArquivos } from './pastas';
import * as fs from 'fs';

/** As que este módulo atende. C# ficou de fora por decisão dele. */
const EXTENSOES: ReadonlySet<string> = new Set(['.py', '.php']);

export function atendePorSimbolo(caminho: string): boolean {
  return EXTENSOES.has(path.extname(caminho).toLowerCase());
}

export interface AlvoDeSimbolo {
  readonly caminho: string;
  readonly linha: number;
  readonly coluna: number;
  readonly previa: string;
}

/** Teto de arquivos varridos. O mesmo do serviço de TypeScript, e pelo mesmo motivo. */
const MAX_ARQUIVOS = 1_500;

/**
 * A palavra sob o cursor.
 *
 * `$` entra porque em PHP ele faz parte do nome da variável, e tirá-lo faria
 * `$conexao` procurar por `conexao` — que existe como outra coisa.
 */
export function palavraNaPosicao(texto: string, linha: number, coluna: number): string {
  const linhas = texto.split('\n');
  const alvo = linhas[linha - 1] ?? '';
  const antes = alvo.slice(0, Math.max(0, coluna - 1));
  const depois = alvo.slice(Math.max(0, coluna - 1));
  const inicio = /[A-Za-z0-9_$]*$/.exec(antes)?.[0] ?? '';
  const fim = /^[A-Za-z0-9_$]*/.exec(depois)?.[0] ?? '';
  return `${inicio}${fim}`;
}

/**
 * Onde este nome é DEFINIDO no projeto.
 *
 * Devolve todos os lugares, e não o primeiro: com duas definições do mesmo
 * nome, escolher uma no chute mandaria a pessoa para o arquivo errado sem
 * nenhum sinal de que houve escolha. A tela mostra a lista.
 *
 * A ordem põe o arquivo ATUAL primeiro — se o nome existe aqui e em outro
 * lugar, o daqui é quase sempre o certo.
 */
export function definicaoPorSimbolo(
  pasta: string,
  caminhoAtual: string,
  nome: string
): readonly AlvoDeSimbolo[] {
  if (nome.length < 2) return [];

  const achados: AlvoDeSimbolo[] = [];
  const arquivos = varrerArquivos(pasta, {
    extensoes: EXTENSOES_DE_SIMBOLO,
    max: MAX_ARQUIVOS,
  }).arquivos;

  for (const arquivo of arquivos) {
    if (!atendePorSimbolo(arquivo)) continue;
    let conteudo: string;
    try {
      conteudo = fs.readFileSync(arquivo, 'utf8');
    } catch {
      // Arquivo sumiu entre a varredura e a leitura: segue.
      continue;
    }

    let simbolos: readonly SymbolInfo[];
    try {
      simbolos = extractSymbols(arquivo, conteudo);
    } catch {
      // Arquivo com sintaxe estranha não pode derrubar a navegação inteira.
      continue;
    }

    const linhas = conteudo.split('\n');
    for (const s of simbolos) {
      // Comparação EXATA. `contains` acharia `processar` dentro de
      // `reprocessar_tudo`, e o pulo iria para o lugar errado — o que é pior
      // que não pular.
      if (s.name !== nome) continue;
      const linhaDoTexto = linhas[s.line - 1] ?? '';
      achados.push({
        caminho: arquivo,
        linha: s.line,
        coluna: Math.max(1, linhaDoTexto.indexOf(nome) + 1),
        previa: linhaDoTexto.trim().slice(0, 160),
      });
    }
  }

  return achados.sort((a, b) => {
    const daqui = (x: AlvoDeSimbolo): number => (x.caminho === caminhoAtual ? 0 : 1);
    return daqui(a) - daqui(b) || a.caminho.localeCompare(b.caminho) || a.linha - b.linha;
  });
}

/**
 * Onde este nome é USADO.
 *
 * Busca por texto, com fronteira de palavra — não sabe distinguir a variável do
 * comentário que fala dela. É o que dá para fazer sem analisar a linguagem, e
 * a alternativa honesta seria não oferecer o item.
 */
export function referenciasPorTexto(
  pasta: string,
  nome: string,
  max = 200
): readonly AlvoDeSimbolo[] {
  if (nome.length < 2) return [];
  const achados: AlvoDeSimbolo[] = [];
  // `$` é especial em regex; escapá-lo é o que faz `$conexao` do PHP funcionar.
  const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const padrao = new RegExp(`(?<![A-Za-z0-9_$])${escapado}(?![A-Za-z0-9_$])`);

  for (const arquivo of varrerArquivos(pasta, {
    extensoes: EXTENSOES_DE_SIMBOLO,
    max: MAX_ARQUIVOS,
  }).arquivos) {
    if (!atendePorSimbolo(arquivo)) continue;
    let linhas: string[];
    try {
      linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const [i, linha] of linhas.entries()) {
      if (!padrao.test(linha)) continue;
      achados.push({
        caminho: arquivo,
        linha: i + 1,
        coluna: Math.max(1, linha.search(padrao) + 1),
        previa: linha.trim().slice(0, 160),
      });
      if (achados.length >= max) return achados;
    }
  }
  return achados;
}
