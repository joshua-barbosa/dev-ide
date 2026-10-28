// As rotas da célula HTTP do notebook (spec 120, etapa 1).
//
// A requisição sai do motor; os `{{ }}` vêm do kernel, pela cascata, como na
// célula SQL; a resposta INTEIRA vira variável em cada linguagem do notebook,
// e a tela recebe a saída com o corpo até o teto do arquivo.
import type { Router } from 'express';
import { requireString, wrap } from '../http/handlers';
import type { GerenteDeKernels } from '../notebook/gerente';
import { comoSaida, enviarRequisicao, type RespostaCompleta } from '../notebook/requisicao-http';
import { PoteDeCookies } from '../notebook/cookies-http';
import { rodarParaCadaHttp } from '../notebook/para-cada-http';
import { OAuthDoNotebook } from '../notebook/oauth-http';
import { paraCurl } from '../../shared/notebook/curl';
import { entregarAosKernels, lerValoresDoKernel } from '../notebook/valores-do-kernel';
import { nomeValido, saidaDeTabela, type Kernel as LinguagemDoKernel } from '../../shared/notebook/modelo';
import {
  aplicarAutorizacao, lerRequisicao, REFERENCIA_DO_COFRE, referenciasDaRequisicao, referenciasDoCofre,
  ocultarSegredos, requisicaoVazia, resolverRequisicao, segredosDaAutorizacao, semCofre, valorDaVariavel,
  type RequisicaoHttp,
} from '../../shared/notebook/http';

const ok = (data: unknown) => ({ success: true, data, error: null });
const textoOuNada = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** Quantas respostas inteiras ficam guardadas para o "Salvar" — as mais novas… */
const RESPOSTAS_GUARDADAS = 20;
/** …e quantos bytes, somadas: 20 respostas de 200 MB não podem ficar presas no motor. */
const BYTES_GUARDADOS = 256 * 1024 * 1024;

/** O cofre, visto pela célula HTTP: só segredos soltos, por referência (etapa 2). */
export interface CofreDeSegredos {
  guardar(referencia: string, valor: string): void;
  /** `null`: o segredo não está neste cofre. */
  ler(referencia: string): string | null;
  /** "Limpar token" do OAuth 2.0 (etapa 5). */
  apagar?(referencia: string): void;
}

export interface DepsDasRotasDeHttp {
  readonly gerente: GerenteDeKernels;
  readonly linguagemDe: (v: unknown) => LinguagemDoKernel;
  readonly segredos: CofreDeSegredos | null;
}

const semCofreAqui = (): never => {
  throw new Error('O cofre não está disponível neste motor.');
};

