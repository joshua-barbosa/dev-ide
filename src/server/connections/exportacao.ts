// Exportar a TABELA INTEIRA, e não só a página (T058 · spec 041).
//
// Na spec 041 eu escrevi que exportar tudo "é outra coisa — varre o banco, não a
// tela", e deixei de fora. É verdade que é outra coisa; não era motivo para não
// fazer. Ele resgatou da lista dos 114, com uma correção: na tela de RESULTADO
// tem que sair tudo que a query devolveu, e não o que está na página.
//
// Mora aqui, e não em cada driver, porque `readTable` já existe nos três e já
// sabe filtrar, ordenar e paginar. Varrer é chamá-lo em sequência — nenhum
// driver precisa de uma linha nova.
import type { CellValue, ColumnInfo, TablePage, TableRequest } from '../../shared/contracts';

/**
 * Teto de linhas por exportação.
 *
 * Não é limite de recurso do servidor: é o navegador. O arquivo inteiro passa
 * pela memória da aba antes de virar download, e uma tabela de cinco milhões de
 * linhas mataria a IDE — "travou" é resposta pior que "exportei cem mil e te
 * avisei".
 */
export const MAX_LINHAS_EXPORTADAS = 100_000;

/** Quantas linhas por ida ao banco. Grande o bastante para não ser latência. */
const POR_LOTE = 1_000;

export interface Exportacao {
  readonly columns: readonly ColumnInfo[];
  readonly rows: readonly (readonly CellValue[])[];
  /** Bateu no teto: quem mostra PRECISA dizer isso. */
  readonly truncado: boolean;
}

export interface PedidoDeExportacao {
  readonly nodePath: readonly string[];
  readonly ordenar: TableRequest['ordenar'];
  readonly filtros: TableRequest['filtros'];
}

/**
 * Varre a tabela em lotes, com os MESMOS filtros e ordem da tela.
 *
 * A ordem importa mais do que parece: sem `ORDER BY`, um `LIMIT/OFFSET` em
 * páginas sucessivas pode repetir e pular linhas — o banco não promete ordem
 * estável entre consultas. Quando a tela não ordenou, quem chama decide se
 * aceita isso; a IDE avisa.
 */
export async function varrerTabela(
  ler: (request: TableRequest) => Promise<TablePage>,
  pedido: PedidoDeExportacao
): Promise<Exportacao> {
  const linhas: (readonly CellValue[])[] = [];
  let columns: readonly ColumnInfo[] = [];
  let pagina = 1;

  for (;;) {
    const lote = await ler({
      nodePath: pedido.nodePath,
      pagina,
      porPagina: POR_LOTE,
      ordenar: pedido.ordenar,
      filtros: pedido.filtros,
    });
    if (columns.length === 0) {
      columns = lote.columns.map((c) => ({ name: c.name, type: c.type }));
    }
    const vindas = lote.resultado.rows;
    linhas.push(...vindas);

    // Lote incompleto significa fim: pedir a próxima página seria uma ida a
    // mais ao banco para receber zero linhas.
    if (vindas.length < POR_LOTE) return { columns, rows: linhas, truncado: false };
    if (linhas.length >= MAX_LINHAS_EXPORTADAS) {
      return { columns, rows: linhas.slice(0, MAX_LINHAS_EXPORTADAS), truncado: true };
    }
    pagina += 1;
  }
}
