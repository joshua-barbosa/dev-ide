// Rotas /api/search.
//
// Duas rotas com pesos muito diferentes: buscar só lê, substituir **reescreve
// arquivos**. A segunda valida o que a primeira não precisa — e recusa caminho
// fora da pasta aberta, porque a lista vem do cliente.
import { Router } from 'express';
import { wrap } from '../http/handlers';
import type { OpcoesDeBusca } from '../../shared/busca';
import { buscarNaPasta, substituirNaPasta } from '../busca';
import { pastaValida } from '../pastas';
import type { EstadoStore } from '../estado';

function lerOpcoes(bruto: unknown): OpcoesDeBusca {
  const r = (bruto ?? {}) as Record<string, unknown>;
  return {
    regex: r.regex === true,
    maiusculas: r.maiusculas === true,
    palavraInteira: r.palavraInteira === true,
  };
}

function lerTermo(bruto: unknown): string {
  return typeof bruto === 'string' ? bruto : '';
}

export function createBuscaRouter(estado: EstadoStore): Router {
  const router = Router();
  const ok = (data: unknown) => ({ success: true, data, error: null });

  /** A pasta aberta, ou erro — buscar sem pasta não significa nada. */
  const pastaAberta = (): string => {
    const atual = estado.ler().pastaAtual;
    if (atual === null) throw new Error('Abra uma pasta para pesquisar nela.');
    return pastaValida(atual);
  };

  router.post('/', wrap((req, res) => {
    const termo = lerTermo(req.body?.termo);
    // Termo vazio devolve resultado vazio, e não erro: o campo fica vazio
    // enquanto o usuário apaga o que digitou, e uma caixa de erro a cada tecla
    // seria hostil.
    if (termo.trim() === '') {
      res.json(ok({ arquivos: [], totalDeOcorrencias: 0, truncado: false, arquivosVisitados: 0 }));
      return;
    }
    res.json(ok(buscarNaPasta(pastaAberta(), termo, lerOpcoes(req.body))));
  }));

  router.post('/replace', wrap((req, res) => {
    const termo = lerTermo(req.body?.termo);
    if (termo.trim() === '') throw new Error('Informe o que procurar antes de substituir.');

    const substituto = typeof req.body?.substituto === 'string' ? req.body.substituto : '';
    const caminhos = Array.isArray(req.body?.caminhos)
      ? (req.body.caminhos as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    if (caminhos.length === 0) throw new Error('Nenhum arquivo indicado para substituir.');

    res.json(
      ok(substituirNaPasta(pastaAberta(), caminhos, termo, lerOpcoes(req.body), substituto))
    );
  }));

  return router;
}
