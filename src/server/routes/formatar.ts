// Rotas /api/format — Beautify, Minify e o que a máquina oferece.
import { Router } from 'express';
import { requireString, wrap } from '../http/handlers';
import { capacidades, formatar } from '../formatador';
import { estadoDasFerramentas } from '../ferramentas-da-maquina';
import type { ModoDeFormatacao } from '../../shared/formatacao';

export function createFormatarRouter(): Router {
  const router = Router();
  const ok = (data: unknown) => ({ success: true, data, error: null });

  /**
   * O que cada linguagem sabe fazer, JÁ com o que a máquina oferece.
   *
   * A interface pergunta uma vez e obedece: é o Artigo III. Sem isto ela
   * precisaria repetir a tabela do `shared/formatacao.ts` e adivinhar sozinha
   * se o `ruff` existe — que é justamente o que ela não tem como saber.
   */
  router.get('/', wrap((_req, res) => {
    res.json(ok({ capacidades: capacidades(), ferramentas: estadoDasFerramentas() }));
  }));

  router.post('/', wrap(async (req, res) => {
    const modo = requireString(req.body?.modo, 'modo');
    if (modo !== 'beautify' && modo !== 'minify') throw new Error(`Modo desconhecido: "${modo}".`);
    const texto = typeof req.body?.texto === 'string' ? (req.body.texto as string) : '';
    const tabSize = Number.isInteger(req.body?.tabSize) ? (req.body.tabSize as number) : 2;
    const dialeto = typeof req.body?.dialeto === 'string' ? (req.body.dialeto as string) : undefined;

    const saida = await formatar(
      texto,
      requireString(req.body?.linguagem, 'linguagem'),
      modo as ModoDeFormatacao,
      { tabSize, ...(dialeto === undefined ? {} : { dialeto }) }
    );
    res.json(ok({ texto: saida }));
  }));

  return router;
}
