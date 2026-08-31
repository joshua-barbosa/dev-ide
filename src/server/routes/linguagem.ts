// Rotas /api/language.
//
// Três perguntas, uma forma só: onde estou → lista de lugares. O corpo carrega
// o conteúdo da tela quando ele difere do disco, porque navegar não pode exigir
// salvar antes.
import { Router } from 'express';
import { wrap } from '../http/handlers';
import { definicao, definicaoDeTipo, referencias, type Pergunta } from '../linguagem';
import { pastaPrincipal } from '../../shared/estado';
import { pastaValida } from '../pastas';
import type { EstadoStore } from '../estado';

export function createLinguagemRouter(estado: EstadoStore): Router {
  const router = Router();
  const ok = (data: unknown) => ({ success: true, data, error: null });

  const lerPergunta = (corpo: unknown): Pergunta => {
    const c = (corpo ?? {}) as Record<string, unknown>;
    // A raiz PRINCIPAL: o serviço de linguagem indexa um projeto por vez, e
    // misturar raízes num índice só daria definição de outro projeto.
    const atual = pastaPrincipal(estado.ler());
    if (atual === null) throw new Error('Abra uma pasta para navegar pelo código dela.');
    if (typeof c.caminho !== 'string' || c.caminho === '') throw new Error('Informe o arquivo.');
    const linha = typeof c.linha === 'number' ? Math.trunc(c.linha) : 1;
    const coluna = typeof c.coluna === 'number' ? Math.trunc(c.coluna) : 1;
    return {
      pasta: pastaValida(atual),
      caminho: c.caminho,
      linha: Math.max(1, linha),
      coluna: Math.max(1, coluna),
      ...(typeof c.conteudo === 'string' ? { conteudo: c.conteudo } : {}),
    };
  };

  router.post('/definition', wrap((req, res) => {
    res.json(ok({ alvos: definicao(lerPergunta(req.body)) }));
  }));

  router.post('/type-definition', wrap((req, res) => {
    res.json(ok({ alvos: definicaoDeTipo(lerPergunta(req.body)) }));
  }));

  router.post('/references', wrap((req, res) => {
    res.json(ok({ alvos: referencias(lerPergunta(req.body)) }));
  }));

  return router;
}
