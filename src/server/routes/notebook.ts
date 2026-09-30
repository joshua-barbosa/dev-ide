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

const ok = (data: unknown) => ({ success: true, data, error: null });

function estadoDe(s: SessaoDeKernel | undefined): unknown {
  if (s === undefined) return null;
  return {
    linguagem: s.linguagem,
    ocupado: s.kernel.ocupado,
    versao: s.kernel.info.versao,
    executavel: s.kernel.info.executavel,
    pandas: s.kernel.info.pandas,
    interpretador: s.interpretador,
    candidatos: s.candidatos,
  };
}

export function createNotebookRouter(gerente: GerenteDeKernels, pool: SessionPool): Router {
  const router = Router();

  const sessaoOuErro = (caminho: string): SessaoDeKernel => {
    const s = gerente.sessao(caminho);
    if (s === undefined) throw new Error('O kernel deste notebook não está rodando.');
    return s;
  };

  router.get('/kernel', wrap((req, res) => {
    res.json(ok(estadoDe(gerente.sessao(requireString(req.query.caminho, 'caminho')))));
  }));

  router.post('/kernel', wrap(async (req, res) => {
    const linguagem = req.body?.linguagem as LinguagemDoKernel;
    if (!KERNELS.includes(linguagem)) throw new Error(`Kernel desconhecido: ${String(linguagem)}.`);
    const sessao = await gerente.garantir({
      caminho: requireString(req.body?.caminho, 'caminho'),
      linguagem,
      raiz: typeof req.body?.raiz === 'string' && req.body.raiz !== '' ? req.body.raiz : null,
      interpretador:
        typeof req.body?.interpretador === 'string' && req.body.interpretador !== ''
          ? req.body.interpretador
          : undefined,
    });
    res.json(ok(estadoDe(sessao)));
  }));

  router.post('/kernel/executar', wrap((req, res) => {
    const s = sessaoOuErro(requireString(req.body?.caminho, 'caminho'));
    const e = s.kernel.executar(typeof req.body?.codigo === 'string' ? req.body.codigo : '');
    res.json(ok({ exec: e.id }));
  }));

  /** "O que saiu desde a saída N?" — a tela pergunta até `terminou`. */
  router.get('/kernel/execucao', wrap((req, res) => {
    const s = sessaoOuErro(requireString(req.query.caminho, 'caminho'));
    const e = s.kernel.execucao(Number(req.query.exec));
    if (e === undefined) throw new Error('Execução desconhecida.');
    const desde = Math.max(0, Number(req.query.desde) || 0);
    // A última saída de texto pode ter CRESCIDO desde a última pergunta (o
    // kernel emenda o texto); por isso ela volta inteira, e a tela a substitui.
    const inicio = Math.max(0, Math.min(desde, e.saidas.length) - 1);
    res.json(ok({ inicio, saidas: e.saidas.slice(inicio), terminou: e.terminou, ok: e.ok }));
  }));

  router.post('/kernel/interromper', wrap((req, res) => {
    sessaoOuErro(requireString(req.body?.caminho, 'caminho')).kernel.interromper();
    res.json(ok(null));
  }));

  router.post('/kernel/reiniciar', wrap(async (req, res) => {
    res.json(ok(estadoDe(await gerente.reiniciar(requireString(req.body?.caminho, 'caminho')))));
  }));

  router.post('/kernel/encerrar', wrap((req, res) => {
    gerente.encerrar(requireString(req.body?.caminho, 'caminho'));
    res.json(ok(null));
  }));

  /**
   * Uma instrução SQL: roda SEM TETO e, se pedido, vira variável no kernel.
   *
   * A tela recebe a VISTA (as primeiras linhas e o total); o kernel recebe
   * tudo. Sem kernel rodando, a instrução roda do mesmo jeito e a resposta diz
   * que a variável não foi criada — o SQL não depende do Python existir.
   */
  router.post('/kernel/sql', wrap(async (req, res) => {
    const caminho = requireString(req.body?.caminho, 'caminho');
    const nome = typeof req.body?.nome === 'string' ? req.body.nome : null;
    if (nome !== null && !nomeValido(nome)) throw new Error(`Nome de variável inválido: ${nome}.`);

    const session = await pool.acquire(requireString(req.body?.connectionId, 'connectionId'));
    if (typeof session.execute !== 'function') throw new Error('Esta conexão não executa SQL.');
    const r = await session.execute({
      statement: requireString(req.body?.statement, 'statement'),
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
    let aviso: string | null = null;
    const s = gerente.sessao(caminho);
    if (nome !== null && s !== undefined) {
      variavel = { nome, ...(await s.kernel.definir(nome, colunas, r.rows)) };
    } else if (nome !== null) {
      aviso = `O kernel não está rodando: a variável ${nome} não foi criada.`;
    }
    res.json(ok({ tabela: saidaDeTabela(colunas, r.rows), variavel, aviso }));
  }));

  return router;
}
