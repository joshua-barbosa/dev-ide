// As rotas do kernel do notebook (spec 112, etapa 2).
//
// Execução por CONSULTA, e não por fluxo contínuo: a célula é posta na fila e a
// tela pergunta "o que saiu desde a saída N?" até terminar. Um fluxo (SSE)
// seria mais bonito, mas na extensão a API passa pela ponte do editor, que só
// sabe pergunta e resposta — e o notebook tem de funcionar igual nos dois.
//
// O resultado de uma célula SQL vai DIRETO do banco ao kernel, aqui no motor:
// sem teto (decisão dele), ele pode ter milhões de linhas, e não tem por que
// atravessar a tela para chegar ao Python. A tela recebe só a vista.
import { Router } from 'express';
import { requireString, wrap } from '../http/handlers';
import type { SessionPool } from '../connections/pool';
import type { GerenteDeKernels, SessaoDeKernel } from '../notebook/gerente';
import {
  KERNELS, nomeValido, saidaDeTabela, type Kernel as LinguagemDoKernel,
} from '../../shared/notebook/modelo';
import {
  colunasPedidas, montarSqlComParametros, referenciasDoSql, type EstiloDeParametro,
} from '../../shared/notebook/parametros';
import type { ParametroDeConsulta } from '../../shared/contracts';
import type { Session } from '../connections/types';
import type { Vinculo } from '../../shared/sql/vinculo';
import { SqlDoKernel } from '../notebook/sql-do-kernel';

const ok = (data: unknown) => ({ success: true, data, error: null });

function estadoDe(s: SessaoDeKernel | undefined): unknown {
  if (s === undefined) return null;
  return {
    linguagem: s.linguagem,
    familia: s.familia,
    ocupado: s.kernel.ocupado,
    versao: s.kernel.info.versao,
    executavel: s.kernel.info.executavel,
    pandas: s.kernel.info.pandas,
    interpretador: s.interpretador,
    candidatos: s.candidatos,
    laravelDisponivel: s.laravelDisponivel,
    laravel: s.laravel,
    pacotes: s.pacotes,
    candidatosDePacotes: s.candidatosDePacotes,
  };
}

const textoOuNada = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** A linguagem de um pedido — cada notebook tem um kernel por família (spec 113). */
function linguagemDe(v: unknown): LinguagemDoKernel {
  if (!KERNELS.includes(v as LinguagemDoKernel)) throw new Error(`Kernel desconhecido: ${String(v)}.`);
  return v as LinguagemDoKernel;
}

/** Qual marcador cada banco usa para parâmetro (`{{nome}}`, etapa 4). */
function estiloDe(tipo: string): EstiloDeParametro {
  if (tipo === 'postgres') return 'dolar';
  if (tipo === 'sqlserver') return 'arroba';
  return 'interrogacao';
}

