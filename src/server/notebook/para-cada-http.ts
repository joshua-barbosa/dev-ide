// A célula HTTP "para cada item" (spec 120, etapa 4), como a SQL da 114 (B).
//
// Uma requisição por item da lista, em ordem, com `{{item}}` e
// `{{item.campo}}`. Erro de REDE (ou de um `{{ }}` que não existe naquele
// item) PARA ali — os anteriores já valeram. Status 4xx/5xx não para: é
// resposta, como na célula HTTP de sempre; o resumo conta quantos foram.
//
// A tela recebe UMA tabela (item, status, tempo, tamanho, body); a variável
// recebe a lista das respostas inteiras, cada uma com o item que a gerou.
import type { CellValue } from '../../shared/contracts';
import {
  resolverRequisicao, valorDaVariavel, type RequisicaoHttp, type RespostaComoVariavel,
} from '../../shared/notebook/http';
import { comoSaida, type RespostaCompleta } from './requisicao-http';

/** Quanto do body aparece em cada linha da tabela. A variável tem tudo. */
const MAX_BODY_NA_TABELA = 1000;

export interface PedidoParaCadaHttp {
  readonly itens: readonly unknown[];
  /** Com os segredos já trocados; os `{{ }}` ainda não. */
  readonly requisicao: RequisicaoHttp;
  /** Os outros `{{ }}` da célula, já lidos do kernel. */
  readonly outros: Readonly<Record<string, unknown>>;
  /** Manda UMA requisição já resolvida (quem chama aplica autorização, cookies, máscara). */
  enviar(requisicao: RequisicaoHttp): Promise<RespostaCompleta>;
  /** Pedido de parar: olhado ENTRE um item e outro. */
  parar(): boolean;
  aoProgresso(feitos: number, total: number): void;
}

export type RespostaDoItem = RespostaComoVariavel & { readonly item: unknown };

export interface ResultadoParaCadaHttp {
  readonly colunas: readonly string[];
  readonly linhas: readonly (readonly CellValue[])[];
  readonly respostas: readonly RespostaDoItem[];
  /** Quantas voltaram 4xx/5xx. */
  readonly comErroDeStatus: number;
  readonly falha: { readonly item: number; readonly mensagem: string } | null;
  readonly parado: boolean;
}

function bodyNaTabela(body: unknown): string {
  const texto = typeof body === 'string' ? body : JSON.stringify(body) ?? '';
  return texto.length > MAX_BODY_NA_TABELA ? `${texto.slice(0, MAX_BODY_NA_TABELA)}…` : texto;
}

export async function rodarParaCadaHttp(p: PedidoParaCadaHttp): Promise<ResultadoParaCadaHttp> {
  const colunas = ['item', 'status', 'tempo', 'tamanho', 'body'];
  const linhas: CellValue[][] = [];
  const respostas: RespostaDoItem[] = [];
  let comErroDeStatus = 0;
  const total = p.itens.length;
  const fim = (falha: ResultadoParaCadaHttp['falha'], parado: boolean): ResultadoParaCadaHttp =>
    ({ colunas, linhas, respostas, comErroDeStatus, falha, parado });
  p.aoProgresso(0, total);

  for (const [i, item] of p.itens.entries()) {
    if (p.parar()) return fim(null, true);
    try {
      const resposta = await p.enviar(resolverRequisicao(p.requisicao, { ...p.outros, item }));
      const valor = valorDaVariavel(comoSaida(resposta, Infinity));
      respostas.push({ item, ...valor });
      linhas.push([i + 1, valor.status, valor.tempo, valor.tamanho, bodyNaTabela(valor.body)]);
      if (valor.status >= 400) comErroDeStatus += 1;
    } catch (e) {
      // Parado NO MEIO de uma requisição: ela foi cancelada, não falhou.
      if (p.parar()) return fim(null, true);
      return fim({ item: i + 1, mensagem: e instanceof Error ? e.message : String(e) }, false);
    }
    p.aoProgresso(i + 1, total);
  }
  return fim(null, false);
}
