// Rotas /api/commands.
//
// Junta duas fontes que não se misturam: os **descobertos**, lidos do manifesto
// da pasta aberta, e os **salvos**, que valem em qualquer pasta. A separação é
// do contrato, e não da interface — descoberto não tem id porque não há o que
// editar nele.
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { requireString, wrap } from '../http/handlers';
import { scriptsDoManifesto, validarComando, type ComandoDescoberto } from '../../shared/comandos-salvos';
import type { ComandosStore } from '../comandos';
import type { EstadoStore } from '../estado';

const MANIFESTOS = ['package.json', 'composer.json'] as const;

export function createComandosRouter(comandos: ComandosStore, estado: EstadoStore): Router {
  const router = Router();
  const ok = (data: unknown) => ({ success: true, data, error: null });

  /**
   * Lê os manifestos de TODAS as raízes abertas (T004).
   *
   * Um espaço com back e front tem um `package.json` em cada, e mostrar só os
   * scripts do primeiro esconderia metade do que dá para rodar.
   */
  const descobertos = (): readonly ComandoDescoberto[] => {
    const saida: ComandoDescoberto[] = [];
    for (const pasta of estado.ler().pastas) {
      for (const manifesto of MANIFESTOS) {
        try {
          const conteudo = fs.readFileSync(path.join(pasta, manifesto), 'utf8');
          saida.push(...scriptsDoManifesto(conteudo, manifesto));
        } catch {
          // Não existe, não dá para ler, ou está quebrado: segue sem ele.
        }
      }
    }
    return saida;
  };

  router.get('/', wrap((_req, res) => {
    res.json(ok({ salvos: comandos.ler(), descobertos: descobertos() }));
  }));

  router.post('/', wrap((req, res) => {
    // Valida contra os que já existem: nome repetido é recusado aqui, e não na
    // interface, para valer também para quem chamar a rota direto.
    const dados = validarComando(req.body, comandos.ler());
    res.status(201).json(ok(comandos.criar(dados)));
  }));

  router.delete('/:id', wrap((req, res) => {
    res.json(ok({ removido: comandos.remover(requireString(req.params.id, 'id')) }));
  }));

  return router;
}
