// As rotas do SQL do notebook (spec 112; várias linguagens na 113; "para
// cada" na 114, B). Separadas de `notebook.ts`: cresceram até virar um assunto.
//
// O resultado vai para CADA linguagem do notebook, subindo o kernel que
// faltar; `{{nome}}` lê de quem mudou o nome por último (a cascata); a tela
// recebe a VISTA (as primeiras linhas e o total), os kernels recebem tudo.
import type { Router } from 'express';
import { requireString, wrap } from '../http/handlers';
import type { SessionPool } from '../connections/pool';
import type { GerenteDeKernels } from '../notebook/gerente';
import { rodarParaCada } from '../notebook/para-cada';
import { nomeValido, saidaDeTabela, type Kernel as LinguagemDoKernel } from '../../shared/notebook/modelo';
import {
  colunasPedidas, montarSqlComParametros, referenciasDoSql, tabelasPedidas, type EstiloDeParametro,
} from '../../shared/notebook/parametros';
import type { CellValue, ParametroDeConsulta } from '../../shared/contracts';

const ok = (data: unknown) => ({ success: true, data, error: null });
const textoOuNada = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** Qual marcador cada banco usa para parâmetro. */
function estiloDe(tipo: string): EstiloDeParametro {
  if (tipo === 'postgres') return 'dolar';
  if (tipo === 'sqlserver') return 'arroba';
  return 'interrogacao';
}

export interface DepsDasRotasDeSql {
  readonly gerente: GerenteDeKernels;
  readonly pool: SessionPool;
  readonly tipoDaConexao: (connectionId: string) => string;
  readonly linguagemDe: (v: unknown) => LinguagemDoKernel;
}

