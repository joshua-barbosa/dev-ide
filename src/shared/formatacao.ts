// Beautify e Minify: quem pode o quê, e por que o que falta, falta.
//
// Ele pediu os dois, e definiu `minify` com todas as letras:
// *"quando eu digo minify é colocar tudo em uma linha. Não criar um arquivo
// .min"*. Então os dois agem no documento ABERTO, em cima dele — o `Ctrl+Z`
// desfaz, e nenhum arquivo novo aparece na árvore.
//
// **O servidor declara, a interface obedece** (Artigo III). Cada linguagem diz
// o que sabe fazer e, quando não sabe, diz o motivo — o item do menu continua
// aparecendo e explica, em vez de sumir e deixar a pessoa procurando.
//
// Este arquivo é a TABELA. Quem chama a biblioteca é o `server/formatador.ts`;
// aqui não entra nada que precise de Node, para a interface poder ler a mesma
// declaração sem carregar o Prettier.

export type ModoDeFormatacao = 'beautify' | 'minify';

export interface Capacidade {
  readonly beautify: boolean;
  readonly minify: boolean;
  /**
   * Por que cada modo indisponível está indisponível — **um motivo por modo**.
   *
   * Um campo só não serve: Python recusa os dois por razões diferentes (o
   * beautify porque falta ferramenta na máquina, o minify porque a indentação é
   * a sintaxe), e um motivo compartilhado faria a IDE mentir numa das duas.
   *
   * Presente sempre que `beautify` ou `minify` for falso: um item de menu que
   * não faz nada e não explica é pior que um item ausente.
   */
  readonly porQueNao: Readonly<Partial<Record<ModoDeFormatacao, string>>>;
  /** Comando que instala a ferramenta que habilitaria o que falta. */
  readonly instalar?: string;
}

/**
 * O motivo que se repete: **a indentação É a sintaxe**.
 *
 * Python, YAML e Dockerfile não têm "uma linha só" — colapsar destrói o
 * arquivo em vez de encolhê-lo. Não é limitação de biblioteca, é da linguagem.
 */
const INDENTACAO_E_SINTAXE =
  'Minify não existe aqui: nesta linguagem a quebra de linha e a indentação ' +
  'fazem parte da sintaxe, e pôr tudo numa linha destrói o arquivo em vez de ' +
  'encolhê-lo.';

/**
 * O que cada linguagem sabe fazer.
 *
 * As chaves são os ids de linguagem DESTA IDE (`shared/editor/languages.ts`),
 * e não os do Monaco: é o que a aba aberta carrega. O teste de cruzamento
 * garante que nenhuma chave daqui seja um id que não existe.
 */
export const CAPACIDADES: Readonly<Record<string, Capacidade>> = {
  javascript: { beautify: true, minify: true, porQueNao: {} },
  typescript: {
    beautify: true,
    minify: false,
    porQueNao: {
      // Todo minificador de verdade emite JavaScript. Fazer isso e chamar de
      // "minify do TypeScript" devolveria um arquivo que não é mais
      // TypeScript, dentro de uma aba que continua dizendo que é.
      minify:
        'Minify apagaria os tipos: todo minificador emite JavaScript, e o que ' +
        'voltasse para a aba não seria mais TypeScript. Use o Beautify aqui, e ' +
        'o Minify no .js gerado pelo build.',
    },
  },
  json: { beautify: true, minify: true, porQueNao: {} },
  html: { beautify: true, minify: true, porQueNao: {} },
  css: { beautify: true, minify: true, porQueNao: {} },
  sql: { beautify: true, minify: true, porQueNao: {} },
  xml: { beautify: true, minify: true, porQueNao: {} },
  markdown: {
    beautify: true,
    minify: false,
    porQueNao: {
      minify:
        'Minify não existe aqui: em Markdown a quebra de linha e a linha em ' +
        'branco são o que separa parágrafo de parágrafo.',
    },
  },
  php: {
    beautify: true,
    minify: false,
    // O `php -w` faria isso, mas roda o arquivo pelo lexer do PHP da máquina e
    // devolve o resultado por stdout — e um `.php` de template vira uma linha
    // só de HTML colado. Fica de fora até ele pedir.
    porQueNao: {
      minify:
        'Minify não existe aqui: o que colapsaria o PHP colapsaria junto o ' +
        'HTML em volta dele, e template de uma linha só é ilegível para sempre.',
    },
  },
  blade: {
    beautify: true,
    minify: false,
    porQueNao: {
      minify:
        'Minify não existe aqui: Blade é template, e o que colapsaria as ' +
        'diretivas colapsaria o HTML em volta delas.',
    },
  },
  yaml: { beautify: true, minify: false, porQueNao: { minify: INDENTACAO_E_SINTAXE } },
  dockerfile: {
    beautify: true, minify: false, porQueNao: { minify: INDENTACAO_E_SINTAXE },
  },
  python: {
    beautify: true,
    minify: false,
    porQueNao: { minify: INDENTACAO_E_SINTAXE },
  },
};

