// Problema clicável: da saída do comando para a aba Problems (T008).
//
// A nota dele: *"problem matcher por comando, enchendo a aba Problems com erro
// clicável"*.
//
// **O formato é do compilador, não nosso.** Cada ferramenta escreve o erro do
// seu jeito, e a lista abaixo é de padrões reconhecidos — não de um padrão
// inventado que as ferramentas deveriam seguir. Quando nenhum casa, a linha
// fica de fora: uma linha de saída comum virando "problema" encheria a aba de
// ruído, e aí ninguém olha mais para ela.
//
// A ordem dos padrões importa: o mais específico primeiro. `tsc` e `eslint`
// escrevem parecido, e o padrão genérico casaria os dois de forma pior.

export interface ProblemaAchado {
  readonly caminho: string;
  readonly linha: number;
  readonly coluna: number;
  readonly severidade: 'erro' | 'aviso' | 'nota';
  readonly mensagem: string;
  /** O código do erro, quando a ferramenta dá um. */
  readonly codigo?: string;
}

interface Padrao {
  readonly nome: string;
  readonly regex: RegExp;
  /** Em que grupo do regex está cada campo. */
  readonly campos: {
    readonly caminho: number;
    readonly linha: number;
    readonly coluna?: number;
    readonly severidade?: number;
    readonly codigo?: number;
    readonly mensagem: number;
  };
}

const PADROES: readonly Padrao[] = [
  {
    // `src/a.ts(12,5): error TS2304: Cannot find name 'x'.`
    nome: 'typescript',
    regex: /^\s*(\S.*?)\((\d+),(\d+)\):\s+(error|warning|info)\s+([A-Z]+\d+):\s+(.*)$/,
    campos: { caminho: 1, linha: 2, coluna: 3, severidade: 4, codigo: 5, mensagem: 6 },
  },
  {
    // `a.py:12:5: E501 line too long` — ruff, flake8.
    nome: 'ruff',
    regex: /^\s*(\S.*?):(\d+):(\d+):\s+([A-Z]+\d+)\s+(.*)$/,
    campos: { caminho: 1, linha: 2, coluna: 3, codigo: 4, mensagem: 5 },
  },
  {
    // `src/a.ts:12:5: error: mensagem` — gcc, clang, eslint compacto, e outros.
    //
    // Vem DEPOIS do `ruff`: os dois têm a mesma forma até a coluna, e este
    // casaria `E501 line too long` como se `E501` fosse a mensagem inteira —
    // perdendo o código, que é o que se procura na documentação.
    nome: 'gnu',
    regex: /^\s*(\S.*?):(\d+):(\d+):\s*(error|warning|note|erro|aviso)?:?\s*(.*)$/i,
    campos: { caminho: 1, linha: 2, coluna: 3, severidade: 4, mensagem: 5 },
  },
  {
    // `  File "app.py", line 12, in <module>` — o traceback do Python.
    //
    // Ele NÃO traz a mensagem na mesma linha: ela vem no fim do traceback. Por
    // isso o casamento aqui é só do lugar, e quem junta a mensagem é
    // `lerSaida`, que enxerga as linhas seguintes.
    nome: 'python',
    regex: /^\s*File "([^"]+)", line (\d+)/,
    campos: { caminho: 1, linha: 2, mensagem: 0 },
  },
  {
    // `PHP Parse error: ... in /var/www/a.php on line 12`
    nome: 'php',
    regex: /^(?:PHP\s+)?(Parse error|Fatal error|Warning|Notice|Deprecated):\s*(.*?)\s+in\s+(\S+)\s+on line\s+(\d+)/i,
    campos: { caminho: 3, linha: 4, severidade: 1, mensagem: 2 },
  },
];

function severidadeDe(bruta: string | undefined): ProblemaAchado['severidade'] {
  const s = (bruta ?? '').toLowerCase();
  if (s.startsWith('warn') || s === 'aviso' || s === 'notice' || s === 'deprecated') {
    return 'aviso';
  }
  if (s === 'note' || s === 'info') return 'nota';
  // O padrão é ERRO, e não "nota": uma ferramenta que não diz a severidade
  // costuma estar reclamando de algo. Chamar de nota esconderia o problema no
  // meio da lista.
  return 'erro';
}

/**
 * Tira os códigos de cor ANSI.
 *
 * **Sem isto, nada de Python casa.** O Python 3.13 passou a colorir o traceback,
 * e a linha que chega é `File \x1b[35m"/tmp/x.py"\x1b[0m, line \x1b[35m2\x1b[0m`
 * — o `"` deixa de vir logo depois de `File `, e o regex falha. Foi medido na
 * saída real desta máquina, e não deduzido.
 *
 * Vale para todo mundo: `ruff`, `tsc` e `gcc` também colorem quando acham que
 * estão falando com um terminal.
 */