export function createNotebookRouter(
  gerente: GerenteDeKernels,
  pool: SessionPool,
  /** O tipo do banco da conexão — decide o marcador de parâmetro. */
  tipoDaConexao: (connectionId: string) => string,
  /** Uma sessão NOVA, só de uma transação do sql() do kernel (spec 114, C). */
  abrirSessao: (connectionId: string) => Promise<Session> = () =>
    Promise.reject(new Error('Transação indisponível aqui.'))
): Router {
  const router = Router();
  /** A conexão do notebook, como a tela mandou na última célula. */
  const conexaoDoNotebook = new Map<string, Vinculo | null>();

  /** O sql() que as células chamam, atendido pela conexão do notebook. */
  const ligarSql = (s: SessaoDeKernel, caminho: string): void => {
    if (s.kernel.aoPedirSql !== null) return;
    const sql = new SqlDoKernel({
      vinculo: () => conexaoDoNotebook.get(caminho) ?? null,
      sessao: (id) => pool.acquire(id),
      abrirDedicada: abrirSessao,
      tipo: tipoDaConexao,
    });
    s.kernel.aoPedirSql = (pedido) => sql.atender(pedido);
    // Transação que a célula deixou aberta (parada no meio, bloco sem await):
    // desfeita, e a conexão dela fechada.
    s.kernel.aoTerminarCelula = () => void sql.desfazerAbertas();
  };

  const sessaoOuErro = (caminho: string, linguagem: LinguagemDoKernel): SessaoDeKernel => {
    const s = gerente.sessao(caminho, linguagem);
    if (s === undefined) throw new Error(`O kernel ${linguagem} deste notebook não está rodando.`);
    return s;
  };
  const doPedido = (fonte: Record<string, unknown> | undefined): { caminho: string; linguagem: LinguagemDoKernel } => ({
    caminho: requireString(fonte?.caminho, 'caminho'),
    linguagem: linguagemDe(fonte?.linguagem),
  });

  router.get('/kernel', wrap((req, res) => {
    const { caminho, linguagem } = doPedido(req.query as Record<string, unknown>);
    res.json(ok(estadoDe(gerente.sessao(caminho, linguagem))));
  }));

  /** Todos os kernels vivos do notebook: a tela os reencontra depois de um F5. */
  router.get('/kernels', wrap((req, res) => {
    res.json(ok(gerente.sessoesDe(requireString(req.query.caminho, 'caminho')).map(estadoDe)));
  }));

  /** O que dá para escolher, SEM subir o kernel — a barra pergunta antes. */
  router.get('/ambiente', wrap((req, res) => {
    const linguagem = req.query.linguagem as LinguagemDoKernel;
    if (!KERNELS.includes(linguagem)) throw new Error(`Kernel desconhecido: ${String(linguagem)}.`);
    res.json(ok(gerente.ambiente({
      caminho: requireString(req.query.caminho, 'caminho'),
      linguagem,
      raiz: textoOuNada(req.query.raiz) ?? null,
    })));
  }));

  router.post('/kernel', wrap(async (req, res) => {
    const linguagem = linguagemDe(req.body?.linguagem);
    const sessao = await gerente.garantir({
      caminho: requireString(req.body?.caminho, 'caminho'),
      linguagem,
      raiz: typeof req.body?.raiz === 'string' && req.body.raiz !== '' ? req.body.raiz : null,
      interpretador:
        typeof req.body?.interpretador === 'string' && req.body.interpretador !== ''
          ? req.body.interpretador
          : undefined,
      laravel: typeof req.body?.laravel === 'boolean' ? req.body.laravel : undefined,
      pacotes: textoOuNada(req.body?.pacotes),
    });
    res.json(ok(estadoDe(sessao)));
  }));

  /**
   * Uma célula: antes, a CASCATA (spec 113) — o que as outras linguagens
   * mudaram chega a este kernel. Depois, a célula entra na fila dele.
   */
  router.post('/kernel/executar', wrap(async (req, res) => {
    const { caminho, linguagem } = doPedido(req.body);
    const s = sessaoOuErro(caminho, linguagem);
    const c = req.body?.conexao;
    conexaoDoNotebook.set(caminho, c !== null && typeof c === 'object' && typeof c.connectionId === 'string'
      ? { connectionId: c.connectionId, database: typeof c.database === 'string' ? c.database : '' }
      : null);
    ligarSql(s, caminho);
    await gerente.cascata(caminho).antesDeRodar(s.familia, gerente.kernelsDe(caminho));
    // JS/TS chega transformado (tipos fora, import → require, célula reexecutável).
    const e = s.kernel.executar(s.preparar(typeof req.body?.codigo === 'string' ? req.body.codigo : '', linguagem));
    res.json(ok({ exec: e.id }));
  }));

  /** "O que saiu desde a saída N?" — a tela pergunta até `terminou`. */
  router.get('/kernel/execucao', wrap((req, res) => {
    const { caminho, linguagem } = doPedido(req.query as Record<string, unknown>);
    const s = sessaoOuErro(caminho, linguagem);
    const e = s.kernel.execucao(Number(req.query.exec));
    if (e === undefined) throw new Error('Execução desconhecida.');
    const desde = Math.max(0, Number(req.query.desde) || 0);
    // A última saída de texto pode ter CRESCIDO desde a última pergunta (o
    // kernel emenda o texto); por isso ela volta inteira, e a tela a substitui.
    const inicio = Math.max(0, Math.min(desde, e.saidas.length) - 1);
    res.json(ok({ inicio, saidas: e.saidas.slice(inicio), terminou: e.terminou, ok: e.ok }));
  }));

  router.post('/kernel/interromper', wrap((req, res) => {
    const { caminho, linguagem } = doPedido(req.body);
    sessaoOuErro(caminho, linguagem).kernel.interromper();
    res.json(ok(null));
  }));

  /** Com `linguagem`, reinicia UM kernel; sem, todos os do notebook (e a cascata). */
  router.post('/kernel/reiniciar', wrap(async (req, res) => {
    const caminho = requireString(req.body?.caminho, 'caminho');
    if (req.body?.linguagem === undefined) {
      res.json(ok((await gerente.reiniciarTodos(caminho)).map(estadoDe)));
      return;
    }
    res.json(ok(estadoDe(await gerente.reiniciar(caminho, linguagemDe(req.body.linguagem)))));
  }));

  router.post('/kernel/encerrar', wrap((req, res) => {
    const caminho = requireString(req.body?.caminho, 'caminho');
    gerente.encerrar(caminho, req.body?.linguagem === undefined ? undefined : linguagemDe(req.body.linguagem));
    res.json(ok(null));
  }));

  /**
   * Uma instrução SQL: roda SEM TETO e, se pedido, vira variável.
   *
   * A tela recebe a VISTA (as primeiras linhas e o total); os kernels recebem
   * tudo. O resultado vai para CADA linguagem do notebook (`linguagens`),
   * subindo o kernel que faltar — decisão do usuário na spec 113. Sem
   * nenhuma, a instrução roda do mesmo jeito e a resposta avisa.
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

    // `{{nome}}`: o valor vem do kernel e vai COMO PARÂMETRO, nunca no texto.
    // De qual kernel: de quem mudou o nome por último, pela cascata.
    const referencias = referenciasDoSql(texto);
    // {{nome(col, col)}}: o kernel entrega como lista de objetos (spec 114, A).
    const comoTabela = colunasPedidas(texto);
    let statement = texto;
    let params: ParametroDeConsulta[] | undefined;
    if (referencias.length > 0) {
      const vivos = gerente.sessoesDe(caminho);
      if (vivos.length === 0) {
        throw new Error(`{{${referencias[0]}}} precisa do kernel rodando: rode antes a célula que cria a variável.`);
      }
      const cascata = gerente.cascata(caminho);
      await cascata.sincronizar(gerente.kernelsDe(caminho));
      const valores: Record<string, unknown> = {};
      for (const ref of referencias) {
        const origem = cascata.origemDe(ref) ?? cascata.ultima;
        const ordem = [...vivos].sort((a, b) => Number(b.familia === origem) - Number(a.familia === origem));
        let achou = false;
        for (const s of ordem) {
          const r = await s.kernel.obter([ref], comoTabela.includes(ref) ? [ref] : []);
          const erro = r.erros[ref];
          if (erro !== undefined) throw new Error(`{{${ref}}} ${erro}.`);
          if (!r.faltando.includes(ref)) {
            valores[ref] = r.valores[ref];
            achou = true;
            break;
          }
        }
        if (!achou) {
          throw new Error(`{{${ref}}}: a variável "${ref}" não existe no kernel. Rode antes a célula que a cria.`);
        }
      }
      const montado = montarSqlComParametros(texto, valores, estiloDe(tipoDaConexao(connectionId)));
      statement = montado.sql;
      params = montado.params;
    }

    const session = await pool.acquire(connectionId);
    if (typeof session.execute !== 'function') throw new Error('Esta conexão não executa SQL.');
    const r = await session.execute({
      statement,
      params,
      database: typeof req.body?.database === 'string' ? req.body.database : undefined,
      semTeto: true,
      // O kernel recebe o valor INTEIRO de cada célula, não a amostra da grade.
      orcamentoDeCelulas: Number.MAX_SAFE_INTEGER,
    });
    if (r.columns.length === 0) {
      res.json(ok({ tabela: null, mensagem: r.message ?? 'Comando executado.', variavel: null }));
      return;
    }

    const colunas = r.columns.map((c) => c.name);
    let variavel: unknown = null;
    const avisos: string[] = [];
    if (nome !== null && linguagens.length === 0) {
      avisos.push(`O kernel não está rodando: a variável ${nome} não foi criada.`);
    } else if (nome !== null) {
      const entregues: string[] = [];
      let primeira: { linhas: number; forma: string } | null = null;
      const familias = new Set<string>();
      for (const linguagem of linguagens) {
        const s = gerente.sessao(caminho, linguagem);
        if (s !== undefined && familias.has(s.familia)) continue;
        try {
          const alvo = s ?? (await gerente.garantir({ caminho, linguagem, raiz }));
          familias.add(alvo.familia);
          const d = await alvo.kernel.definir(nome, colunas, r.rows);
          primeira ??= d;
          entregues.push(alvo.familia === 'node' ? 'Node' : alvo.familia === 'python' ? 'Python' : 'PHP');
        } catch (e) {
          avisos.push(`${linguagem}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      gerente.cascata(caminho).aoDefinir(nome);
      if (primeira !== null) variavel = { nome, ...primeira, linguagens: entregues };
    }
    res.json(ok({ tabela: saidaDeTabela(colunas, r.rows), variavel, aviso: avisos.length === 0 ? null : avisos.join(' · ') }));
  }));

  return router;
}
