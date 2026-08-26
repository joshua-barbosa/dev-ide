// Rotas /api/search.
//
// Duas rotas com pesos muito diferentes: buscar só lê, substituir **reescreve
// arquivos**. A segunda valida o que a primeira não precisa — e recusa caminho
// fora da pasta aberta, porque a lista vem do cliente.
import { Router } from 'express';
import { wrap } from '../http/handlers';
import type { OpcoesDeBusca } from '../../shared/busca';
import { buscarNaPasta, desfazerSubstituicao, substituirNaPasta } from '../busca';
import { montarFiltro } from '../../shared/busca-filtro';
import { HistoricoDeSubstituicoes } from '../desfazer-substituicao';
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
  /**
   * O histórico de desfazer (T032), em MEMÓRIA do processo.
   *
   * Não vai para disco de propósito: gravá-lo seria criar um segundo histórico
   * de versões, e o `Timeline` (T010) é a feature que faz isso direito. Aqui é
   * "errei agora e quero voltar", e reiniciar a IDE zera — como zera o desfazer
   * de qualquer editor.
   */
  const historico = new HistoricoDeSubstituicoes();
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
    // `include`/`exclude` (T031). Ausentes = varre tudo, como sempre foi.
    const filtro = montarFiltro(
      typeof req.body?.incluir === 'string' ? req.body.incluir : '',
      typeof req.body?.excluir === 'string' ? req.body.excluir : ''
    );
    res.json(ok(buscarNaPasta(pastaAberta(), termo, lerOpcoes(req.body), filtro)));
  }));

  router.post('/replace', wrap((req, res) => {
    const termo = lerTermo(req.body?.termo);
    if (termo.trim() === '') throw new Error('Informe o que procurar antes de substituir.');

    const substituto = typeof req.body?.substituto === 'string' ? req.body.substituto : '';
    const caminhos = Array.isArray(req.body?.caminhos)
      ? (req.body.caminhos as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    if (caminhos.length === 0) throw new Error('Nenhum arquivo indicado para substituir.');

    const pasta = pastaAberta();
    const r = substituirNaPasta(pasta, caminhos, termo, lerOpcoes(req.body), substituto);

    // Só guarda o que mudou alguma coisa: uma substituição sem trocas não tem
    // o que desfazer, e entrar na pilha empurraria uma que tem para fora.
    let id: string | null = null;
    let descartadas = 0;
    if (r.antes.size > 0) {
      id = `sub-${Date.now()}`;
      descartadas = historico.guardar({
        id, termo, substituto, quando: new Date().toISOString(), antes: r.antes,
      });
    }

    res.json(ok({
      arquivosAlterados: r.arquivosAlterados,
      trocas: r.trocas,
      // O `antes` NÃO volta para o cliente: são megabytes de conteúdo, e ele
      // não tem o que fazer com eles. O `id` é o bastante para desfazer.
      desfazer: id,
      descartadasDoHistorico: descartadas,
    }));
  }));

  /** Desfaz uma substituição pelo id que a própria substituição devolveu (T032). */
  router.post('/undo', wrap((req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    const item = historico.retirar(id);
    if (item === null) {
      throw new Error('Esta substituição não está mais no histórico de desfazer.');
    }
    res.json(ok({
      ...desfazerSubstituicao(pastaAberta(), item.antes),
      // Os caminhos voltam para a interface reabrir as abas afetadas — é o
      // mesmo gancho que a substituição já usa.
      restauradosCaminhos: [...item.antes.keys()],
      termo: item.termo,
      substituto: item.substituto,
    }));
  }));

  /** O que dá para desfazer, para a interface oferecer. */
  router.get('/undo', wrap((_req, res) => {
    res.json(ok({
      itens: historico.lista().map((s) => ({
        id: s.id, termo: s.termo, substituto: s.substituto,
        quando: s.quando, arquivos: s.antes.size,
      })),
    }));
  }));

  return router;
}
