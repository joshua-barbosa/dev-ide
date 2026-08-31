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
import { nomeDeCopia } from '../../shared/nome-de-copia';
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
    res.json({ success: true, data: filhosDaPasta(pastaValida(alvo), raiz), error: null });
  }));

  /**
   * Todo arquivo da pasta aberta, para o `Ctrl+P` (T051).
   *
   * Caminhos RELATIVOS: é o que se lê na lista, e o cliente já sabe a raiz.
   *
   * Respeita o `.gitignore` pela mesma razão da busca e dos símbolos — ninguém
   * abre `node_modules/.../index.js` pelo `Ctrl+P`, e ter mil deles na lista
   * empurraria para baixo o arquivo que se procura.
   */
  router.get('/workspace/files', wrap((_req, res) => {
    const atual = estado.ler().pastaAtual;
    if (atual === null) {
      res.json(ok({ files: [], truncated: false }));
      return;
    }
    const raiz = pastaValida(atual);
    const { arquivos, truncated } = varrerArquivos(raiz);
    res.json(ok({
      files: arquivos.map((a) => path.relative(raiz, a)),
      truncated,
    }));
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

  /**
   * Cria uma pasta dentro da pasta aberta.
   *
   * Gêmea da rota de arquivo, e com as mesmas duas guardas: o caminho é
   * conferido contra a pasta aberta, e o que já existe é recusado em vez de
   * silenciosamente reaproveitado — `mkdir -p` sobre uma pasta cheia não dá
   * erro, e o usuário concluiria que criou uma pasta nova.
   */
  router.post('/workspace/folder', wrap((req, res) => {
    const atual = estado.ler().pastaAtual;
    if (atual === null) throw new Error('Abra uma pasta antes de criar outra dentro dela.');
    const pasta = pastaValida(atual);

    const relativo = requireString(req.body?.name, 'name').trim();
    if (relativo === '') throw new Error('O nome da pasta não pode ser vazio.');
    const alvo = dentroDaPasta(pasta, relativo);
    if (fs.existsSync(alvo)) throw new Error(`"${relativo}" já existe na pasta.`);

    fs.mkdirSync(alvo, { recursive: true });
    res.status(201).json(ok({ path: alvo }));
  }));

  // -------------------------------------------------------------------------
  // Renomear, duplicar e excluir (T043, spec 073)
  // -------------------------------------------------------------------------
  //
  // Três guardas em todas elas, e as três já evitaram estrago em alguma IDE:
  //   1. **dentro da pasta aberta** — sem isso a árvore vira um `rm` do disco
  //      inteiro por uma URL;
  //   2. **não sobrescreve** — mover por cima de um arquivo existente perde o
  //      que estava lá, em silêncio;
  //   3. **o que não existe dá erro** — mexer no nada é engano de quem chamou,
  //      e responder "ok" esconderia o engano.

  /** A pasta aberta, validada — ou o erro que diz que não há nenhuma. */
  const raizAberta = (): string => {
    const atual = estado.ler().pastaAtual;
    if (atual === null) throw new Error('Abra uma pasta antes.');
    return pastaValida(atual);
  };

  /** Um item DE DENTRO da pasta aberta, que precisa existir. */
  const itemExistente = (raiz: string, relativo: string): string => {
    const alvo = dentroDaPasta(raiz, relativo.trim());
    if (!fs.existsSync(alvo)) throw new Error(`"${relativo}" não existe.`);
    return alvo;
  };

  router.post('/workspace/rename', wrap((req, res) => {
    const raiz = raizAberta();
    const de = itemExistente(raiz, requireString(req.body?.path, 'path'));
    const nome = requireString(req.body?.name, 'name').trim();
    if (nome === '') throw new Error('O nome não pode ser vazio.');
    // Relativo à PASTA DO ITEM, e não à raiz: quem renomeia digita o nome, e
    // `src/a.ts` renomeado para `b.ts` tem de ficar em `src/`.
    const para = dentroDaPasta(raiz, path.join(path.relative(raiz, path.dirname(de)), nome));

    // `!==` e não `existsSync` sozinho: trocar só a caixa (`utils.ts` para
    // `Utils.ts`) é renomear de verdade, e recusar por "já existe" seria
    // recusar o próprio arquivo.
    if (para !== de && fs.existsSync(para)) {
      throw new Error(`"${nome}" já existe nesta pasta.`);
    }
    fs.mkdirSync(path.dirname(para), { recursive: true });
    fs.renameSync(de, para);
    res.json(ok({ path: para }));
  }));

  router.post('/workspace/duplicate', wrap((req, res) => {
    const raiz = raizAberta();
    const de = itemExistente(raiz, requireString(req.body?.path, 'path'));
    const pai = path.dirname(de);
    const nome = nomeDeCopia(path.basename(de), (c) => fs.existsSync(path.join(pai, c)));
    const para = path.join(pai, nome);
    // `recursive` cobre pasta e arquivo com a mesma chamada — duplicar uma
    // pasta sem o conteúdo dela seria uma casca, não uma cópia.
    fs.cpSync(de, para, { recursive: true });
    res.json(ok({ path: para }));
  }));

  router.delete('/workspace/entry', wrap((req, res) => {
    const raiz = raizAberta();
    const alvo = itemExistente(raiz, requireString(req.body?.path, 'path'));
    // A própria raiz não: o botão direito nela apagaria o projeto e deixaria a
    // IDE apontando para o nada.
    if (alvo === raiz) throw new Error('A pasta aberta não pode ser excluída por aqui.');
    fs.rmSync(alvo, { recursive: true, force: true });
    res.json(ok({ path: alvo }));
  }));

  return router;
}
