// As ações de pasta e projeto (spec 012).
//
// Mesmo corte dos outros arquivos daqui: os fluxos de um assunto, com as
// dependências vindas de fora, para o `App` caber no teto do Artigo IV.
import { Api } from '../api';
import { pedirComRetentativa, type QuickInputController } from '../useQuickInput';
import type { PastaAberta } from '../files/usePasta';
import type { EntradaMenu } from '../ContextMenu';
import type { FileNode } from '../api';

export interface PastaAcoesDeps {
  readonly qi: QuickInputController;
  readonly pasta: PastaAberta;
  avisar(mensagem: string, titulo?: string): Promise<void>;
  /** Abre o arquivo recém-criado — criar sem abrir seria meio caminho. */
  abrirArquivo(caminho: string): Promise<void>;
  /** Pergunta antes do que não tem volta (T043). */
  confirmar(o: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
  /** As abas seguem o disco: renomear leva junto, excluir fecha (T043). */
  aoRenomear(de: string, para: string): void;
  aoExcluir(caminho: string): void;
  /** Abre o menu de contexto nas coordenadas do cursor. */
  abrirMenu(e: React.MouseEvent, entradas: readonly EntradaMenu[]): void;
  copiar(texto: string): void;
}

export interface PastaAcoes {
  novoProjeto(): Promise<void>;
  /** Cria um arquivo na pasta aberta e o abre (spec 035). */
  novoArquivoNaPasta(): Promise<void>;
  novaPasta(): Promise<void>;
  escolherProjeto(): Promise<void>;
  abrirPasta(): Promise<void>;
  /** Soma outra pasta ao espaço de trabalho, sem fechar as abertas (T004). */
  acrescentarPasta(): Promise<void>;
  /** O menu de botão direito no cabeçalho de uma raiz (T004). */
  menuDaRaiz(pasta: string, e: React.MouseEvent): void;
  abrirRecente(): Promise<void>;
  // ---- o menu de botão direito da árvore (T043, T045) ----
  /** Cria um arquivo DENTRO da pasta escolhida, e o abre (T045). */
  novoArquivoEm(pastaDoItem: string): Promise<void>;
  novaPastaEm(pastaDoItem: string): Promise<void>;
  /** O menu de botão direito de um item da árvore (T043, T045). */
  menuDoItem(no: FileNode, e: React.MouseEvent): void;
  renomearItem(caminho: string): Promise<void>;
  duplicarItem(caminho: string): Promise<void>;
  excluirItem(caminho: string, ehPasta: boolean): Promise<void>;
}

export function usePastaAcoes(deps: PastaAcoesDeps): PastaAcoes {
  const { qi, pasta, avisar, abrirArquivo } = deps;

  const novoProjeto = async (): Promise<void> => {
    await pedirComRetentativa(
      qi,
      { titulo: 'Nome do projeto', placeholder: 'ex.: meu-projeto' },
      (nome: string) => pasta.criarProjeto(nome)
    );
  };

  const escolherProjeto = async (): Promise<void> => {
    const escolhido = await qi.pedir({
      titulo: 'Abrir workspace',
      placeholder: 'Escolha um projeto',
      opcoes: pasta.projetos.map((p) => ({
        valor: p.dir,
        rotulo: p.name,
        detalhe: p.dir,
        icone: 'folder',
      })),
    });
    if (escolhido !== null) await pasta.abrir(escolhido);
  };

  /**
   * Navegador de pastas servido pelo backend.
   *
   * O navegador nativo do sistema só existe no Electron, que está adiado por
   * gatilho — então a IDE lista as pastas e o usuário desce por elas. Cada
   * parada oferece **abrir esta pasta**, para não obrigar a descer mais um
   * nível só para confirmar.
   *
   * Sem componente novo: a entrada rápida em modo lista já tem seta, filtro,
   * Enter e Esc. O valor carrega o verbo (`abrir:` ou `ir:`), e o laço vive
   * aqui — a mesma forma de `pedirComRetentativa`.
   */
  const navegarAtePasta = async (titulo: string, verbo: string): Promise<string | null> => {
    let atual: string | undefined = pasta.pasta === '' ? undefined : pasta.pasta;
    for (;;) {
      const listagem = await Api.browseFolders(atual);
      const opcoes = [
        { valor: `abrir:${listagem.path}`, rotulo: verbo, detalhe: listagem.path, icone: 'lucide:check' },
        ...(listagem.parent === null
          ? []
          : [{ valor: `ir:${listagem.parent}`, rotulo: '..', detalhe: listagem.parent, icone: 'lucide:corner-left-up' }]),
        ...listagem.dirs.map((d) => ({ valor: `ir:${d.path}`, rotulo: d.name, icone: 'folder' })),
      ];

      const escolhido = await qi.pedir({ titulo, placeholder: listagem.path, opcoes });
      // Cancelar mantém a pasta anterior (AC-4).
      if (escolhido === null) return null;

      const [acao, ...resto] = escolhido.split(':');
      const alvo = resto.join(':');
      if (acao === 'abrir') return alvo;
      atual = alvo;
    }
  };

  const abrirPasta = async (): Promise<void> => {
    const escolhida = await navegarAtePasta('Abrir pasta', 'Abrir esta pasta');
    if (escolhida !== null) await pasta.abrir(escolhida);
  };

  /**
   * Soma outra pasta ao espaço de trabalho (T004).
   *
   * O mesmo navegador do `Open Folder…`, com outro verbo no fim — o gesto de
   * descer pelas pastas é idêntico, e ter duas telas para ele seria duas telas
   * para manter.
   */
  const acrescentarPasta = async (): Promise<void> => {
    const escolhida = await navegarAtePasta('Adicionar pasta ao espaço', 'Adicionar esta pasta');
    if (escolhida !== null) await pasta.acrescentar(escolhida);
  };

  /**
   * O menu de uma RAIZ (T004).
   *
   * `Remover do espaço` e não `Excluir`: a pasta continua no disco, e usar a
   * mesma palavra do menu de arquivo faria alguém achar que apagou o projeto.
   */
  const menuDaRaiz = (raiz: string, e: React.MouseEvent): void => {
    deps.abrirMenu(e, [
      { label: 'Novo arquivo aqui', onClick: () => novoArquivoEm(raiz) },
      { label: 'Nova pasta aqui', onClick: () => novaPastaEm(raiz) },
      null,
      { label: 'Copiar caminho', onClick: () => deps.copiar(raiz) },
      null,
      { label: 'Remover do espaço', onClick: () => pasta.remover(raiz) },
    ]);
  };

  /** Pastas recentes. A que não existe mais é informada e esquecida (AC-10). */
  const abrirRecente = async (): Promise<void> => {
    if (pasta.recentes.length === 0) {
      await avisar('Nenhuma pasta aberta ainda.', 'Open Recent');
      return;
    }
    const escolhido = await qi.pedir({
      titulo: 'Abrir pasta recente',
      placeholder: 'Escolha uma pasta',
      opcoes: pasta.recentes.map((caminho) => ({
        valor: caminho,
        rotulo: caminho.split('/').filter((p) => p !== '').pop() ?? caminho,
        detalhe: caminho,
        icone: 'folder',
      })),
    });
    if (escolhido === null) return;
    try {
      await pasta.abrir(escolhido);
    } catch (e) {
      await pasta.esquecer(escolhido);
      await avisar(
        `${(e as Error).message}\n\nEla foi removida da lista de recentes.`,
        'Pasta indisponível'
      );
    }
  };


  /**
   * Cria um arquivo na pasta aberta e o abre.
   *
   * Aceita caminho com barras (`src/util/novo.ts`): é o que o VS Code faz, e as
   * pastas do meio são criadas junto. Quem recusa nome repetido e caminho para
   * fora é o servidor — a retentativa mantém o que foi digitado.
   */
  const novoArquivoNaPasta = async (): Promise<void> => {
    const criado = await pedirComRetentativa(
      qi,
      { titulo: 'Nome do arquivo', placeholder: 'ex.: utils.ts, src/api/rotas.py' },
      (nome: string) => pasta.criarArquivo(nome, '')
    );
    if (criado === null) return;
    await abrirArquivo(criado);
  };

  const novaPasta = async (): Promise<void> => {
    await pedirComRetentativa(
      qi,
      { titulo: 'Nome da pasta', placeholder: 'ex.: componentes, src/api' },
      (nome: string) => pasta.criarPasta(nome)
    );
  };

  // -------------------------------------------------------------------------
  // O menu de botão direito da árvore (T043, T045)
  // -------------------------------------------------------------------------

  /** O caminho de um item RELATIVO à pasta aberta — é o que as rotas de criar pedem. */
  const relativo = (caminho: string): string =>
    caminho.startsWith(`${pasta.pasta}/`) ? caminho.slice(pasta.pasta.length + 1) : '';

  /**
   * Cria dentro da pasta escolhida (T045).
   *
   * A desculpa que eu tinha era que `Novo arquivo` no cabeçalho já resolvia —
   * e resolve, desde que você digite o caminho inteiro toda vez. O menu da
   * pasta poupa isso: o prefixo já vai posto, e o campo abre com ele.
   */
  const criarEm = async (
    pastaDoItem: string,
    titulo: string,
    gravar: (nome: string) => Promise<string>
  ): Promise<string | null> => {
    const prefixo = relativo(pastaDoItem);
    return pedirComRetentativa(
      qi,
      {
        titulo,
        placeholder: prefixo === '' ? 'ex.: utils.ts' : `dentro de ${prefixo}/`,
        // O prefixo entra COMO TEXTO no campo, e não como enfeite: assim ele
        // é visível, editável e chega ao servidor sem depender de o chamador
        // lembrar de recolocá-lo.
        valorInicial: prefixo === '' ? '' : `${prefixo}/`,
      },
      gravar
    );
  };

  const novoArquivoEm = async (pastaDoItem: string): Promise<void> => {
    const criado = await criarEm(pastaDoItem, 'Nome do arquivo', (nome) =>
      pasta.criarArquivo(nome, '')
    );
    if (criado !== null) await abrirArquivo(criado);
  };

  const novaPastaEm = async (pastaDoItem: string): Promise<void> => {
    await criarEm(pastaDoItem, 'Nome da pasta', (nome) => pasta.criarPasta(nome));
  };

  /**
   * Renomeia, e leva as abas abertas junto.
   *
   * O campo abre com o nome ATUAL — renomear costuma ser trocar uma letra, e
   * obrigar a redigitar o nome inteiro seria hostil.
   */
  const renomearItem = async (caminho: string): Promise<void> => {
    const atual = caminho.split('/').pop() ?? caminho;
    const novo = await pedirComRetentativa(
      qi,
      { titulo: 'Renomear', placeholder: atual, valorInicial: atual },
      (nome: string) => pasta.renomear(caminho, nome)
    );
    if (novo !== null && novo !== caminho) deps.aoRenomear(caminho, novo);
  };

  const duplicarItem = async (caminho: string): Promise<void> => {
    await pasta.duplicar(caminho);
  };

  /**
   * Exclui, depois de perguntar.
   *
   * A nota dele foi explícita: *"com F2 e Delete com confirmação"*. Não há
   * lixeira aqui — o que sai, sai —, então a caixa diz o nome e é destrutiva.
   */
  const excluirItem = async (caminho: string, ehPasta: boolean): Promise<void> => {
    const nome = caminho.split('/').pop() ?? caminho;
    const ok = await deps.confirmar({
      titulo: 'Excluir',
      mensagem: ehPasta
        ? `Excluir a pasta "${nome}" e tudo que há dentro dela?\n\nIsto não tem desfazer.`
        : `Excluir "${nome}"?\n\nIsto não tem desfazer.`,
      rotuloConfirmar: 'excluir',
      destrutivo: true,
    });
    if (!ok) return;
    await pasta.excluir(caminho);
    deps.aoExcluir(caminho);
  };

  /**
   * O menu de botão direito da árvore de arquivos (T043, T045).
   *
   * A ordem é a do VS Code, e não é enfeite: a mão já sabe onde `Renomear` e
   * `Excluir` ficam. `Excluir` fica sozinho no fim, atrás de um separador —
   * é o único que não tem volta.
   *
   * `Novo arquivo aqui` só aparece em PASTA (T045). Num arquivo ele existiria
   * como "ao lado deste", que é a mesma coisa que o botão do cabeçalho já faz,
   * e um item a mais para ler toda vez.
   */
  const menuDoItem = (no: FileNode, e: React.MouseEvent): void => {
    const pastaDoItem = no.type === 'dir' ? no.path : no.path.slice(0, no.path.lastIndexOf('/'));
    const relativo = no.path.startsWith(`${pasta.pasta}/`)
      ? no.path.slice(pasta.pasta.length + 1)
      : no.path;
    deps.abrirMenu(e, [
      ...(no.type === 'dir'
        ? [
            { label: 'Novo arquivo aqui', onClick: () => novoArquivoEm(pastaDoItem) },
            { label: 'Nova pasta aqui', onClick: () => novaPastaEm(pastaDoItem) },
            null,
          ]
        : []),
      { label: 'Renomear (F2)', onClick: () => renomearItem(no.path) },
      { label: 'Duplicar', onClick: () => duplicarItem(no.path) },
      null,
      { label: 'Copiar caminho', onClick: () => deps.copiar(no.path) },
      { label: 'Copiar caminho relativo', onClick: () => deps.copiar(relativo) },
      null,
      {
        label: 'Excluir (Delete)',
        danger: true,
        onClick: () => excluirItem(no.path, no.type === 'dir'),
      },
    ]);
  };

  return {
    novoProjeto, escolherProjeto, abrirPasta, acrescentarPasta, abrirRecente,
    novoArquivoNaPasta, novaPasta, novoArquivoEm, novaPastaEm, menuDoItem, menuDaRaiz,
    renomearItem, duplicarItem, excluirItem,
  };
}
