// Rotas /api/language.
//
// Três perguntas, uma forma só: onde estou → lista de lugares. O corpo carrega
// o conteúdo da tela quando ele difere do disco, porque navegar não pode exigir
// salvar antes.
import { Router } from 'express';
import { wrap } from '../http/handlers';
import {
  definicao, definicaoDeTipo, diagnosticos, lugaresParaRenomear, referencias, sugestoes,
  type Pergunta,
} from '../linguagem';
import {
  atendePorSimbolo, definicaoPorSimbolo, palavraNaPosicao, referenciasPorTexto,
} from '../navegacao-por-simbolo';
import * as fs from 'fs';
import { pastaPrincipal } from '../../shared/estado';
import { pastaValida } from '../pastas';
import type { EstadoStore } from '../estado';

/** O texto do arquivo, quando o cliente não mandou o da tela. */
function lerArquivo(caminho: string): string {
  try {
    return fs.readFileSync(caminho, 'utf8');
  } catch {
    return '';
  }
}

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

  /**
   * Ir para a definição.
   *
   * Duas fontes, e a ordem importa: o serviço do TypeScript primeiro — ele
   * entende tipos e acerta o método do objeto certo —, e o índice de símbolos
   * como queda, para Python e PHP (T040). Sem o serviço, `.py` e `.php` não
   * tinham navegação nenhuma.
   */
  router.post('/definition', wrap((req, res) => {
    const p = lerPergunta(req.body);
    const doServico = definicao(p);
    if (doServico.length > 0 || !atendePorSimbolo(p.caminho)) {
      res.json(ok({ alvos: doServico }));
      return;
    }
    const palavra = palavraNaPosicao(
      p.conteudo ?? lerArquivo(p.caminho),
      p.linha,
      p.coluna
    );
    res.json(ok({ alvos: definicaoPorSimbolo(p.pasta, p.caminho, palavra) }));
  }));

  /** Erros e avisos do arquivo (T037). */
  router.post('/diagnostics', wrap((req, res) => {
    res.json(ok({ problemas: diagnosticos(lerPergunta(req.body)) }));
  }));

  /**
   * Os lugares onde um símbolo seria renomeado (T038).
   *
   * Só DEVOLVE — quem aplica é a interface, depois de mostrar a lista. É a nota
   * dele: *"mostrando os arquivos afetados antes de aplicar"*.
   */
  router.post('/rename-locations', wrap((req, res) => {
    res.json(ok({ lugares: lugaresParaRenomear(lerPergunta(req.body)) }));
  }));

  /** O que completar nesta posição (T114). */
  router.post('/completions', wrap((req, res) => {
    res.json(ok({ sugestoes: sugestoes(lerPergunta(req.body)) }));
  }));

  router.post('/type-definition', wrap((req, res) => {
    res.json(ok({ alvos: definicaoDeTipo(lerPergunta(req.body)) }));
  }));

  router.post('/references', wrap((req, res) => {
    const p = lerPergunta(req.body);
    const doServico = referencias(p);
    if (doServico.length > 0 || !atendePorSimbolo(p.caminho)) {
      res.json(ok({ alvos: doServico }));
      return;
    }
    // Busca por TEXTO, com fronteira de palavra: ela não distingue a variável
    // do comentário que fala dela. É o que dá sem analisar a linguagem, e a
    // alternativa honesta seria não oferecer o item em Python e PHP.
    const palavra = palavraNaPosicao(p.conteudo ?? lerArquivo(p.caminho), p.linha, p.coluna);
    res.json(ok({ alvos: referenciasPorTexto(p.pasta, palavra) }));
  }));

  return router;
}
