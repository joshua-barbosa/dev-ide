// A célula SQL "para cada item" (spec 114, B).
//
// O pedido: *"se me passarem uma lista de ids… eu preciso rodar a function
// ModoBusca para cada uma delas… no SQL eu queria fazer tipo um for each"*.
// O comando roda uma vez por item da lista; dentro dele, `{{item}}` é o item
// e `{{item.id}}` um campo. Cada execução vale sozinha (como o `sql()`), e um
// item que falha PARA ali — o recado diz qual, e os anteriores já valeram.
// SELECTs viram UMA tabela, com a coluna `item` (1, 2, 3…) na frente.
import type { CellValue, QueryResult } from '../../shared/contracts';
import { montarSqlComParametros, type EstiloDeParametro } from '../../shared/notebook/parametros';

export interface PedidoParaCada {
  readonly itens: readonly unknown[];
  readonly texto: string;
  /** Os outros `{{ }}` da célula, já lidos do kernel. */
  readonly outros: Readonly<Record<string, unknown>>;
  readonly estilo: EstiloDeParametro;
  /** O banco: com ele, `FROM {{lista}}` vira tabela (spec 114, D). */
  readonly dialeto?: string;
  executar(statement: string, params: readonly unknown[]): Promise<QueryResult>;
  /** Pedido de parar: olhado ENTRE um item e outro. */
  parar(): boolean;
  aoProgresso(feitos: number, total: number): void;
}

export interface ResultadoParaCada {
  /** Com `item` na frente, quando houve SELECT. */
  readonly colunas: readonly string[];
  readonly linhas: readonly (readonly CellValue[])[];
  /** Quantas execuções terminaram bem. */
  readonly comandos: number;
  /** Quantas execuções foram ESCRITAS (sem colunas de volta). */
  readonly escritas: number;
  /** Soma das linhas afetadas; `null` se o banco não conta (Postgres, SQL Server). */
  readonly linhasAfetadas: number | null;
  readonly falha: { readonly item: number; readonly mensagem: string } | null;
  readonly parado: boolean;
}

export async function rodarParaCada(p: PedidoParaCada): Promise<ResultadoParaCada> {
  let colunas: string[] = [];
  const linhas: CellValue[][] = [];
  let comandos = 0;
  let afetadas: number | null = 0;
  let escritas = 0;
  const total = p.itens.length;
  p.aoProgresso(0, total);

  for (const [i, item] of p.itens.entries()) {
    if (p.parar()) return { colunas, linhas, comandos, escritas, linhasAfetadas: afetadas, falha: null, parado: true };
    try {
      const { sql, params } = montarSqlComParametros(p.texto, { ...p.outros, item }, p.estilo, p.dialeto);
      const r = await p.executar(sql, params);
      if (r.columns.length > 0) {
        const nomes = r.columns.map((c) => c.name);
        if (colunas.length === 0) colunas = ['item', ...nomes];
        // Pelo NOME: um item que devolva as colunas noutra ordem não embaralha.
        for (const linha of r.rows) {
          linhas.push([i + 1, ...colunas.slice(1).map((c) => (nomes.includes(c) ? linha[nomes.indexOf(c)] : null))]);
        }
      } else {
        escritas += 1;
        if (afetadas !== null) afetadas = /linha\(s\) afetada/.test(r.message ?? '') ? afetadas + r.rowCount : null;
      }
      comandos += 1;
    } catch (e) {
      return {
        colunas, linhas, comandos, escritas, linhasAfetadas: afetadas, parado: false,
        falha: { item: i + 1, mensagem: e instanceof Error ? e.message : String(e) },
      };
    }
    p.aoProgresso(i + 1, total);
  }
  return { colunas, linhas, comandos, escritas, linhasAfetadas: afetadas, falha: null, parado: false };
}
