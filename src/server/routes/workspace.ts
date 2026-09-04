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
import { ehCaminhoAbsoluto, plataformaAtual, type Plataforma } from '../../shared/plataforma';
import { nomeDoCaminho } from '../../shared/caminho-local';
import { LIMIAR_DE_ARQUIVO_GRANDE } from '../../shared/arquivo-grande';
import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireString, wrap } from '../http/handlers';
import { acharNoPath } from '../ferramentas-da-maquina';
import { EXTENSOES_DE_SIMBOLO, extractSymbols, type SymbolInfo } from '../symbols';
import {
  dentroDaPasta, filhosDaPasta, listarSubpastas, pastaValida, varrerArquivos,
  type FileNode,
} from '../pastas';
import { nomeDeCopia } from '../../shared/nome-de-copia';
import type { EstadoStore } from '../estado';

/** Uma raiz do espaço de trabalho, com a árvore dela (T004). */
export interface RaizAberta {
  readonly pasta: string;
  /** Só o nome, para o cabeçalho — é o que distingue duas raízes na tela. */
  readonly nome: string;
  readonly arvore: readonly FileNode[];
  /** Verdadeiro quando o teto cortou a árvore desta raiz. */
  readonly truncated: boolean;
}

export interface RetratoDoEspaco {
  /**
   * As raízes abertas, na ordem em que foram acrescentadas (T004).
   *
   * Era uma pasta só, no campo `pasta`. Ele continua existindo, valendo a
   * PRIMEIRA raiz: quem só sabe lidar com uma — criar arquivo pelo cabeçalho,
   * o `cwd` do terminal — continua funcionando sem saber que há outras.
   */
  readonly raizes: readonly RaizAberta[];
  readonly pasta: string | null;
  readonly recentes: readonly string[];
  readonly arvore: readonly FileNode[];
  /** Verdadeiro quando o teto cortou a árvore de alguma raiz. */
  readonly truncated: boolean;
  /**
   * Onde o servidor roda (D223).
   *
   * A interface precisa disto para saber que o separador de caminho é `\` — a
   * comparação `caminho.startsWith(raiz + '/')` era falsa em toda subpasta do
   * Windows, e a árvore entrava em laço de pedidos. Vem no retrato, e não numa
   * rota própria, porque a interface já espera por ele para desenhar qualquer
   * coisa: uma segunda ida ao servidor abriria uma janela em que a árvore
   * existe e o separador ainda não.
   */
  readonly plataforma: Plataforma;
}

const VAZIO: Omit<RetratoDoEspaco, 'plataforma'> = {
  raizes: [], pasta: null, recentes: [], arvore: [], truncated: false,
};