export function semCores(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Onde o arquivo REALMENTE está, quando ele foi executado por cópia.
 *
 * A execução de um trecho — ou de uma aba com alteração não salva — copia o
 * código para `/tmp/dev-ide-run-XXXX/main.py` e roda de lá. O traceback aponta
 * para a cópia, que é apagada logo depois: clicar no problema abriria um
 * arquivo que não existe mais.
 *
 * `arquivoReal` é o que a aba estava mostrando. Só a cópia é traduzida — um
 * traceback que passa por uma biblioteca do sistema continua apontando para ela.
 */
function traduzirCopia(caminho: string, arquivoReal: string | undefined): string {
  if (arquivoReal === undefined) return caminho;
  return /(^|\/)dev-ide-run-[^/]+\/main\.[a-z]+$/.test(caminho) ? arquivoReal : caminho;
}

/**
 * Lê a saída de um comando e devolve os problemas.
 *
 * `raiz` serve para transformar caminho relativo em absoluto — a aba Problems
 * precisa abrir o arquivo, e `src/a.ts` sozinho não diz de qual projeto é.
 *
 * `arquivoReal` desfaz a cópia temporária da execução — ver `traduzirCopia`.
 */
export function lerSaida(
  saida: string,
  raiz: string,
  arquivoReal?: string
): readonly ProblemaAchado[] {
  const linhas = semCores(saida).split('\n');
  const achados: ProblemaAchado[] = [];

  for (const [i, linha] of linhas.entries()) {
    for (const padrao of PADROES) {
      const m = padrao.regex.exec(linha);
      if (m === null) continue;

      const caminho = m[padrao.campos.caminho] ?? '';
      const numero = Number(m[padrao.campos.linha]);
      if (caminho === '' || !Number.isFinite(numero)) break;

      // O Python traz a mensagem no FIM do traceback, e não aqui. A última
      // linha não vazia do bloco é ela — é o que se lê quando algo estoura.
      const mensagem =
        padrao.nome === 'python'
          ? (mensagemDoTraceback(linhas, i) ?? 'Erro em Python')
          : (m[padrao.campos.mensagem] ?? '').trim();

      const coluna =
        padrao.campos.coluna === undefined ? 1 : Number(m[padrao.campos.coluna] ?? 1);
      const codigo =
        padrao.campos.codigo === undefined ? undefined : m[padrao.campos.codigo];

      achados.push({
        caminho: traduzirCopia(absoluto(caminho, raiz), arquivoReal),
        linha: Math.max(1, numero),
        coluna: Number.isFinite(coluna) ? Math.max(1, coluna) : 1,
        severidade: severidadeDe(
          padrao.campos.severidade === undefined ? undefined : m[padrao.campos.severidade]
        ),
        mensagem,
        ...(codigo === undefined || codigo === '' ? {} : { codigo }),
      });
      // Uma linha vira NO MÁXIMO um problema: sem o `break`, a mesma linha
      // casaria em dois padrões e apareceria duas vezes na aba.
      break;
    }
  }

  return semRepetidos(achados);
}

/**
 * A mensagem de um traceback do Python: a última linha não vazia depois do
 * `File "..."`, que é onde o `ValueError: ...` aparece.
 */
function mensagemDoTraceback(linhas: readonly string[], deOnde: number): string | null {
  for (let i = linhas.length - 1; i > deOnde; i -= 1) {
    const linha = (linhas[i] ?? '').trim();
    if (linha === '') continue;
    // A linha do traceback que aponta o código-fonte não é a mensagem.
    if (linha.startsWith('File "') || linha.startsWith('Traceback')) continue;
    return linha;
  }
  return null;
}

function absoluto(caminho: string, raiz: string): string {
  if (caminho.startsWith('/')) return caminho;
  return `${raiz.replace(/\/+$/, '')}/${caminho.replace(/^\.\//, '')}`;
}

/**
 * Tira problemas repetidos.
 *
 * Um `tsc --watch` reimprime o mesmo erro a cada ciclo, e a aba encheria de
 * linhas idênticas. A chave é arquivo + linha + coluna + mensagem: o mesmo erro
 * em duas colunas diferentes continua sendo dois problemas.
 */
function semRepetidos(achados: readonly ProblemaAchado[]): readonly ProblemaAchado[] {
  const vistos = new Set<string>();
  const saida: ProblemaAchado[] = [];
  for (const p of achados) {
    const chave = `${p.caminho}:${p.linha}:${p.coluna}:${p.mensagem}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(p);
  }
  return saida;
}
