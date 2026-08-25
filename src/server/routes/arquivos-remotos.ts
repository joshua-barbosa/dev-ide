// Rotas /api/connections/:id/files (spec 053).
//
// Separado de `connections.ts` porque é outro assunto — lá é cofre, registro e
// pool; aqui é o sistema de arquivos do outro lado. E porque `connections.ts`
// já estava em 332 linhas, que é onde o Artigo IV manda cortar antes de doer.
//
// **A trava de somente-leitura NÃO está aqui.** Ela está no `RemoteFiles` do
// driver (`ssh-arquivos.ts`), que é por onde toda escrita passa — inclusive uma
// que venha de outra rota, de outro driver, ou de código que ainda não existe.
// Repeti-la aqui daria duas chances de divergirem.
import { Router } from 'express';
import { alternarFavorito, lerFavoritos } from '../favoritos';
import { aspasDeShell } from '../../shared/remoto/shell';
import { requireString, wrap } from '../http/handlers';
import type { SessionPool } from '../connections/pool';
import type { RemoteFiles, Session } from '../connections/types';

/** Teto do que se manda executar. Script maior que isto ninguém lê antes. */
export const MAX_BYTES_DE_SCRIPT = 256 * 1024;

function ok<T>(data: T): { success: true; data: T; error: null } {
  return { success: true, data, error: null };
}

/** O `RemoteFiles` da sessão, ou um erro que diz por que não há. */
function arquivosDe(session: Session, id: string): RemoteFiles {
  if (session.files === undefined) {
    throw new Error(`A conexão "${id}" não navega arquivos.`);
  }
  return session.files;
}

export function createRemoteFilesRouter(pool: SessionPool): Router {
  const router = Router({ mergeParams: true });

  const arquivos = async (id: string): Promise<RemoteFiles> =>
    arquivosDe(await pool.acquire(id), id);

  router.get('/', wrap(async (req, res) => {
    const files = await arquivos(req.params.id);
    res.json(ok(await files.read(requireString(req.query.path, 'path'))));
  }));

  router.get('/list', wrap(async (req, res) => {
    const files = await arquivos(req.params.id);
    res.json(ok(await files.list(requireString(req.query.path, 'path'))));
  }));

  router.post('/', wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const conteudo = body.content;
    if (typeof conteudo !== 'string') {
      throw new Error('Campo obrigatório ausente ou inválido: "content".');
    }
    const files = await arquivos(req.params.id);
    const caminho = requireString(body.path, 'path');
    await files.write(caminho, conteudo);
    res.json(ok({ path: caminho, bytes: Buffer.byteLength(conteudo, 'utf8') }));
  }));

  router.post('/mkdir', wrap(async (req, res) => {
    const files = await arquivos(req.params.id);
    const caminho = requireString((req.body ?? {}).path, 'path');
    await files.mkdir(caminho);
    res.json(ok({ path: caminho }));
  }));

  router.post('/rename', wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const files = await arquivos(req.params.id);
    const de = requireString(body.from, 'from');
    const para = requireString(body.to, 'to');
    await files.rename(de, para);
    res.json(ok({ from: de, to: para }));
  }));

  router.delete('/', wrap(async (req, res) => {
    const files = await arquivos(req.params.id);
    const caminho = requireString(req.query.path, 'path');
    await files.remove(caminho);
    res.json(ok({ path: caminho }));
  }));

  // ------------------------------------------------------------------ favoritos
  router.get('/favorites', wrap(async (req, res) => {
    res.json(ok(lerFavoritos(req.params.id)));
  }));

  router.post('/favorites', wrap(async (req, res) => {
    const caminho = requireString((req.body ?? {}).path, 'path');
    // Alternar, e não "adicionar": a estrela da tela é um botão só, e dois
    // caminhos para o mesmo gesto dariam duas chances de divergirem.
    res.json(ok(alternarFavorito(req.params.id, caminho)));
  }));

  /**
   * Roda um script do servidor (spec 053, D28 e D30).
   *
   * O que atravessa a API é o **caminho**, nunca a linha de comando — e ele é
   * citado antes de virar comando. A prévia e a confirmação são da tela; aqui
   * ficam as duas travas que a tela não pode garantir sozinha:
   *
   * 1. **precisa ter bit de execução** — o que não é executável não roda;
   * 2. **somente-leitura recusa** — executar não é ler.
   */
  router.post('/execute', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    const files = arquivosDe(session, req.params.id);
    if (typeof session.exec !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não executa comandos.`);
    }
    const caminho = requireString((req.body ?? {}).path, 'path');

    // A escrita já é recusada pelo driver quando a conexão é somente-leitura;
    // executar precisa da própria recusa, porque não passa por `write`.
    if (session.somenteLeitura === true) {
      throw new Error('Esta conexão está marcada como somente-leitura.');
    }

    const pai = caminho.slice(0, Math.max(1, caminho.lastIndexOf('/')));
    const entrada = (await files.list(pai)).find((e) => e.path === caminho);
    if (entrada === undefined) throw new Error(`Não encontrei "${caminho}" no servidor.`);
    if (entrada.kind !== 'file' || !ehExecutavelPeloModo(entrada.mode)) {
      throw new Error(`"${entrada.name}" não tem permissão de execução no servidor.`);
    }

    res.json(ok(await session.exec(`${aspasDeShell(caminho)} 2>&1`)));
  }));

  return router;
}

/**
 * O modo em octal tem bit de execução?
 *
 * A listagem entrega `mode` como texto (`0755`) — é o formato do contrato. Ler
 * de volta aqui é mais honesto que devolver o número cru só para esta conta.
 */
function ehExecutavelPeloModo(mode: string | undefined): boolean {
  if (mode === undefined) return false;
  const numero = Number.parseInt(mode, 8);
  return Number.isInteger(numero) && (numero & 0o111) !== 0;
}