export function registrarRotasDeHttp(router: Router, { gerente, linguagemDe, segredos }: DepsDasRotasDeHttp): void {
  /**
   * A requisição em andamento de cada CÉLULA. Rodar a mesma célula de novo
   * cancela a anterior; outra célula do notebook não. O Parar cancela todas
   * as do notebook.
   */
  const emAndamento = new Map<string, AbortController>();
  /** A última resposta INTEIRA de cada célula: o arquivo guarda só até o teto. */
  const respostas = new Map<string, RespostaCompleta>();
  const chave = (caminho: string, celula: string) => `${caminho}\u0000${celula}`;
  /** OAuth 2.0 (etapa 5): os tokens no cofre, o login no navegador. */
  const cofreOuErro = segredos ?? { guardar: semCofreAqui, ler: semCofreAqui };
  const oauth = new OAuthDoNotebook({
    enviar: (requisicao, sinal) => enviarRequisicao(requisicao, { sinal }),
    guardar: (ref, valor) => cofreOuErro.guardar(ref, valor),
    ler: (ref) => cofreOuErro.ler(ref),
    apagar: (ref) => (segredos?.apagar ?? semCofreAqui)(ref),
  });
  /** O progresso de cada "para cada" em andamento (etapa 4). */
  const progressos = new Map<string, { feitos: number; total: number }>();
  /** Um pote de cookies por notebook (etapa 3): o login de uma célula vale nas seguintes. */
  const potes = new Map<string, PoteDeCookies>();
  const poteDe = (caminho: string): PoteDeCookies => {
    const existente = potes.get(caminho);
    if (existente !== undefined) return existente;
    const novo = new PoteDeCookies();
    potes.set(caminho, novo);
    return novo;
  };

  const guardar = (k: string, r: RespostaCompleta): void => {
    respostas.delete(k);
    respostas.set(k, r);
    const bytes = () => [...respostas.values()].reduce((t, x) => t + x.corpo.length, 0);
    while (respostas.size > RESPOSTAS_GUARDADAS || (respostas.size > 1 && bytes() > BYTES_GUARDADOS)) {
      respostas.delete(respostas.keys().next().value as string);
    }
  };

  /** As referências do cofre trocadas pelos valores; o que falta vira recado. */
  const comOsSegredos = (requisicao: RequisicaoHttp): RequisicaoHttp => semCofre(requisicao, Object.fromEntries(
    referenciasDoCofre(requisicao).map((ref) => [ref, (segredos ?? { ler: semCofreAqui }).ler(ref)])
  ));

  /**
   * UMA requisição já resolvida sai: autorização aplicada, cookies do pote,
   * e a API Key da query MASCARADA na URL final e nos recados de erro (ela
   * iria para a saída, que vai para o `.brnb`, e para a variável).
   */
  async function enviarUma(caminho: string, resolvida: RequisicaoHttp, sinal: AbortSignal): Promise<RespostaCompleta> {
    const a = resolvida.autorizacao;
    if (a.tipo !== 'oauth2') return enviarComAutorizacao(caminho, resolvida, sinal);
    // OAuth 2.0: o token (do cofre, renovado, ou pedido agora) vira um Bearer.
    const comBearer = (acesso: string): RequisicaoHttp =>
      ({ ...resolvida, autorizacao: { tipo: 'bearer', token: { texto: acesso } } });
    const t = await oauth.token(a, resolvida.opcoes, sinal);
    const resposta = await enviarComAutorizacao(caminho, comBearer(t.acesso), sinal);
    // O guardado foi recusado (revogado, servidor reiniciou): pega outro e tenta UMA vez.
    if (resposta.status !== 401 || !t.doCofre) return resposta;
    const novo = await oauth.renovar(a, resolvida.opcoes, sinal);
    return enviarComAutorizacao(caminho, comBearer(novo.acesso), sinal);
  }

  async function enviarComAutorizacao(caminho: string, resolvida: RequisicaoHttp, sinal: AbortSignal): Promise<RespostaCompleta> {
    const segredosVistos = segredosDaAutorizacao(resolvida.autorizacao);
    const a = resolvida.autorizacao;
    const headersSensiveis = a.tipo === 'apikey' && a.onde === 'header' ? [a.chave.trim().toLowerCase()] : [];
    try {
      const enviada = await enviarRequisicao(aplicarAutorizacao(resolvida), {
        sinal, headersSensiveis, cookies: poteDe(caminho),
      });
      return { ...enviada, url: ocultarSegredos(enviada.url, segredosVistos) };
    } catch (e) {
      throw new Error(ocultarSegredos(e instanceof Error ? e.message : String(e), segredosVistos));
    }
  }

  /** O valor vira variável em cada linguagem do notebook. */
  const entregarValor = (
    p: { readonly caminho: string; readonly nome: string | null; readonly raiz: string | null; readonly linguagens: readonly LinguagemDoKernel[] },
    valor: unknown, resumo: Record<string, unknown>
  ) => {
    const nome = p.nome;
    if (nome === null) return Promise.resolve({ variavel: null, avisos: [] as string[] });
    return entregarAosKernels(gerente, {
      caminho: p.caminho, nome, linguagens: p.linguagens, raiz: p.raiz,
      entregar: async (kernel) => {
        await kernel.importar({ [nome]: valor });
        return resumo;
      },
    });
  };

  interface Atendimento {
    readonly caminho: string; readonly k: string; readonly nome: string | null; readonly raiz: string | null;
    readonly linguagens: readonly LinguagemDoKernel[]; readonly requisicao: RequisicaoHttp; readonly sinal: AbortSignal;
    /** Etapa 4: o nome de uma lista do kernel — uma requisição por item. */
    readonly paraCada: string | null;
  }

  async function atender(p: Atendimento) {
    // O cofre ANTES dos `{{ }}`: um segredo que falta para tudo sem incomodar o kernel.
    const comSegredos = comOsSegredos(p.requisicao);
    if (p.paraCada !== null) return atenderParaCada(p, comSegredos, p.paraCada);
    // Pedidos "como registros": o Python entregaria um dict como TEXTO JSON (o
    // jeito do parâmetro de SQL), e `{{login.body.token}}` precisa da estrutura.
    const referencias = referenciasDaRequisicao(comSegredos);
    const valores = await lerValoresDoKernel(gerente, p.caminho, referencias, referencias);
    if (p.sinal.aborted) throw new Error('Requisição cancelada.');
    const resposta = await enviarUma(p.caminho, resolverRequisicao(comSegredos, valores), p.sinal);
    guardar(p.k, resposta);
    const valor = valorDaVariavel(comoSaida(resposta, Infinity));
    const entrega = await entregarValor(p, valor, { status: valor.status });
    return {
      saida: comoSaida(resposta),
      variavel: entrega.variavel,
      aviso: entrega.avisos.length === 0 ? null : entrega.avisos.join(' · '),
    };
  }

  /** Etapa 4: uma requisição por item; a tela pergunta o progresso enquanto isso. */
  async function atenderParaCada(p: Atendimento, comSegredos: RequisicaoHttp, lista: string) {
    // O `item` é do laço; os outros `{{ }}` vêm do kernel, uma vez só.
    const outras = referenciasDaRequisicao(comSegredos).filter((n) => n !== 'item' && n !== lista);
    const valores = await lerValoresDoKernel(gerente, p.caminho, [lista, ...outras], [lista, ...outras]);
    const itens = valores[lista];
    if (!Array.isArray(itens)) throw new Error(`"Para cada ${lista}": ${lista} não é uma lista.`);
    const estado = { feitos: 0, total: itens.length };
    progressos.set(p.k, estado);
    try {
      const r = await rodarParaCadaHttp({
        itens, requisicao: comSegredos, outros: valores,
        enviar: (resolvida) => enviarUma(p.caminho, resolvida, p.sinal),
        parar: () => p.sinal.aborted,
        aoProgresso: (feitos) => { estado.feitos = feitos; },
      });
      const entrega = r.respostas.length === 0
        ? { variavel: null, avisos: [] as string[] }
        : await entregarValor(p, r.respostas, { linhas: r.respostas.length, forma: 'lista' });
      return {
        tabela: r.linhas.length === 0 ? null : saidaDeTabela(r.colunas, r.linhas),
        variavel: entrega.variavel,
        aviso: entrega.avisos.length === 0 ? null : entrega.avisos.join(' · '),
        paraCada: {
          total: itens.length, feitos: r.respostas.length, comErroDeStatus: r.comErroDeStatus, falha: r.falha, parado: r.parado,
        },
      };
    } finally {
      progressos.delete(p.k);
    }
  }

  router.post('/kernel/http', wrap(async (req, res) => {
    const caminho = requireString(req.body?.caminho, 'caminho');
    const celula = requireString(req.body?.celula, 'celula');
    const nome = typeof req.body?.nome === 'string' ? req.body.nome : null;
    if (nome !== null && !nomeValido(nome)) throw new Error(`Nome de variável inválido: ${nome}.`);
    const raiz = textoOuNada(req.body?.raiz) ?? null;
    const linguagens: LinguagemDoKernel[] = Array.isArray(req.body?.linguagens)
      ? (req.body.linguagens as unknown[]).map(linguagemDe)
      : gerente.sessoesDe(caminho).map((x) => x.linguagem);
    const requisicao = lerRequisicao(req.body?.http);
    const paraCada = textoOuNada(req.body?.paraCada) ?? null;
    if (paraCada !== null && !nomeValido(paraCada)) throw new Error(`"Para cada": nome de lista inválido: ${paraCada}.`);
    // Registrada ANTES de ler os `{{ }}`: um Parar enquanto o kernel responde também vale.
    const k = chave(caminho, celula);
    const controle = new AbortController();
    emAndamento.get(k)?.abort();
    emAndamento.set(k, controle);
    try {
      res.json(ok(await atender({ caminho, k, nome, raiz, linguagens, requisicao, sinal: controle.signal, paraCada })));
    } finally {
      if (emAndamento.get(k) === controle) emAndamento.delete(k);
    }
  }));

  const referenciaDe = (v: unknown): string => {
    const ref = requireString(v, 'ref');
    if (!REFERENCIA_DO_COFRE.test(ref)) throw new Error(`Referência de segredo inválida: ${ref}`);
    return ref;
  };

  /**
   * Guarda um segredo da aba Authorization no cofre. A TELA escolhe a
   * referência (aleatória) na primeira tecla: o `.brnb` muda na hora, sem
   * esperar esta volta — e um ▷ logo depois não pega a célula sem ela.
   */
  router.post('/segredo', wrap((req, res) => {
    const valor = typeof req.body?.valor === 'string' ? req.body.valor : '';
    (segredos ?? { guardar: semCofreAqui }).guardar(referenciaDe(req.body?.ref), valor);
    res.json(ok(null));
  }));

  /** Existe neste cofre? O valor só com `revelar=1` (o olho do campo). */
  router.get('/segredo', wrap((req, res) => {
    const valor = (segredos ?? { ler: semCofreAqui }).ler(referenciaDe(req.query.ref));
    if (valor === null) res.json(ok({ existe: false }));
    else res.json(ok(req.query.revelar === '1' ? { existe: true, valor } : { existe: true }));
  }));

  /** O corpo INTEIRO da última resposta da célula, para salvar em disco. */
  router.get('/kernel/http/corpo', wrap((req, res) => {
    const r = respostas.get(chave(requireString(req.query.caminho, 'caminho'), requireString(req.query.celula, 'celula')));
    if (r === undefined) throw new Error('A resposta inteira não está mais no motor: rode a célula de novo.');
    res.json(ok({ base64: r.corpo.toString('base64'), mime: r.tipoDeConteudo.split(';')[0].trim() || 'application/octet-stream' }));
  }));

  /**
   * "Pegar token novo" (OAuth 2.0): Client Credentials e Password pedem na
   * hora; Authorization Code começa o login e devolve a página a abrir.
   */
  router.post('/oauth/token', wrap(async (req, res) => {
    const caminho = textoOuNada(req.body?.caminho) ?? null;
    const comSegredos = comOsSegredos(lerRequisicao(req.body?.http));
    const referencias = referenciasDaRequisicao({ ...requisicaoVazia(), autorizacao: comSegredos.autorizacao });
    const valores = caminho === null || referencias.length === 0
      ? {}
      : await lerValoresDoKernel(gerente, caminho, referencias, referencias);
    const resolvida = resolverRequisicao({ ...comSegredos, url: '', headers: [], params: [], corpo: { tipo: 'nenhum' } }, valores);
    const a = resolvida.autorizacao;
    if (a.tipo !== 'oauth2') throw new Error('Esta célula não usa OAuth 2.0.');
    if (a.fluxo === 'authorization_code') {
      res.json(ok({ login: await oauth.iniciarLogin(a, resolvida.opcoes) }));
      return;
    }
    if (a.tokens !== '') oauth.limpar(a.tokens);
    await oauth.renovar(a, resolvida.opcoes);
    res.json(ok({ estado: oauth.estado(a.tokens) }));
  }));

  router.get('/oauth/login', wrap((req, res) => {
    res.json(ok(oauth.estadoDoLogin(requireString(req.query.id, 'id'))));
  }));

  /** Tem token? Até quando? Renova sozinho? — nunca o token. */
  router.get('/oauth/estado', wrap((req, res) => {
    res.json(ok(oauth.estado(referenciaDe(req.query.ref))));
  }));

  router.post('/oauth/limpar', wrap((req, res) => {
    oauth.limpar(referenciaDe(req.body?.ref));
    res.json(ok(null));
  }));

  /** O "para cada" em andamento de uma célula: a tela pergunta enquanto ele roda. */
  router.get('/kernel/http/progresso', wrap((req, res) => {
    const estado = progressos.get(chave(requireString(req.query.caminho, 'caminho'), requireString(req.query.celula, 'celula')));
    res.json(ok(estado === undefined ? null : { feitos: estado.feitos, total: estado.total }));
  }));

  /** Os cookies que o notebook guardou (o botão "Cookies" da barra). */
  router.get('/kernel/http/cookies', wrap((req, res) => {
    const pote = potes.get(requireString(req.query.caminho, 'caminho'));
    res.json(ok((pote?.lista() ?? []).map((c) => ({
      nome: c.nome, valor: c.valor, dominio: c.dominio, caminho: c.caminho, expira: c.expira,
    }))));
  }));

  router.post('/kernel/http/cookies/limpar', wrap((req, res) => {
    potes.get(requireString(req.body?.caminho, 'caminho'))?.limpar();
    res.json(ok(null));
  }));

  /**
   * "Copiar como cURL": com o segredo do cofre DENTRO — é o que a pessoa
   * pediu ao copiar, e vai para a área de transferência dela, não para um
   * arquivo. Os `{{ }}` ficam como estão: o kernel pode nem estar de pé.
   */
  router.post('/kernel/http/curl', wrap((req, res) => {
    const estilo = req.body?.estilo === 'cmd' ? 'cmd' : 'bash';
    const comSegredos = comOsSegredos(lerRequisicao(req.body?.http));
    // OAuth 2.0: o token que já está no cofre vira Bearer; sem ele, o comando sai sem autorização.
    const a = comSegredos.autorizacao;
    const guardado = a.tipo === 'oauth2' ? oauth.tokenGuardado(a) : null;
    const pronta: RequisicaoHttp = guardado === null ? comSegredos
      : { ...comSegredos, autorizacao: { tipo: 'bearer', token: { texto: guardado } } };
    res.json(ok(paraCurl(aplicarAutorizacao(pronta), estilo)));
  }));

  /** Parar: cancela as requisições em andamento do notebook. */
  router.post('/kernel/http/parar', wrap((req, res) => {
    const prefixo = chave(requireString(req.body?.caminho, 'caminho'), '');
    for (const [k, controle] of emAndamento) if (k.startsWith(prefixo)) controle.abort();
    res.json(ok(null));
  }));
}
