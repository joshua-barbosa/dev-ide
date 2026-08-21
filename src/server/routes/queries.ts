// Rotas /api/queries.
//
// Só o que a rota de arquivo NÃO faz: listar, criar, renomear, apagar — e
// lembrar contra quem um `.sql` solto roda.
//
// Abrir e salvar continuam em `/api/file`, e é de propósito: assim o arquivo de
// query é um arquivo como qualquer outro no editor, com `Ctrl+S`, com o vigia da
// spec 037 e com a volta depois do F5 da spec 030. Ver o comentário do
// `server/queries.ts` para por que a cerca vive aqui e não lá.
import { Router } from 'express';
import { wrap } from '../http/handlers';
import * as queries from '../queries';
import type { VinculosStore } from '../vinculos';
import type { Vinculo } from '../../shared/sql/vinculo';

function requireString(bruto: unknown, campo: string): string {
  if (typeof bruto !== 'string' || bruto.trim() === '') {
    throw new Error(`Campo obrigatório ausente ou inválido: "${campo}".`);
  }
  return bruto;
}

/** Lê o vínculo de onde ele vier: query string na leitura, corpo na escrita. */
function lerVinculo(fonte: unknown): Vinculo {
  const r = (fonte ?? {}) as Record<string, unknown>;
  return {
    connectionId: requireString(r.connectionId, 'connectionId'),
    database: requireString(r.database, 'database'),
  };
}

export interface DepsDeQueries {
  readonly vinculos: VinculosStore;
  /** Ids das conexões que ainda existem, para limpar lembrança órfã (AC-11). */
  idsDeConexao(): readonly string[];
}

export function createQueriesRouter(deps: DepsDeQueries): Router {
  const router = Router();
  const ok = (data: unknown) => ({ success: true, data, error: null });

  router.get('/', wrap((req, res) => {
    res.json(ok(queries.listar(lerVinculo(req.query))));
  }));

  /** Abrir Query: devolve o caminho, criando o arquivo vazio se não houver. */
  router.post('/open', wrap((req, res) => {
    const vinculo = lerVinculo(req.body);
    const nome = typeof req.body?.nome === 'string' && req.body.nome.trim() !== ''
      ? req.body.nome
      // Sem nome, o arquivo se chama como o database — é o que a ferramenta de
      // referência faz, e o que o usuário anotou.
      : queries.nomePadraoDoDatabase(vinculo.database);
    res.json(ok({ caminho: queries.garantir(vinculo, nome) }));
  }));

  router.post('/', wrap((req, res) => {
    const vinculo = lerVinculo(req.body);
    res.status(201).json(ok({ caminho: queries.criar(vinculo, req.body?.nome) }));
  }));

  router.post('/rename', wrap((req, res) => {
    const vinculo = lerVinculo(req.body);
    const de = requireString(req.body?.de, 'de');
    res.json(ok({ caminho: queries.renomear(vinculo, de, req.body?.para) }));
  }));

  router.delete('/', wrap((req, res) => {
    const vinculo = lerVinculo(req.body);
    res.json(ok({ caminho: queries.apagar(vinculo, req.body?.nome) }));
  }));

  // ---- Vínculo lembrado ----

  /**
   * Os vínculos lembrados, mais a raiz das pastas de query.
   *
   * A raiz vem junto porque a interface precisa dela para DERIVAR o vínculo do
   * caminho, e ela não tem como saber onde fica a raiz de dados. Uma chamada em
   * vez de duas, no arranque.
   */
  router.get('/links', wrap((_req, res) => {
    deps.vinculos.limparConexoesSumidas(deps.idsDeConexao());
    res.json(ok({ raiz: queries.raizDeQueries(), links: deps.vinculos.todos() }));
  }));

  router.post('/links', wrap((req, res) => {
    const caminho = requireString(req.body?.caminho, 'caminho');
    deps.vinculos.lembrar(caminho, lerVinculo(req.body));
    res.json(ok({ caminho }));
  }));

  router.delete('/links', wrap((req, res) => {
    const caminho = requireString(req.body?.caminho, 'caminho');
    deps.vinculos.esquecer(caminho);
    res.json(ok({ caminho }));
  }));

  return router;
}
