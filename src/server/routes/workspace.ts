// Rotas do espaço de trabalho: qualquer pasta da máquina.
//
// A mudança de fundo da spec 012 está aqui: o espaço de trabalho passou a ser
// um **caminho**, e não o nome de uma subpasta de `projects/`. Nome exigia uma
// pasta base; caminho não exige nada — que era exatamente o que prendia o
// usuário dentro de um projeto.
//
// Sobre não haver cerca: a IDE já lê e grava caminho absoluto arbitrário em
// `/api/file`, executa código do editor e escuta só em `127.0.0.1`. Restringir
// a navegação a uma raiz daria sensação de segurança sem tirar capacidade
// nenhuma de quem já chegou até aqui.
import { Router } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireString, wrap } from '../http/handlers';
import { EXTENSOES_DE_SIMBOLO, extractSymbols, type SymbolInfo } from '../symbols';
import {
  dentroDaPasta, filhosDaPasta, listarSubpastas, pastaValida, varrerArquivos,
  type FileNode,
} from '../pastas';
import type { EstadoStore } from '../estado';

export interface RetratoDoEspaco {
  readonly pasta: string | null;
  readonly recentes: readonly string[];
  readonly arvore: readonly FileNode[];
  readonly simbolos: readonly SymbolInfo[];
  /** Verdadeiro quando o teto cortou a árvore. */
  readonly truncated: boolean;
}

const VAZIO: RetratoDoEspaco = {
  pasta: null, recentes: [], arvore: [], simbolos: [], truncated: false,
};

export function createWorkspaceRouter(estado: EstadoStore, raizDoProjeto: string): Router {
  const router = Router();
  const ok = (data: unknown) => ({ success: true, data, error: null });

  /**
   * Tudo que a interface precisa para desenhar um quadro coerente, de uma vez.
   *
   * Três rotas dariam três momentos, e a árvore apareceria antes dos símbolos —
   * o tipo de piscar que a migração para React removeu.
   */
  const retrato = (): RetratoDoEspaco => {
    const atual = estado.ler();
    if (atual.pastaAtual === null) return { ...VAZIO, recentes: atual.recentes };

    let pasta: string;
    try {
      pasta = pastaValida(atual.pastaAtual);
    } catch {
      // A pasta sumiu desde a última sessão. Esquecer é melhor que insistir:
      // sem isto, a IDE tentaria abri-la de novo a cada subida.
      const limpo = estado.esquecer(atual.pastaAtual);
      return { ...VAZIO, recentes: limpo.recentes };
    }

    // Só o primeiro nível: o resto chega quando o usuário abrir a pasta.
    const { nodes, truncated } = filhosDaPasta(pasta);
    const simbolos: SymbolInfo[] = [];
    for (const arquivo of varrerArquivos(pasta, { extensoes: EXTENSOES_DE_SIMBOLO }).arquivos) {
      try {
        simbolos.push(...extractSymbols(arquivo, fs.readFileSync(arquivo, 'utf8')));
      } catch {
        // Arquivo ilegível ou binário: ignora e segue com os demais.
      }
    }
    return { pasta, recentes: atual.recentes, arvore: nodes, simbolos, truncated };
  };

  /**
   * Os filhos de UMA pasta do projeto (spec 034).
   *
   * A árvore carrega um nível por vez, então cada `>` clicado vira uma chamada
   * aqui. O caminho vem do cliente e é conferido contra a pasta aberta — ler
   * fora dela seria expor o disco inteiro por uma URL.
   */
  router.get('/files/children', wrap((req, res) => {
    const atual = estado.ler().pastaAtual;
    if (atual === null) throw new Error('Nenhuma pasta aberta.');
    const raiz = pastaValida(atual);
    const bruto = typeof req.query.path === 'string' ? req.query.path : '';
    const alvo = bruto === '' ? raiz : dentroDaPasta(raiz, bruto);
    res.json({ success: true, data: filhosDaPasta(pastaValida(alvo)), error: null });
  }));

  /** Navegador de pastas. Sem `path`, começa na pasta pessoal do usuário. */
  router.get('/folders', wrap((req, res) => {
    const bruto = typeof req.query.path === 'string' && req.query.path !== ''
      ? req.query.path
      : os.homedir();
    res.json(ok(listarSubpastas(pastaValida(bruto))));
  }));

  /**
   * O `README.md` da própria IDE — o destino do `Help → Documentation`.
   *
   * A decisão do lote foi dar um destino honesto em vez de remover o item: a
   * IDE não tem documentação escrita, mas tem um README, e é para ele que o
   * usuário deve ser levado.
   */
  router.get('/docs', wrap((_req, res) => {
    const caminho = path.join(raizDoProjeto, 'README.md');
    if (!fs.existsSync(caminho)) throw new Error('O README.md da IDE não foi encontrado.');
    res.json(ok({ path: caminho }));
  }));

  router.get('/workspace', wrap((_req, res) => {
    res.json(ok(retrato()));
  }));

  router.post('/workspace', wrap((req, res) => {
    // Valida ANTES de gravar: pasta inexistente não pode entrar no histórico.
    const pasta = pastaValida(requireString(req.body?.path, 'path'));
    estado.abrir(pasta);
    res.json(ok(retrato()));
  }));

  router.delete('/workspace', wrap((_req, res) => {
    estado.fechar();
    res.json(ok(retrato()));
  }));

  /** Tira uma pasta do histórico — usado quando ela não existe mais. */
  router.delete('/workspace/recent', wrap((req, res) => {
    estado.esquecer(requireString(req.body?.path, 'path'));
    res.json(ok(retrato()));
  }));

  /** Cria um arquivo dentro da pasta aberta. */
  router.post('/workspace/file', wrap((req, res) => {
    const atual = estado.ler().pastaAtual;
    if (atual === null) throw new Error('Abra uma pasta antes de criar um arquivo.');
    const pasta = pastaValida(atual);

    const relativo = requireString(req.body?.name, 'name').trim();
    if (relativo === '') throw new Error('O nome do arquivo não pode ser vazio.');
    const alvo = dentroDaPasta(pasta, relativo);
    if (fs.existsSync(alvo)) throw new Error(`O arquivo "${relativo}" já existe na pasta.`);

    const conteudo = typeof req.body?.content === 'string' ? req.body.content : '';
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, conteudo, 'utf8');
    res.status(201).json(ok({ path: alvo }));
  }));

  return router;
}
