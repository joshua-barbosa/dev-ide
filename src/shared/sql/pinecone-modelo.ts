// Pinecone numa árvore e numa grade.
//
// Um banco vetorial não tem tabela nem chave: tem **índices**, cada um com
// **namespaces**, e dentro deles vetores com metadados. A busca não é por
// igualdade — é por proximidade, e devolve uma NOTA junto de cada resultado.
//
// **É a nota que não cabe em lugar nenhum do formato**, e por isso ela vira a
// primeira coluna: quem lê um resultado vetorial precisa saber o quanto cada
// item se parece com o que foi perguntado. Sem ela, dez linhas parecem
// igualmente boas — e não são.

export interface IndiceVetorial {
  readonly nome: string;
  readonly dimensao: number;
  readonly metrica: string;
  readonly vetores: number;
}

export interface NamespaceVetorial {
  readonly nome: string;
  readonly vetores: number;
}

/**
 * O rótulo do namespace na árvore.
 *
 * O namespace padrão do Pinecone tem nome VAZIO, e uma linha em branco na
 * árvore parece defeito. `(padrão)` diz o que é.
 */
export function rotuloDoNamespace(nome: string): string {
  return nome === '' ? '(padrão)' : nome;
}

/** O texto cinza do índice: o que se quer saber de relance. */
export function detalheDoIndice(i: IndiceVetorial): string {
  return `${i.dimensao}d · ${i.metrica} · ${i.vetores.toLocaleString('pt-BR')}`;
}

export interface AcertoVetorial {
  readonly id: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * A grade de um resultado de busca.
 *
 * `score` primeiro, `id` depois, e então os metadados — **na ordem de
 * aparição**, como no Mongo. Alfabetar esconderia qual metadado o índice
 * considera principal.
 *
 * A nota é mostrada com quatro casas: com duas, resultados vizinhos aparecem
 * como iguais, e distinguir vizinhos é exatamente o uso de uma busca vetorial.
 */
export function gradeDaBusca(
  acertos: readonly AcertoVetorial[]
): { readonly colunas: readonly string[]; readonly linhas: readonly (readonly (string | null)[])[] } {
  const metadados: string[] = [];
  const jaTem = new Set<string>();
  for (const a of acertos) {
    for (const k of Object.keys(a.metadata ?? {})) {
      if (jaTem.has(k)) continue;
      jaTem.add(k);
      metadados.push(k);
    }
  }

  const colunas = ['score', 'id', ...metadados];
  const linhas = acertos.map((a) => [
    a.score.toFixed(4),
    a.id,
    ...metadados.map((k) => {
      const v = a.metadata?.[k];
      if (v === undefined || v === null) return null;
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }),
  ]);
  return { colunas, linhas };
}

/**
 * Lê o vetor que a pessoa digitou.
 *
 * Aceita uma lista JSON de números. **Confere a dimensão contra o índice**: um
 * vetor de tamanho errado é recusado pelo Pinecone com uma mensagem sobre
 * dimensões que não diz qual era a esperada — e essa é a informação que falta.
 */
export function lerVetor(
  texto: string,
  dimensaoEsperada: number
): { vetor: readonly number[] } | { erro: string } {
  let lido: unknown;
  try {
    lido = JSON.parse(texto.trim());
  } catch {
    return { erro: 'O vetor precisa ser uma lista JSON de números — por exemplo `[0.1, 0.2, …]`.' };
  }
  if (!Array.isArray(lido) || lido.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return { erro: 'A lista precisa conter só números finitos.' };
  }
  if (lido.length !== dimensaoEsperada) {
    return {
      erro:
        `Este índice espera ${dimensaoEsperada} dimensões, e o vetor tem ` +
        `${lido.length}. O Pinecone recusaria sem dizer qual era a esperada.`,
    };
  }
  return { vetor: lido as number[] };
}
