// Fórmula matemática no preview de markdown (T026 · spec 024).
//
// Na spec 024 eu listei "renderizar Mermaid ou LaTeX" nos `Non-Goals` sem
// escrever desculpa nenhuma. Ele mandou fazer os dois.
//
// **O KaTeX gera o HTML, e não eu.** Com `trust: false` (o padrão) ele recusa
// os comandos que produzem marcação arbitrária — `\href`, `\url`, `\includegraphics`
// — e escapa o resto. Montar esse HTML à mão aqui seria refazer, pior, um
// trabalho que a biblioteca já faz sob teste.
//
// Isto é o RECONHECIMENTO: separar o que é fórmula do que é texto. Puro e
// testável sem navegador, que é o motivo de estar em `shared`.

export interface Formula {
  readonly inicio: number;
  readonly fim: number;
  readonly conteudo: string;
  /** `bloco` é `$$…$$`, que vira parágrafo próprio e centralizado. */
  readonly modo: 'linha' | 'bloco';
}

/**
 * Acha as fórmulas de uma linha de texto.
 *
 * `$$` antes de `$`: sem essa ordem, `$$x$$` seria lido como duas fórmulas
 * vazias em volta de um `x`.
 *
 * O que NÃO conta como fórmula, e por quê:
 *   - `$` sozinho, sem par — é dinheiro, e `R$ 10` não pode virar matemática;
 *   - `$` seguido de espaço ou dígito — `US$ 5` e `$100` são preço;
 *   - conteúdo vazio (`$$`), que não tem o que renderizar.
 */
export function acharFormulas(texto: string): readonly Formula[] {
  const achadas: Formula[] = [];
  let i = 0;

  while (i < texto.length) {
    if (texto[i] !== '$') {
      i += 1;
      continue;
    }
    // Escapado pelo usuário: `\$` é um cifrão literal, e não abre fórmula.
    if (i > 0 && texto[i - 1] === '\\') {
      i += 1;
      continue;
    }

    const bloco = texto[i + 1] === '$';
    const marca = bloco ? '$$' : '$';
    const abre = i + marca.length;

    // `$ ` ou `$5` é preço, não fórmula. A regra vale só para o modo de linha:
    // `$$ x $$` com espaço é escrita comum de bloco.
    if (!bloco) {
      const depois = texto[abre];
      if (depois === undefined || depois === ' ' || (depois >= '0' && depois <= '9')) {
        i += 1;
        continue;
      }
    }

    const fecha = texto.indexOf(marca, abre);
    if (fecha === -1) {
      i += 1;
      continue;
    }
    const conteudo = texto.slice(abre, fecha);
    if (conteudo.trim() === '') {
      i = fecha + marca.length;
      continue;
    }

    achadas.push({
      inicio: i,
      fim: fecha + marca.length,
      conteudo,
      modo: bloco ? 'bloco' : 'linha',
    });
    i = fecha + marca.length;
  }

  return achadas;
}

/** O texto tem alguma fórmula? Decide se vale carregar o KaTeX. */
export function temFormula(texto: string): boolean {
  return acharFormulas(texto).length > 0;
}
