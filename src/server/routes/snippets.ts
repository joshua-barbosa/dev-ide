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

  /**
   * Importa snippets do VS Code (T017).
   *
   * O caminho vem do cliente e é usado como veio: a IDE já lê e grava caminho
   * absoluto arbitrário em `/api/file`, e cercar só esta rota daria sensação de
   * segurança sem tirar capacidade de quem chegou até aqui — é a mesma nota do
   * `routes/workspace.ts`.
   */
  router.post('/import', wrap((req, res) => {
    res.json(ok(snippets.importar(requireString(req.body?.path, 'path'))));
  }));

  router.delete('/:id', wrap((req, res) => {
    res.json(ok({ removido: snippets.remover(requireString(req.params.id, 'id')) }));
  }));

  return router;
}
