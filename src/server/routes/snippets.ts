// Rotas /api/snippets.
import { Router } from 'express';
import { requireString, wrap } from '../http/handlers';
import { validarSnippet } from '../../shared/snippets';
import type { SnippetsStore } from '../snippets';

export function createSnippetsRouter(snippets: SnippetsStore): Router {
  const router = Router();
  const ok = (data: unknown) => ({ success: true, data, error: null });

  router.get('/', wrap((_req, res) => {
    res.json(ok(snippets.ler()));
  }));

  router.post('/', wrap((req, res) => {
    // Valida contra os existentes: prefixo repetido na mesma linguagem é
    // recusado aqui, e não na interface, para valer também para quem chamar a
    // rota direto.
    res.status(201).json(ok(snippets.criar(validarSnippet(req.body, snippets.ler()))));
  }));

  router.delete('/:id', wrap((req, res) => {
    res.json(ok({ removido: snippets.remover(requireString(req.params.id, 'id')) }));
  }));

  return router;
}
