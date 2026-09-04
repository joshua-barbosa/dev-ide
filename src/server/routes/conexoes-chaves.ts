// Rotas de chave-valor: ler, gravar e apagar uma chave; e o estado do servidor.
//
// Saiu de `connections.ts` pelo teto de 800 linhas do Artigo IV, e porque é uma
// coisa só — o que a IDE faz depois de a árvore levar até uma chave (spec 089).
//
// Todas recusam com uma frase clara quando o driver não sabe do que se trata:
// pedir a chave de um PostgreSQL é erro de quem chamou, e responder vazio
// esconderia isso.
import { Router } from 'express';
import type { SessionPool } from '../connections/pool';
import type { Session } from '../connections/types';
import { requireString, wrap } from '../http/handlers';
import { TIPOS_DE_CHAVE, type TipoDeChave } from '../../shared/sql/redis-chave';

const ok = (data: unknown) => ({ success: true, data, error: null });

function exigir<T>(valor: T | undefined, id: string, o_que: string): T {
  if (valor === undefined) {
    throw new Error(`A conexão "${id}" não ${o_que}.`);
  }
  return valor;
}

function tipoValido(bruto: unknown): TipoDeChave {
  const nome = String(bruto ?? '');
  if (!(TIPOS_DE_CHAVE as readonly string[]).includes(nome)) {
    throw new Error(`Tipo de chave desconhecido: "${nome}".`);
  }
  return nome as TipoDeChave;
}

export function criarRotasDeChaves(pool: SessionPool): Router {
  const router = Router();

  const sessaoDe = async (id: string): Promise<Session> => pool.acquire(id);

  /** O conteúdo de uma chave: tipo, prazo, tamanho e valor. */
  router.get('/:id/key', wrap(async (req, res) => {
    const sessao = await sessaoDe(req.params.id);
    const ler = exigir(sessao.readKey, req.params.id, 'guarda chaves');
    const chave = typeof req.query.name === 'string' ? req.query.name : '';
    if (chave === '') throw new Error('Diga qual chave abrir.');
    res.json(ok(await ler(chave)));
  }));

  router.put('/:id/key', wrap(async (req, res) => {
    const sessao = await sessaoDe(req.params.id);
    const gravar = exigir(sessao.writeKey, req.params.id, 'guarda chaves');
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    await gravar({
      chave: requireString(corpo.chave, 'chave'),
      tipo: tipoValido(corpo.tipo),
      ...(typeof corpo.valor === 'string' ? { valor: corpo.valor } : {}),
      // `null` é "tirar o prazo"; ausente é "não mexer no prazo". São coisas
      // diferentes, e juntá-las apagaria o prazo de quem só editou o valor.
      ...(corpo.ttl === null ? { ttl: -1 }
        : typeof corpo.ttl === 'number' ? { ttl: Math.floor(corpo.ttl) } : {}),
    });
    res.json(ok({ gravou: true }));
  }));

  router.delete('/:id/key', wrap(async (req, res) => {
    const sessao = await sessaoDe(req.params.id);
    const apagar = exigir(sessao.deleteKey, req.params.id, 'guarda chaves');
    const chave = typeof req.query.name === 'string' ? req.query.name : '';
    const prefixo = typeof req.query.prefix === 'string' ? req.query.prefix : '';
    res.json(ok({
      apagadas: await apagar({
        ...(chave === '' ? {} : { chave }),
        ...(prefixo === '' ? {} : { prefixo }),
      }),
    }));
  }));

  /** O painel de estado: versão, memória, clientes e chaves por banco. */
  router.get('/:id/server-state', wrap(async (req, res) => {
    const sessao = await sessaoDe(req.params.id);
    const estado = exigir(sessao.estadoDoServidor, req.params.id, 'tem painel de estado');
    res.json(ok(await estado()));
  }));

  return router;
}
