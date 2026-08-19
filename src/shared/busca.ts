// Busca e substituição em vários arquivos.
//
// Tudo que decide **o que casa** e **o que vira o quê** mora aqui, longe de
// disco e de rede. São três armadilhas, e as três estão marcadas no código:
//
// 1. casamento de tamanho ZERO trava o laço de `exec` — `a*` e `^` casam sem
//    consumir, e `lastIndex` não anda sozinho;
// 2. `$1` no texto de substituição é referência de grupo para o `String.replace`
//    — o que é o certo em modo regex e um estrago em busca literal;
// 3. expressão do usuário pode ser catastrófica, e a busca precisa de um teto de
//    tempo em vez de travar a IDE.

export interface OpcoesDeBusca {
  /** O termo é uma expressão regular, e não texto literal. */
  readonly regex: boolean;
  /** Diferencia maiúsculas de minúsculas. */
  readonly maiusculas: boolean;
  /** Só casa a palavra inteira. */
  readonly palavraInteira: boolean;
}

export const OPCOES_PADRAO: OpcoesDeBusca = {
  regex: false,
  maiusculas: false,
  palavraInteira: false,
};

/** Uma ocorrência dentro de uma linha. Colunas começam em 1, como no editor. */
export interface Ocorrencia {
  readonly linha: number;
  readonly coluna: number;
  /** Fim exclusivo, em coluna. Serve para o realce no resultado. */
  readonly colunaFim: number;
  /** A linha inteira, para mostrar o contexto. */
  readonly texto: string;
}

export interface ArquivoComOcorrencias {
  readonly caminho: string;
  readonly ocorrencias: readonly Ocorrencia[];
}

/** Teto do tamanho da expressão. Um padrão gigante já é sinal de engano. */
export const MAX_TERMO = 1_000;

/**
 * Monta a expressão da busca, ou `null` se o termo não serve.
 *
 * Devolver `null` em vez de lançar é deliberado: termo vazio e regex inválida
 * são coisas que o usuário digita o tempo todo enquanto pensa, e não merecem
 * uma caixa de erro a cada tecla.
 */
export function montarRegex(termo: string, opcoes: OpcoesDeBusca): RegExp | null {
  if (termo === '' || termo.length > MAX_TERMO) return null;

  let fonte = opcoes.regex ? termo : escaparRegex(termo);
  if (opcoes.palavraInteira) {
    // `\b` é a fronteira ENTRE caractere de palavra e não-palavra. Pô-la ao
    // lado de pontuação faria a busca não casar nunca: em `f(x)`, procurar por
    // `\b\(x\)\b` exige palavra colada no parêntese. Então ela só entra do
    // lado em que o termo começa (ou termina) com caractere de palavra.
    //
    // `\w`, e não `[\w$]`: **o cifrão NÃO é caractere de palavra** para o
    // motor de regex, então tratá-lo como se fosse punha a borda exatamente
    // onde ela não pode casar — e procurar por `$id` com "palavra inteira" não
    // achava nada.
    const inicio = /\w/.test(termo[0] ?? '') ? '\\b' : '';
    const fim = /\w/.test(termo[termo.length - 1] ?? '') ? '\\b' : '';
    fonte = `${inicio}(?:${fonte})${fim}`;
  }

  try {
    // `g` para achar todas; `u` fica de fora porque quebraria expressões
    // válidas em modo não-unicode que o usuário pode digitar.
    return new RegExp(fonte, opcoes.maiusculas ? 'g' : 'gi');
  } catch {
    return null;
  }
}

export function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * As ocorrências numa linha.
 *
 * **O `lastIndex` é empurrado à mão quando o casamento tem tamanho zero.** Sem
 * isso, `a*` ou `^` fazem `exec` devolver o mesmo índice para sempre, e a aba
 * trava — não é hipótese, é o que acontece na primeira vez que alguém procura
 * por `^` para listar as linhas.
 */
export function ocorrenciasNaLinha(
  linha: string,
  numero: number,
  regex: RegExp,
  limite = 1_000
): readonly Ocorrencia[] {
  const achadas: Ocorrencia[] = [];
  regex.lastIndex = 0;

  for (;;) {
    const casamento = regex.exec(linha);
    if (casamento === null) break;

    const inicio = casamento.index;
    const fim = inicio + casamento[0].length;
    achadas.push({ linha: numero, coluna: inicio + 1, colunaFim: fim + 1, texto: linha });

    if (achadas.length >= limite) break;
    // Tamanho zero: avança um caractere, senão o laço não termina.
    regex.lastIndex = casamento[0].length === 0 ? inicio + 1 : fim;
    if (regex.lastIndex > linha.length) break;
  }
  return achadas;
}

/**
 * Substitui numa linha.
 *
 * **`$` no texto de substituição é o detalhe que estraga em silêncio.** Para o
 * `String.replace`, `$1` é o primeiro grupo e `$&` é o casamento inteiro. Em
 * modo regex isso é exatamente o que se quer; em busca literal, quem digitou
 * `US$1` espera `US$1` — e receberia o grupo 1. Por isso o escape é condicional.
 */
export function substituirNaLinha(
  linha: string,
  regex: RegExp,
  substituto: string,
  usarGrupos: boolean
): string {
  regex.lastIndex = 0;
  const texto = usarGrupos ? substituto : substituto.replace(/\$/g, '$$$$');
  return linha.replace(regex, texto);
}

/** Um arquivo é binário quando tem byte de controle fora de tabulação e quebra. */
export function pareceBinario(conteudo: string): boolean {
  // Só o começo: percorrer um arquivo de 10 MB para decidir isto seria pagar
  // duas vezes pela leitura.
  const amostra = conteudo.slice(0, 8_000);
  for (const caractere of amostra) {
    const codigo = caractere.charCodeAt(0);
    if (codigo === 0) return true;
    if (codigo < 32 && codigo !== 9 && codigo !== 10 && codigo !== 13) return true;
  }
  return false;
}

/** Busca dentro do conteúdo de um arquivo já lido. */
export function buscarNoConteudo(
  conteudo: string,
  regex: RegExp,
  limitePorArquivo = 200
): readonly Ocorrencia[] {
  if (pareceBinario(conteudo)) return [];

  const achadas: Ocorrencia[] = [];
  const linhas = conteudo.split('\n');
  for (let i = 0; i < linhas.length; i += 1) {
    const restante = limitePorArquivo - achadas.length;
    if (restante <= 0) break;
    achadas.push(...ocorrenciasNaLinha(linhas[i] as string, i + 1, regex, restante));
  }
  return achadas;
}

/** Aplica a substituição no conteúdo inteiro; devolve o texto e quantas trocou. */
export function substituirNoConteudo(
  conteudo: string,
  regex: RegExp,
  substituto: string,
  usarGrupos: boolean
): { readonly texto: string; readonly trocas: number } {
  if (pareceBinario(conteudo)) return { texto: conteudo, trocas: 0 };

  const trocas = buscarNoConteudo(conteudo, regex, Number.MAX_SAFE_INTEGER).length;
  if (trocas === 0) return { texto: conteudo, trocas: 0 };

  // Linha a linha, e não no texto inteiro: assim `^` e `$` significam começo e
  // fim de LINHA, que é o que o usuário vê na tela — e é o que o resultado da
  // busca mostrou a ele.
  const texto = conteudo
    .split('\n')
    .map((linha) => substituirNaLinha(linha, regex, substituto, usarGrupos))
    .join('\n');
  return { texto, trocas };
}
