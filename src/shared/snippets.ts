// Snippets: prefixo que vira corpo, com marcadores de parada.
//
// **O que mudou desde o levantamento:** o backlog registrava que marcador
// espelhado — o mesmo `$1` em dois lugares, editado nos dois ao mesmo tempo —
// não caberia, porque exigiria multi-cursor. A spec 010 trocou o editor pelo
// Monaco, que tem snippet nativo com espelho. Este módulo, então, guarda; quem
// insere é o editor.
//
// A linguagem `*` vale em todas: metade do que se repete não é de linguagem
// nenhuma (cabeçalho de licença, `TODO` com data), e exigir escolher uma seria
// atrito sem ganho.

export const LINGUAGEM_TODAS = '*';

export interface Snippet {
  readonly id: string;
  readonly nome: string;
  /** O que se digita para chamá-lo. Único por linguagem. */
  readonly prefixo: string;
  /** Corpo com marcadores do Monaco: `$1`, `${1:valor}`, `$0`. */
  readonly corpo: string;
  /** Id de linguagem do editor, ou `*`. */
  readonly linguagem: string;
}

export const MAX_PREFIXO = 40;
export const MAX_CORPO = 8_000;

/** Fronteira rígida: o que a rota recebe. */
export function validarSnippet(
  bruto: unknown,
  existentes: readonly Snippet[] = []
): Omit<Snippet, 'id'> {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const nome = typeof r.nome === 'string' ? r.nome.trim() : '';
  const prefixo = typeof r.prefixo === 'string' ? r.prefixo.trim() : '';
  const corpo = typeof r.corpo === 'string' ? r.corpo : '';
  const linguagem = typeof r.linguagem === 'string' && r.linguagem.trim() !== ''
    ? r.linguagem.trim()
    : LINGUAGEM_TODAS;

  if (prefixo === '') throw new Error('O snippet precisa de um prefixo.');
  if (/\s/.test(prefixo)) {
    // Prefixo com espaço nunca dispararia: a conclusão do editor casa a palavra
    // que está sendo digitada, e ela termina no espaço.
    throw new Error('O prefixo não pode ter espaços — ele é a palavra que dispara o snippet.');
  }
  if (prefixo.length > MAX_PREFIXO) throw new Error(`O prefixo passa de ${MAX_PREFIXO} caracteres.`);
  if (corpo.trim() === '') throw new Error('O corpo do snippet não pode ser vazio.');
  if (corpo.length > MAX_CORPO) throw new Error(`O corpo passa de ${MAX_CORPO} caracteres.`);

  // Repetido só conta dentro da MESMA linguagem: `log` em TypeScript e `log` em
  // PHP são snippets diferentes e legítimos.
  if (existentes.some((s) => s.linguagem === linguagem && s.prefixo === prefixo)) {
    throw new Error(
      `Já existe um snippet com o prefixo "${prefixo}" para ${rotuloDaLinguagem(linguagem)}.`
    );
  }
  return { nome: nome === '' ? prefixo : nome, prefixo, corpo, linguagem };
}

export function rotuloDaLinguagem(linguagem: string): string {
  return linguagem === LINGUAGEM_TODAS ? 'todas as linguagens' : linguagem;
}

/** Fronteira tolerante: o que o arquivo traz. */
export function normalizarSnippets(bruto: unknown): readonly Snippet[] {
  if (!Array.isArray(bruto)) return [];
  const saida: Snippet[] = [];
  for (const item of bruto) {
    const r = (item ?? {}) as Record<string, unknown>;
    if (
      typeof r.id !== 'string' || r.id === '' ||
      typeof r.prefixo !== 'string' || r.prefixo.trim() === '' ||
      typeof r.corpo !== 'string' || r.corpo.trim() === ''
    ) {
      continue;
    }
    saida.push({
      id: r.id,
      nome: typeof r.nome === 'string' && r.nome.trim() !== '' ? r.nome : r.prefixo,
      prefixo: r.prefixo,
      corpo: r.corpo,
      linguagem:
        typeof r.linguagem === 'string' && r.linguagem.trim() !== ''
          ? r.linguagem
          : LINGUAGEM_TODAS,
    });
  }
  return saida;
}

/** Os que valem numa linguagem: os dela mais os coringa. */
export function snippetsDaLinguagem(
  todos: readonly Snippet[],
  linguagem: string
): readonly Snippet[] {
  return todos.filter((s) => s.linguagem === linguagem || s.linguagem === LINGUAGEM_TODAS);
}

/** As linguagens que têm snippet — é o que decide onde registrar a conclusão. */
export function linguagensComSnippet(todos: readonly Snippet[]): readonly string[] {
  return [...new Set(todos.map((s) => s.linguagem))];
}