/**
 * A capacidade de uma linguagem, já com o que a MÁQUINA oferece.
 *
 * O Python é o único caso: não existe formatador de Python decente em
 * JavaScript, e o que a biblioteca padrão faz (`ast.unparse`) **apaga os
 * comentários**. Então ele depende de uma ferramenta instalada, e a IDE diz
 * qual quando ela não está — em vez de oferecer um botão que falha.
 */
export function capacidadeDe(
  linguagem: string,
  ferramentas: { readonly formatadorDePython: string | null } = { formatadorDePython: null }
): Capacidade {
  const base = CAPACIDADES[linguagem];
  if (base === undefined) {
    const naoSei = `Esta IDE ainda não sabe formatar "${linguagem}".`;
    return {
      beautify: false,
      minify: false,
      porQueNao: { beautify: naoSei, minify: naoSei },
    };
  }
  if (linguagem !== 'python' || ferramentas.formatadorDePython !== null) return base;
  return {
    ...base,
    beautify: false,
    // O motivo do `minify` continua sendo o dele: são recusas diferentes, e
    // juntá-las num campo só faria a IDE dizer "instale o ruff" para quem
    // tentou minificar — o que o ruff não resolveria.
    porQueNao: {
      ...base.porQueNao,
      beautify:
        'Beautify de Python precisa do ruff ou do black nesta máquina. Não ' +
        'existe formatador de Python decente em JavaScript, e o que a ' +
        'biblioteca padrão do Python faria apagaria os seus comentários.',
    },
    instalar: 'pip install ruff',
  };
}

/** Se o modo está disponível; senão, o motivo pronto para a tela. */
export function podeFormatar(
  capacidade: Capacidade,
  modo: ModoDeFormatacao
): { readonly pode: true } | { readonly pode: false; readonly motivo: string } {
  if (modo === 'beautify' ? capacidade.beautify : capacidade.minify) return { pode: true };
  const motivo = capacidade.porQueNao[modo] ?? 'Indisponível nesta linguagem.';
  // O `instalar` só entra quando a ferramenta resolveria ESTE modo: mandar
  // instalar o ruff para quem tentou minificar seria conselho errado.
  const instalar =
    capacidade.instalar === undefined || modo !== 'beautify' ? '' : `\n\n${capacidade.instalar}`;
  return { pode: false, motivo: `${motivo}${instalar}` };
}

/**
 * Colapsa SQL numa linha só, respeitando texto e comentário.
 *
 * Regex simples quebraria isto aqui, e por isso a função existe:
 *
 * - `'a  b'` e `"a  b"` têm espaço que É dado, e não pode encolher;
 * - `--` comenta até o fim da LINHA, e sobreviver numa linha só apagaria tudo
 *   o que viesse depois. Ele é **removido**, que é a única saída honesta;
 * - `/* … *\/` atravessa linha e continua valendo, então fica.
 *
 * O aspas-duplas é identificador no Postgres e texto no MySQL — nos dois casos
 * o conteúdo é intocável, então não é preciso saber qual é.
 */
export function sqlNumaLinha(texto: string): string {
  const partes: string[] = [];
  let i = 0;
  /** Espaço pendente: só vira um espaço se ainda vier algo depois. */
  let espaco = false;

  const empurrar = (pedaco: string): void => {
    if (espaco && partes.length > 0) partes.push(' ');
    espaco = false;
    partes.push(pedaco);
  };

  while (i < texto.length) {
    const c = texto[i] as string;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      espaco = true;
      i += 1;
      continue;
    }

    if (c === '-' && texto[i + 1] === '-') {
      // Some inteiro, junto com a quebra de linha que o terminava.
      const fim = texto.indexOf('\n', i);
      i = fim === -1 ? texto.length : fim + 1;
      espaco = true;
      continue;
    }

    if (c === '/' && texto[i + 1] === '*') {
      const fim = texto.indexOf('*/', i + 2);
      const ate = fim === -1 ? texto.length : fim + 2;
      // O conteúdo do comentário também vira uma linha: um `/*` de duas linhas
      // continua fechando, mas fica largo. Encolher aqui é seguro.
      empurrar(texto.slice(i, ate).replace(/\s+/g, ' '));
      i = ate;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < texto.length) {
        // `''` dentro de texto é uma aspa escapada, e não o fim dele.
        if (texto[j] === c && texto[j + 1] === c) { j += 2; continue; }
        if (texto[j] === '\\' && c === "'") { j += 2; continue; }
        if (texto[j] === c) { j += 1; break; }
        j += 1;
      }
      empurrar(texto.slice(i, j));
      i = j;
      continue;
    }

    // Um pedaço comum vai inteiro: caractere a caractere seria o mesmo
    // resultado por muito mais trabalho.
    let j = i;
    while (j < texto.length && !/[\s'"`]/.test(texto[j] as string)) {
      if (texto[j] === '-' && texto[j + 1] === '-') break;
      if (texto[j] === '/' && texto[j + 1] === '*') break;
      j += 1;
    }
    empurrar(texto.slice(i, j));
    i = j;
  }

  return partes.join('');
}
