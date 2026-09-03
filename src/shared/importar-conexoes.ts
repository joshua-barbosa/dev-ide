// Importar conexões a partir do arquivo que a exportação gera (N001).
//
// Pedido dele em 02/09/2026, logo depois de o `.desktop` ficar pronto:
// *"faltou o importar conexões baseado no arquivo que a gente exporta"*. É a
// outra metade do N001 — exportar sem importar de volta serve para arquivar, e
// não para levar as conexões ao notebook.
//
// **Puro de propósito.** O que erra aqui é a leitura de um arquivo que veio de
// fora: campo faltando, tipo desconhecido, JSON de outra coisa. Errar isso
// significa gravar lixo no cofre — e o cofre é a última coisa que se quer suja.

export interface ConexaoParaImportar {
  readonly type: string;
  readonly label: string;
  readonly group: string;
  readonly readOnly: boolean;
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * A IDENTIDADE de uma conexão, aos olhos de quem usa.
 *
 * Grupo mais rótulo — que é o que se lê na árvore. O id interno não serve: ele é
 * gerado no cofre de destino, então a mesma conexão exportada e reimportada
 * teria ids diferentes e nunca seria reconhecida como a mesma.
 */
export function identidade(c: { readonly group: string; readonly label: string }): string {
  return `${c.group.trim()}/${c.label.trim()}`;
}

/**
 * Lê o arquivo exportado.
 *
 * Devolve o erro como TEXTO, e não estoura: quem chama vai mostrá-lo na tela, e
 * "Unexpected token < in JSON" não diz a ninguém que o arquivo escolhido era um
 * HTML. Cada recusa aqui diz o que estava errado.
 */
export function lerArquivoDeConexoes(
  texto: string,
  tiposConhecidos: readonly string[]
): { readonly conexoes: readonly ConexaoParaImportar[] } | { readonly erro: string } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { erro: 'Este arquivo não é um JSON válido.' };
  }

  const raiz = bruto as { conexoes?: unknown };
  if (!Array.isArray(raiz.conexoes)) {
    return {
      erro:
        'Não achei a lista `conexoes` neste arquivo. Ele deve ser o que a IDE ' +
        'gera em "Exportar conexões COM as senhas".',
    };
  }

  const conexoes: ConexaoParaImportar[] = [];
  const desconhecidos = new Set<string>();

  for (const [i, item] of (raiz.conexoes as unknown[]).entries()) {
    const c = item as Partial<ConexaoParaImportar>;
    const onde = `conexão #${i + 1}`;
    if (typeof c.type !== 'string' || c.type === '') return { erro: `${onde}: sem \`type\`.` };
    if (typeof c.label !== 'string' || c.label.trim() === '') {
      return { erro: `${onde}: sem \`label\`.` };
    }
    if (typeof c.fields !== 'object' || c.fields === null) {
      return { erro: `${onde} ("${c.label}"): sem \`fields\`.` };
    }
    // Tipo que esta IDE não conhece é RECUSADO, e não importado torto: uma
    // conexão de um driver que não existe apareceria na árvore e falharia ao
    // abrir, sem ninguém entender por quê.
    if (!tiposConhecidos.includes(c.type)) {
      desconhecidos.add(c.type);
      continue;
    }
    conexoes.push({
      type: c.type,
      label: c.label.trim(),
      group: typeof c.group === 'string' ? c.group.trim() : '',
      readOnly: c.readOnly === true,
      fields: c.fields as Record<string, unknown>,
    });
  }

  if (conexoes.length === 0) {
    return {
      erro:
        desconhecidos.size > 0
          ? `Nenhuma conexão aproveitável: esta IDE não conhece ${[...desconhecidos].join(', ')}.`
          : 'O arquivo não tem nenhuma conexão.',
    };
  }
  return { conexoes };
}

export type Politica = 'manter-as-duas' | 'substituir' | 'pular';

export interface Destino {
  readonly conexao: ConexaoParaImportar;
  readonly acao: 'criar' | 'substituir' | 'pular';
  /** O id da conexão existente, quando há conflito. */
  readonly idExistente?: string;
}

export interface Existente {
  readonly id: string;
  readonly label: string;
  readonly group: string;
}

/**
 * O que vai acontecer com cada conexão — ANTES de tocar no cofre.
 *
 * A regra da casa desde a spec 079: a IDE mostra o que vai fazer, e quem manda é
 * ele. Importar às cegas por cima de um cofre com trinta conexões de produção
 * seria o pior lugar possível para uma surpresa.
 */
export function planoDeImportacao(
  existentes: readonly Existente[],
  entrando: readonly ConexaoParaImportar[],
  politica: Politica
): readonly Destino[] {
  const porIdentidade = new Map(existentes.map((e) => [identidade(e), e.id]));

  return entrando.map((conexao) => {
    const id = porIdentidade.get(identidade(conexao));
    if (id === undefined) return { conexao, acao: 'criar' as const };
    if (politica === 'substituir') {
      return { conexao, acao: 'substituir' as const, idExistente: id };
    }
    if (politica === 'pular') return { conexao, acao: 'pular' as const, idExistente: id };
    // `manter-as-duas`: cria assim mesmo. É o padrão porque é o único que não
    // apaga nada — e o rótulo repetido na árvore é visível, ao contrário de uma
    // conexão sobrescrita.
    return { conexao, acao: 'criar' as const, idExistente: id };
  });
}

/** O resumo para a confirmação, em uma linha por desfecho. */
export function resumoDoPlano(plano: readonly Destino[]): string {
  const conta = (a: Destino['acao']): number => plano.filter((d) => d.acao === a).length;
  const partes: string[] = [];
  const novas = plano.filter((d) => d.acao === 'criar' && d.idExistente === undefined).length;
  const repetidas = plano.filter((d) => d.acao === 'criar' && d.idExistente !== undefined).length;

  if (novas > 0) partes.push(`${novas} nova(s)`);
  if (repetidas > 0) partes.push(`${repetidas} repetida(s), que ficarão lado a lado`);
  if (conta('substituir') > 0) partes.push(`${conta('substituir')} substituída(s)`);
  if (conta('pular') > 0) partes.push(`${conta('pular')} pulada(s) por já existir`);
  return partes.join(' · ');
}