export function registrarRotasDeSql(router: Router, { gerente, pool, tipoDaConexao, linguagemDe }: DepsDasRotasDeSql): void {
  /** O "para cada" em andamento de cada notebook: progresso e pedido de parar. */
  const emAndamento = new Map<string, { feitos: number; total: number; parar: boolean }>();

  /** Os valores dos `{{ }}`, de quem mudou cada nome por último. */
  async function lerValores(
    caminho: string, nomes: readonly string[], comoTabela: readonly string[]
  ): Promise<Record<string, unknown>> {
    const valores: Record<string, unknown> = {};
    if (nomes.length === 0) return valores;
    const vivos = gerente.sessoesDe(caminho);
    if (vivos.length === 0) {
      throw new Error(`{{${nomes[0]}}} precisa do kernel rodando: rode antes a célula que cria a variável.`);
    }
    const cascata = gerente.cascata(caminho);
    await cascata.sincronizar(gerente.kernelsDe(caminho));
    for (const nome of nomes) {
      const origem = cascata.origemDe(nome) ?? cascata.ultima;
      const ordem = [...vivos].sort((a, b) => Number(b.familia === origem) - Number(a.familia === origem));
      let achou = false;
      for (const s of ordem) {
        const r = await s.kernel.obter([nome], comoTabela.includes(nome) ? [nome] : []);
        const erro = r.erros[nome];
        if (erro !== undefined) throw new Error(`{{${nome}}} ${erro}.`);
        if (!r.faltando.includes(nome)) {
          valores[nome] = r.valores[nome];
          achou = true;
          break;
        }
      }
      if (!achou) throw new Error(`{{${nome}}}: a variável "${nome}" não existe no kernel. Rode antes a célula que a cria.`);
    }
    return valores;
  }

  /** O resultado vira variável em CADA linguagem do notebook. */
  async function entregar(
    caminho: string, nome: string, colunas: readonly string[], linhas: readonly (readonly CellValue[])[],
    linguagens: readonly LinguagemDoKernel[], raiz: string | null
  ): Promise<{ variavel: unknown; avisos: string[] }> {
    const avisos: string[] = [];
    if (linguagens.length === 0) {
      return { variavel: null, avisos: [`O kernel não está rodando: a variável ${nome} não foi criada.`] };
    }
    const entregues: string[] = [];
    let primeira: { linhas: number; forma: string } | null = null;
    const familias = new Set<string>();
    for (const linguagem of linguagens) {
      const s = gerente.sessao(caminho, linguagem);
      if (s !== undefined && familias.has(s.familia)) continue;
      try {
        const alvo = s ?? (await gerente.garantir({ caminho, linguagem, raiz }));
        familias.add(alvo.familia);
        const d = await alvo.kernel.definir(nome, colunas, linhas);
        primeira ??= d;
        entregues.push(alvo.familia === 'node' ? 'Node' : alvo.familia === 'python' ? 'Python' : 'PHP');
      } catch (e) {
        avisos.push(`${linguagem}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    gerente.cascata(caminho).aoDefinir(nome);
    return { variavel: primeira === null ? null : { nome, ...primeira, linguagens: entregues }, avisos };
  }

  /**
   * Uma instrução SQL: roda SEM TETO e, se pedido, vira variável. Com
   * `paraCada`, roda uma vez por item da lista (spec 114, B).
   */
  router.post('/kernel/sql', wrap(async (req, res) => {
    const caminho = requireString(req.body?.caminho, 'caminho');
    const nome = typeof req.body?.nome === 'string' ? req.body.nome : null;
    if (nome !== null && !nomeValido(nome)) throw new Error(`Nome de variável inválido: ${nome}.`);
    const raiz = textoOuNada(req.body?.raiz) ?? null;
    const linguagens: LinguagemDoKernel[] = Array.isArray(req.body?.linguagens)
      ? (req.body.linguagens as unknown[]).map(linguagemDe)
      : gerente.sessoesDe(caminho).map((x) => x.linguagem);
    const connectionId = requireString(req.body?.connectionId, 'connectionId');
    const texto = requireString(req.body?.statement, 'statement');
    const database = typeof req.body?.database === 'string' ? req.body.database : undefined;
    const dialeto = tipoDaConexao(connectionId);
    const estilo = estiloDe(dialeto);
    // Os nomes que o kernel entrega como REGISTROS: pares (A) e tabelas (D).
    const comoTabela = [...colunasPedidas(texto), ...tabelasPedidas(texto)];
    const paraCada = textoOuNada(req.body?.paraCada) ?? null;
    if (paraCada !== null && !nomeValido(paraCada)) throw new Error(`"Para cada": nome de lista inválido: ${paraCada}.`);

    const session = await pool.acquire(connectionId);
    if (typeof session.execute !== 'function') throw new Error('Esta conexão não executa SQL.');
    const executar = (statement: string, params: readonly unknown[] | undefined) =>
      session.execute!({
        statement,
        params: params as ParametroDeConsulta[] | undefined,
        database,
        semTeto: true,
        // O kernel recebe o valor INTEIRO de cada célula, não a amostra da grade.
        orcamentoDeCelulas: Number.MAX_SAFE_INTEGER,
      });

    if (paraCada !== null) {
      // O `item` é do laço; os outros `{{ }}` vêm do kernel, uma vez só.
      const outros = referenciasDoSql(texto).filter((n) => n !== 'item' && n !== paraCada);
      const valores = await lerValores(caminho, [paraCada, ...outros], [paraCada, ...comoTabela]);
      const itens = valores[paraCada];
      if (!Array.isArray(itens)) throw new Error(`"Para cada ${paraCada}": ${paraCada} não é uma lista.`);
      const estado = { feitos: 0, total: itens.length, parar: false };
      emAndamento.set(caminho, estado);
      let r;
      try {
        r = await rodarParaCada({
          itens, texto, outros: valores, estilo, dialeto,
          executar: (sql, params) => executar(sql, params),
          parar: () => estado.parar,
          aoProgresso: (feitos) => { estado.feitos = feitos; },
        });
      } finally {
        emAndamento.delete(caminho);
      }
      const tabela = r.colunas.length > 0 ? saidaDeTabela(r.colunas, r.linhas) : null;
      const entrega = nome !== null && tabela !== null
        ? await entregar(caminho, nome, r.colunas, r.linhas, linguagens, raiz)
        : { variavel: null, avisos: [] };
      res.json(ok({
        tabela,
        variavel: entrega.variavel,
        aviso: entrega.avisos.length === 0 ? null : entrega.avisos.join(' · '),
        paraCada: {
          total: itens.length, comandos: r.comandos, escritas: r.escritas, linhasAfetadas: r.linhasAfetadas,
          falha: r.falha, parado: r.parado,
        },
      }));
      return;
    }

    // `{{nome}}`: o valor vem do kernel e vai COMO PARÂMETRO, nunca no texto.
    const referencias = referenciasDoSql(texto);
    let statement = texto;
    let params: ParametroDeConsulta[] | undefined;
    if (referencias.length > 0) {
      const valores = await lerValores(caminho, referencias, comoTabela);
      const montado = montarSqlComParametros(texto, valores, estilo, dialeto);
      statement = montado.sql;
      params = montado.params;
    }
    const r = await executar(statement, params);
    if (r.columns.length === 0) {
      res.json(ok({ tabela: null, mensagem: r.message ?? 'Comando executado.', variavel: null }));
      return;
    }
    const colunas = r.columns.map((c) => c.name);
    const entrega = nome !== null
      ? await entregar(caminho, nome, colunas, r.rows, linguagens, raiz)
      : { variavel: null, avisos: [] };
    res.json(ok({
      tabela: saidaDeTabela(colunas, r.rows),
      variavel: entrega.variavel,
      aviso: entrega.avisos.length === 0 ? null : entrega.avisos.join(' · '),
    }));
  }));

  /** O "para cada" em andamento: a tela pergunta enquanto ele roda. */
  router.get('/kernel/sql/progresso', wrap((req, res) => {
    const estado = emAndamento.get(requireString(req.query.caminho, 'caminho'));
    res.json(ok(estado === undefined ? null : { feitos: estado.feitos, total: estado.total }));
  }));

  /** Parar o "para cada": entre um item e outro. */
  router.post('/kernel/sql/parar', wrap((req, res) => {
    const estado = emAndamento.get(requireString(req.body?.caminho, 'caminho'));
    if (estado !== undefined) estado.parar = true;
    res.json(ok(null));
  }));
}