/** O nome de uma pasta, sem o caminho. */
function nomeDaPasta(caminho: string): string {
  return nomeDoCaminho(caminho, plataformaAtual());
}

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
    let atual = estado.ler();
    const raizes: RaizAberta[] = [];
    let truncated = false;

    for (const bruta of atual.pastas) {
      let pasta: string;
      try {
        pasta = pastaValida(bruta);
      } catch {
        // A pasta sumiu desde a última sessão. Esquecer é melhor que insistir:
        // sem isto, a IDE tentaria abri-la de novo a cada subida. Com várias
        // raízes, as que sobreviveram seguem abertas.
        atual = estado.esquecer(bruta);
        continue;
      }

      // Só o primeiro nível: o resto chega quando o usuário abrir a pasta.
      const { nodes, truncated: cortada } = filhosDaPasta(pasta);
      raizes.push({ pasta, nome: nomeDaPasta(pasta), arvore: nodes, truncated: cortada });
      truncated = truncated || cortada;
    }

    if (raizes.length === 0) {
      return { ...VAZIO, recentes: atual.recentes, plataforma: plataformaAtual() };
    }
    const primeira = raizes[0] as RaizAberta;
    return {
      raizes,
      // Os três campos antigos, valendo a PRIMEIRA raiz — ver a nota no tipo.
      pasta: primeira.pasta,
      arvore: primeira.arvore,
      recentes: atual.recentes,
      truncated,
      plataforma: plataformaAtual(),
    };
  };

  /** As raízes abertas, validadas. Vazio quando não há nenhuma. */
  const raizesAbertas = (): readonly string[] => {
    const abertas: string[] = [];
    for (const bruta of estado.ler().pastas) {
      try {
        abertas.push(pastaValida(bruta));
      } catch {
        // Sumiu do disco: o `retrato` já a esquece na próxima leitura.
      }
    }
    return abertas;
  };

  /**
   * A raiz que contém este caminho, ou erro (T004).
   *
   * Com uma raiz só isto era `dentroDaPasta(raiz, x)`. Com várias, a pergunta
   * é a mesma feita a cada uma: sair de TODAS continua sendo recusado.
   */
  const raizDe = (caminho: string): string => {
    const alvo = path.resolve(caminho);
    for (const raiz of raizesAbertas()) {
      if (alvo === raiz || alvo.startsWith(raiz + path.sep)) return raiz;
    }
    throw new Error('O caminho precisa ficar dentro de uma das pastas abertas.');
  };

  /**
   * Os filhos de UMA pasta do projeto (spec 034).
   *
   * A árvore carrega um nível por vez, então cada `>` clicado vira uma chamada
   * aqui. O caminho vem do cliente e é conferido contra a pasta aberta — ler
   * fora dela seria expor o disco inteiro por uma URL.
   */
  router.get('/files/children', wrap((req, res) => {
    const abertas = raizesAbertas();
    const primeira = abertas[0];
    if (primeira === undefined) throw new Error('Nenhuma pasta aberta.');
    const bruto = typeof req.query.path === 'string' ? req.query.path : '';
    // Sem `path`, a primeira raiz; com `path`, a raiz que o contém (T004).
    const raiz = bruto === '' ? primeira : raizDe(bruto);
    const alvo = bruto === '' ? raiz : dentroDaPasta(raiz, bruto);
    res.json({ success: true, data: filhosDaPasta(pastaValida(alvo), raiz), error: null });
  }));

  /**
   * Todo arquivo das pastas abertas, para o `Ctrl+P` (T051, T004).
   *
   * **Caminho ABSOLUTO com o rótulo separado.** Era relativo, e com uma raiz só
   * bastava — o cliente sabia colar o prefixo. Com várias, dois `index.ts` de
   * projetos diferentes seriam a mesma linha; e devolver só o relativo obrigaria
   * a adivinhar de qual raiz ele veio.
   *
   * Respeita o `.gitignore` pela mesma razão da busca e dos símbolos — ninguém
   * abre `node_modules/.../index.js` pelo `Ctrl+P`, e ter mil deles na lista
   * empurraria para baixo o arquivo que se procura.
   */
  router.get('/workspace/files', wrap((_req, res) => {
    const abertas = raizesAbertas();
    const files: Array<{ path: string; label: string }> = [];
    let truncated = false;
    // O nome da raiz entra no rótulo só quando há mais de uma: com uma só, ele
    // seria o mesmo prefixo em toda linha, ocupando espaço e não informando.
    const comRaiz = abertas.length > 1;

    for (const raiz of abertas) {
      const r = varrerArquivos(raiz);
      truncated = truncated || r.truncated;
      for (const arquivo of r.arquivos) {
        const relativo = path.relative(raiz, arquivo);
        files.push({
          path: arquivo,
          label: comRaiz ? `${nomeDaPasta(raiz)}/${relativo}` : relativo,
        });
      }
    }
    res.json(ok({ files, truncated }));
  }));

  /** Navegador de pastas. Sem `path`, começa na pasta pessoal do usuário. */
  /**
   * Os arquivos de UMA pasta, para subi-la ao servidor (T090).
   *
   * Reusa a mesma varredura do `Ctrl+P`, e por isso **respeita o
   * `.gitignore`** — subir `node_modules` num arraste seria dezenas de milhares
   * de arquivos que ninguém quis. O que ficou de fora é CONTADO e devolvido:
   * filtro silencioso num upload é o pior desfecho, porque o usuário pensa que
   * mandou a pasta inteira.
   */
  router.get('/workspace/folder-files', wrap((req, res) => {
    const alvo = requireString(req.query.path, 'path');
    const { raiz } = itemExistente(alvo);
    if (!fs.statSync(dentroDaPasta(raiz, alvo)).isDirectory()) {
      throw new Error(`"${alvo}" não é uma pasta.`);
    }
    const pasta = dentroDaPasta(raiz, alvo);

    const rastreados = varrerArquivos(pasta);
    // Tudo, para saber QUANTOS o `.gitignore` tirou. Uma segunda varredura é
    // barata perto de mandar o usuário descobrir sozinho o que não subiu.
    const todos = varrerArquivos(pasta, { ignorarGitignore: true });

    res.json(ok({
      files: rastreados.arquivos.map((caminho) => ({
        path: caminho,
        relative: path.relative(pasta, caminho),
        bytes: fs.statSync(caminho).size,
      })),
      ignored: Math.max(0, todos.arquivos.length - rastreados.arquivos.length),
      truncated: rastreados.truncated,
    }));
  }));

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

  /**
   * Os símbolos de TODO o espaço — a aba Símbolos, e só ela (D222).
   *
   * Isto morava dentro do `retrato()`, e era o defeito: ler e analisar o
   * projeto inteiro acontecia em toda subida, em toda troca de raiz e depois de
   * cada criar, renomear, duplicar e excluir. Medido num repositório de 584
   * arquivos: 588 ms de event loop travado, por vez. Num projeto grande, o
   * congelamento que ele descreveu.
   *
   * Rota própria significa: quem não abre a aba não paga nada.
   */
  router.get('/workspace/symbols', wrap((_req, res) => {
    const simbolos: SymbolInfo[] = [];
    for (const pasta of raizesAbertas()) {
      for (const arquivo of varrerArquivos(pasta, { extensoes: EXTENSOES_DE_SIMBOLO }).arquivos) {
        try {
          simbolos.push(...extractSymbols(arquivo, fs.readFileSync(arquivo, 'utf8')));
        } catch {
          // Arquivo ilegível ou binário: ignora e segue com os demais.
        }
      }
    }
    res.json(ok({ simbolos }));
  }));

  /**
   * Os símbolos de UM arquivo — a trilha acima do editor.
   *
   * A trilha sempre usou só os do arquivo em foco (`shared/breadcrumb.ts`), e
   * mesmo assim recebia a lista do projeto inteiro. Um arquivo é uma leitura e
   * uma análise; a diferença entre isto e a rota de cima é o projeto todo.
   */
  router.get('/symbols', wrap((req, res) => {
    const caminho = path.resolve(requireString(req.query?.path, 'path'));
    // Passa pela mesma porteira do resto: nada de ler fora das raízes abertas.
    raizDe(caminho);
    if (!EXTENSOES_DE_SIMBOLO.has(path.extname(caminho))) {
      res.json(ok({ simbolos: [] }));
      return;
    }
    // Arquivo grande não passa pelo analisador: um `.ts` de 20 MB levaria o
    // compilador do TypeScript a segundos de trabalho a cada aba aberta, e o
    // preço seria pago pela barra de navegação — que é enfeite, não função.
    try {
      if (fs.statSync(caminho).size > LIMIAR_DE_ARQUIVO_GRANDE) {
        res.json(ok({ simbolos: [] }));
        return;
      }
    } catch {
      res.json(ok({ simbolos: [] }));
      return;
    }
    try {
      res.json(ok({ simbolos: extractSymbols(caminho, fs.readFileSync(caminho, 'utf8')) }));
    } catch {
      // Sumiu, é binário ou não se deixa ler: uma trilha sem símbolo é melhor
      // que um erro vermelho por causa da barra de navegação.
      res.json(ok({ simbolos: [] }));
    }
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

  /**
   * Soma uma pasta ao espaço de trabalho, sem tirar as que já estão (T004).
   *
   * Rota própria e não um parâmetro do `POST /workspace`: **abrir** e
   * **acrescentar** são dois gestos, e um sinalizador booleano numa rota que
   * substitui tudo é a forma mais fácil de apagar o projeto de alguém por
   * engano.
   */
  router.post('/workspace/add', wrap((req, res) => {
    const pasta = pastaValida(requireString(req.body?.path, 'path'));
    estado.acrescentar(pasta);
    res.json(ok(retrato()));
  }));

  /** Tira UMA raiz do espaço, deixando as outras (T004). */
  router.delete('/workspace/folder', wrap((req, res) => {
    estado.remover(requireString(req.body?.path, 'path'));
    res.json(ok(retrato()));
  }));

  /** Tira uma pasta do histórico — usado quando ela não existe mais. */
  router.delete('/workspace/recent', wrap((req, res) => {
    estado.esquecer(requireString(req.body?.path, 'path'));
    res.json(ok(retrato()));
  }));

  /**
   * A raiz onde uma criação deve cair.
   *
   * Um nome com barra pode vir prefixado pelo nome de outra raiz (`api/x.ts`
   * num espaço com `api` e `web`). Casar o primeiro segmento com o nome de uma
   * raiz é o que faz `Novo arquivo aqui` funcionar em qualquer uma delas.
   */
  const raizParaCriar = (relativo: string): { raiz: string; dentro: string } => {
    const abertas = raizesAbertas();
    const primeira = abertas[0];
    if (primeira === undefined) throw new Error('Abra uma pasta antes.');
    if (abertas.length === 1) return { raiz: primeira, dentro: relativo };

    const corte = relativo.indexOf('/');
    if (corte > 0) {
      const cabeca = relativo.slice(0, corte);
      const alvo = abertas.find((r) => nomeDaPasta(r) === cabeca);
      if (alvo !== undefined) return { raiz: alvo, dentro: relativo.slice(corte + 1) };
    }
    return { raiz: primeira, dentro: relativo };
  };

  /** Cria um arquivo dentro de uma das pastas abertas. */
  router.post('/workspace/file', wrap((req, res) => {
    const bruto = requireString(req.body?.name, 'name').trim();
    if (bruto === '') throw new Error('O nome do arquivo não pode ser vazio.');
    const { raiz: pasta, dentro } = raizParaCriar(bruto);

    const relativo = dentro;
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
    const bruto = requireString(req.body?.name, 'name').trim();
    if (bruto === '') throw new Error('O nome da pasta não pode ser vazio.');
    const { raiz: pasta, dentro: relativo } = raizParaCriar(bruto);
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

  /**
   * Um item de dentro de ALGUMA pasta aberta, que precisa existir.
   *
   * Devolve o item e a raiz dele: renomear precisa das duas coisas, e procurar
   * a raiz duas vezes daria a chance de as duas discordarem.
   */
  const itemExistente = (relativo: string): { alvo: string; raiz: string } => {
    const limpo = relativo.trim();
    const abertas = raizesAbertas();
    const primeira = abertas[0];
    if (primeira === undefined) throw new Error('Abra uma pasta antes.');

    // Caminho absoluto: a raiz é a que o contém. Relativo: o da primeira raiz,
    // que é como a árvore sempre chamou — ela manda o caminho absoluto.
    const raiz = ehCaminhoAbsoluto(limpo, plataformaAtual()) ? raizDe(limpo) : primeira;
    const alvo = dentroDaPasta(raiz, limpo);
    if (!fs.existsSync(alvo)) throw new Error(`"${relativo}" não existe.`);
    return { alvo, raiz };
  };

  router.post('/workspace/rename', wrap((req, res) => {
    const { alvo: de, raiz } = itemExistente(requireString(req.body?.path, 'path'));
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
    const { alvo: de } = itemExistente(requireString(req.body?.path, 'path'));
    const pai = path.dirname(de);
    const nome = nomeDeCopia(path.basename(de), (c) => fs.existsSync(path.join(pai, c)));
    const para = path.join(pai, nome);
    // `recursive` cobre pasta e arquivo com a mesma chamada — duplicar uma
    // pasta sem o conteúdo dela seria uma casca, não uma cópia.
    fs.cpSync(de, para, { recursive: true });
    res.json(ok({ path: para }));
  }));

  router.delete('/workspace/entry', wrap((req, res) => {
    const { alvo, raiz } = itemExistente(requireString(req.body?.path, 'path'));
    // A própria raiz não: o botão direito nela apagaria o projeto e deixaria a
    // IDE apontando para o nada.
    if (alvo === raiz) throw new Error('A pasta aberta não pode ser excluída por aqui.');
    fs.rmSync(alvo, { recursive: true, force: true });
    res.json(ok({ path: alvo }));
  }));

  /**
   * Colar: copia ou MOVE um item para dentro de uma pasta (menu da árvore).
   *
   * Uma rota para os dois porque o cuidado é o mesmo, e é todo ele sobre não
   * destruir nada:
   *
   * - **o nome só ganha sufixo quando já existe um igual no destino.** O
   *   `nomeDeCopia` do Duplicar acrescenta " copy" sempre — e ali é certo,
   *   porque a cópia nasce na MESMA pasta. Aqui não: colar `a.txt` numa pasta
   *   que não tem `a.txt` tem de dar `a.txt`. O sufixo existe só para não
   *   sobrescrever em silêncio, que seria perder trabalho num gesto de dois
   *   cliques;
   * - **colar uma pasta dentro dela mesma é recusado** — `cpSync` entraria em
   *   recursão e encheria o disco antes de alguém perceber;
   * - mover é `rename`, que no mesmo sistema de arquivos é atômico. Entre
   *   sistemas diferentes ele falha com `EXDEV`, e aí a cópia-e-apaga entra.
   */
  router.post('/workspace/paste', wrap((req, res) => {
    const { alvo: de } = itemExistente(requireString(req.body?.path, 'path'));
    const { alvo: destino } = itemExistente(requireString(req.body?.into, 'into'));
    const recortar = req.body?.cut === true;

    if (!fs.statSync(destino).isDirectory()) throw new Error('O destino não é uma pasta.');
    if (de === destino) throw new Error('Origem e destino são o mesmo item.');
    if (fs.statSync(de).isDirectory() && (destino + path.sep).startsWith(de + path.sep)) {
      throw new Error('Não dá para colar uma pasta dentro dela mesma.');
    }

    const original = path.basename(de);
    const ocupado = (c: string): boolean => fs.existsSync(path.join(destino, c));
    const nome = ocupado(original) ? nomeDeCopia(original, ocupado) : original;
    const para = path.join(destino, nome);
    if (recortar) {
      try {
        fs.renameSync(de, para);
      } catch (erro) {
        // Entre partições diferentes o `rename` não existe; copiar e apagar é
        // o que o `mv` faz por baixo.
        if ((erro as NodeJS.ErrnoException).code !== 'EXDEV') throw erro;
        fs.cpSync(de, para, { recursive: true });
        fs.rmSync(de, { recursive: true, force: true });
      }
    } else {
      fs.cpSync(de, para, { recursive: true });
    }
    res.json(ok({ path: para, movido: recortar }));
  }));

  /**
   * Abre a pasta no gerenciador de arquivos do sistema.
   *
   * O `Open Containing Folder` da captura dele. O servidor roda na máquina
   * dele, então não é preciso esperar o Electron para isto — mas é preciso o
   * `xdg-open`, e a tela de ferramentas diz quando ele falta.
   *
   * `spawn` solto e `unref`: o gerenciador de arquivos é um programa de vida
   * longa, e esperar por ele penduraria a requisição até ele ser fechado.
   */
  router.post('/workspace/reveal', wrap((req, res) => {
    const { alvo } = itemExistente(requireString(req.body?.path, 'path'));
    const pasta = fs.statSync(alvo).isDirectory() ? alvo : path.dirname(alvo);
    const abridor = acharNoPath(['xdg-open', 'gio', 'open']);
    if (abridor === null) {
      throw new Error(
        'O xdg-open não está nesta máquina — é ele que abre o gerenciador de ' +
          'arquivos.\n\nsudo apt install xdg-utils'
      );
    }
    const filho = spawn(abridor, abridor.endsWith('gio') ? ['open', pasta] : [pasta], {
      detached: true,
      stdio: 'ignore',
    });
    filho.unref();
    res.json(ok({ path: pasta }));
  }));

  return router;
}
