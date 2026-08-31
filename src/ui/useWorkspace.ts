// Orquestração de abas e editor.
//
// Há um editor só; trocar de aba salva o estado da anterior e carrega o da
// nova. Duas armadilhas desta lógica já custaram bugs na versão anterior e
// estão marcadas abaixo:
//
// 1. Salvar o estado chama `store.update`, que notifica de novo. Sem marcar a
//    aba corrente ANTES de salvar, a chamada reentrante não vê a guarda e
//    recursa até travar o navegador.
// 2. `null` significa "nenhuma aba". Usá-lo também para "aba fechada" faz a
//    guarda engolir o evento de fechar a última, e a barra de status fica presa
//    no arquivo anterior.
import { useCallback, useState } from 'react';
import type { Tab, TabStore } from '../shared/tabs';
import type { Lado, NoDeLayout } from '../shared/layout-editor';
import { useLayoutDeGrupos } from './editor/useLayoutDeGrupos';
import type { CargaDeArraste, Zona } from '../shared/arrastar';
import { proximoSemTitulo } from '../shared/untitled';
import { usePreview } from './editor/usePreview';
import { ICONE_DE_ARQUIVO, iconeDeArquivo } from '../shared/editor/arquivos';
import type { EditorHandle, ViewState } from './editor/EditorHost';
import { EXT_TO_LANG, NOME_TO_LANG } from '../shared/editor/languages';
import { montarAbaDeArquivo } from './editor/abaDeArquivo';
import { gravarSeRemota, idDaAbaRemota, lerParaAba } from './remoto/abaRemota';
import { soltarNoGrupoCom } from './tabs/soltura';
import { restaurarSessaoCom } from './tabs/restauracao';
import { Api } from './api';
import { useTabs } from './tabs/useTabs';
import { useAbasDeDados } from './tabs/useAbasDeDados';
import { useGruposDeEditor } from './editor/useGruposDeEditor';
import type { SessaoDeAbas } from '../shared/sessao-abas';
import { chaveDoModelo, gemeas, idBaseDe } from '../shared/abas-gemeas';
import { descartarModelo } from './editor/modelos';

export interface EditorTabMeta {
  /** Caminho no disco; `null` em aba de query, que não tem arquivo. */
  readonly path: string | null;
  readonly content: string;
  readonly language: string;
  readonly view: ViewState | null;
  readonly connectionId?: string;
}

const EDITAVEIS = new Set(['editor', 'sql']);

const ehEditavel = (aba: Tab | null): boolean => aba !== null && EDITAVEIS.has(aba.type);
const metaDe = (aba: Tab): EditorTabMeta => aba.meta as unknown as EditorTabMeta;

export function linguagemDe(caminho: string): string {
  const nome = (caminho.split('/').pop() ?? caminho).toLowerCase();
  // Nome inteiro primeiro: `Dockerfile` e `Makefile` não têm extensão, e o
  // `split('.')` neles devolveria o próprio nome como se fosse uma.
  const porNome = NOME_TO_LANG[nome];
  if (porNome !== undefined) return porNome;

  if (!nome.includes('.')) return 'plain';
  const ext = `.${nome.split('.').pop() ?? ''}`;
  return EXT_TO_LANG[ext] ?? 'plain';
}

/**
 * Ponteiro de leitura para o editor do grupo focado.
 *
 * Não é um `ref` do React: é um objeto com **getter**, que resolve na hora para
 * a instância certa. Foi o que permitiu a divisão da tela não vazar para os
 * quinze lugares que já escreviam `ws.editorRef.current?.getValue()` — eles
 * continuam iguais e passam a falar com o editor que está em foco.
 */
export interface PonteiroDeEditor {
  readonly current: EditorHandle | null;
}

export interface Workspace {
  readonly store: TabStore;
  readonly tabs: readonly Tab[];
  readonly activeId: string | null;
  readonly active: Tab | null;
  readonly grupos: readonly number[];
  readonly grupoFocado: number;
  /** O arranjo dos grupos na tela (spec 025). */
  readonly layout: NoDeLayout;
  /** Verdadeiro enquanto couber outro grupo. */
  readonly podeDividir: boolean;
  readonly editorRef: PonteiroDeEditor;
  /** Ref de callback para o `EditorHost` de um grupo se registrar. */
  registrarEditor(grupo: number): (handle: EditorHandle | null) => void;
  /** Manda a aba ativa para o outro grupo, criando-o se preciso. */
  /** Divide o grupo ativo para o lado pedido. `direita` é o padrão (T020). */
  dividir(lado?: Lado): void;
  /** Abre uma segunda vista do arquivo ativo num grupo novo (T028). */
  duplicar(lado?: Lado): void;
  /** Move a fronteira entre dois irmãos do arranjo (T021). */
  redimensionarLayout(caminho: readonly number[], indice: number, fracao: number): void;
  /**
   * Trata o que foi solto sobre um grupo.
   *
   * `centro` abre ali mesmo; qualquer outra zona cria um grupo naquele lado.
   */
  soltarNoGrupo(grupoAlvo: number, zona: Zona, carga: CargaDeArraste): void;
  /**
   * Uma aba foi solta na BARRA de um grupo, antes da aba dita (T029).
   *
   * Soltar na barra é um gesto diferente de soltar no editor: ali se escolhe um
   * lugar na fila, aqui se escolhe um lado da tela.
   */
  reordenarAba(grupo: number, id: string, antesDe: string | null): void;
  /** Abas mostrando o conteúdo renderizado em vez do texto. */
  readonly emPreview: ReadonlySet<string>;
  /** Alterna entre texto e renderizado na aba ativa. */
  alternarPreview(): void;
  /** O conteúdo atual de uma aba, já com o que não foi salvo. */
  conteudoDaAba(id: string): string;
  /**
   * A linguagem que a ABA declara.
   *
   * Existe porque perguntar ao Monaco era uma SEGUNDA fonte da mesma verdade, e
   * era a que chegava tarde: uma aba aberta já em preview (o diagrama ER, T064)
   * não tinha modelo montado ainda, e o switch `Markdown | Preview` não nascia.
   */
  readonly linguagemAtiva: string;
  focarGrupo(grupo: number): void;
  readonly cursor: { readonly linha: number; readonly coluna: number };
  /**
   * Contador de edições do usuário.
   *
   * É o sinal do Auto Save: um número que muda a cada tecla, sem carregar o
   * conteúdo junto. Usar o próprio texto como dependência refaria o efeito a
   * cada caractere com uma cópia do arquivo inteiro.
   */
  readonly edicoes: number;
  aoMoverCursor(linha: number, coluna: number): void;
  abrirArquivo(caminho: string): Promise<void>;
  /**
   * Abre um arquivo que mora NO SERVIDOR (spec 053).
   *
   * Não baixa para o disco. A ferramenta de referência copia para uma pasta
   * temporária e abre o arquivo local — solução de extensão, que precisa
   * entregar um caminho de disco ao editor do hospedeiro. Aqui a aba já guarda
   * o conteúdo, e `Ctrl+S` devolve pelo mesmo caminho por onde veio.
   */
  abrirArquivoRemoto(conexaoId: string, caminho: string): Promise<void>;
  /** Abre o arquivo e leva o cursor à linha e coluna dadas. */
  abrirArquivoEm(caminho: string, linha: number, coluna: number): Promise<void>;
  abrirQuery(
    id: string,
    titulo: string,
    conteudo: string,
    connectionId: string,
    database: string | null
  ): void;
  /** Abre texto solto numa aba, sem arquivo em disco por trás. */
  abrirTexto(id: string, titulo: string, conteudo: string, linguagem: string): void;
  /** Abre markdown já renderizado — o diagrama ER (T064). */
  abrirRenderizado(id: string, titulo: string, conteudo: string): void;
  abrirFormulario(connectionId: string | null, titulo: string, grupoInicial?: string): void;
  abrirTerminal(connectionId: string | null, titulo: string): void;
  /** A lista de processos de uma conexão (spec 047). */
  abrirProcessos(connectionId: string, titulo: string): void;
  /** A aba de um SERVIDOR, com as sub-abas que ele sabe oferecer (spec 055). */
  abrirServidor(connectionId: string, titulo: string): void;
  /**
   * A aba de uma TABELA (spec 041), com página, ordenação e filtros próprios.
   *
   * Distinta da aba de resultado: aquela mostra o que uma CONSULTA devolveu e
   * não sabe de tabela nenhuma. Paginar e contar só são possíveis sabendo qual
   * tabela é.
   */
  abrirTabela(
    connectionId: string,
    nodePath: readonly string[],
    titulo: string,
    database: string | null
  ): void;
  /** Aba sem título; sem argumentos é o `New Text File` do menu. */
  abrirSemTitulo(conteudo?: string, linguagem?: string): void;
  /**
   * A aba ativa do editor cujo modelo é esta URI (spec 038).
   *
   * O CodeLens dá a URI do modelo em que foi clicado; com a tela dividida, é o
   * que distingue "o Run da esquerda" do "Run da direita".
   */
  abaDaUri(uri: string): Tab | null;
  /** O caderno mudou: grava no `meta` e marca a aba (spec 048). */
  mudarCaderno(id: string, conteudo: string): void;
  /**
   * Fecha a aba de um arquivo pelo CAMINHO, sem perguntar nada.
   *
   * Nasce do apagar da categoria `Query` (spec 038, AC-29): a aba de um arquivo
   * que não existe mais não pode ficar aberta — o próximo `Ctrl+S` o recriaria.
   */
  fecharPorCaminho(caminho: string): void;
  adotarArquivo(idAntigo: string, caminho: string): void;
  /** Devolve o caminho gravado, ou `null` se não havia o que salvar. */
  salvar(): Promise<string | null>;
  /**
   * Grava todas as abas sujas que já têm arquivo.
   *
   * Devolve quantas gravou e quantas ficaram de fora por ainda não terem nome —
   * quem chama decide como contar isso ao usuário.
   */
  salvarTodas(): Promise<{ readonly gravadas: number; readonly semNome: number }>;
  /** Relê o arquivo do disco, jogando fora o que não foi salvo. */
  reverter(): Promise<void>;
  /** Relê do disco as abas abertas dos caminhos dados. */
  recarregarDoDisco(caminhos: readonly string[]): Promise<void>;
  /**
   * Reage a mudanças vindas do DISCO (spec 037).
   *
   * Diferente de `recarregarDoDisco`: a aba com trabalho não salvo **não** é
   * recarregada — ela entra em conflito, e quem decide é o usuário na hora de
   * salvar. Devolve os títulos das abas que ficaram em conflito.
   */
  sincronizarComDisco(caminhos: readonly string[]): Promise<readonly string[]>;
  /** Abas cujo arquivo mudou em disco desde que foram carregadas. */
  readonly conflitos: ReadonlySet<string>;
  limparConflito(id: string): void;
  /** Reabre as abas de uma sessão guardada. */
  restaurarSessao(sessao: SessaoDeAbas): Promise<void>;
  marcarAbaSuja(id: string, sujo: boolean): void;
  ativar(id: string): void;
  fechar(id: string): Promise<void>;
  marcarSujo(): void;
}

/** A confirmação vem de fora: `shared` e este gancho não desenham diálogo. */
export interface WorkspaceDeps {
  confirmar(opcoes: {
    titulo?: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
}

export function useWorkspace({ confirmar }: WorkspaceDeps): Workspace {
  const { store, tabs, activeId, active, grupos, grupoFocado } = useTabs();
  const [cursor, setCursor] = useState({ linha: 1, coluna: 1 });
  const [edicoes, setEdicoes] = useState(0);
  /**
   * Abas cujo arquivo mudou em disco por fora da IDE.
   *
   * Salvar por cima disso é a perda de trabalho que o vigia existe para evitar
   * — e a IDE não decide sozinha qual das duas versões vale.
   */
  const [conflitos, setConflitos] = useState<ReadonlySet<string>>(new Set());

  // Sem aba, a posição do cursor anterior é estado velho na barra de status.
  const aoEsvaziarFoco = useCallback(() => setCursor({ linha: 1, coluna: 1 }), []);

  /**
   * Tudo que sabe que existe mais de um editor mora aqui.
   *
   * Este gancho fala de ABAS; o de baixo, das INSTÂNCIAS que as mostram. A
   * separação saiu do teto de 800 linhas do Artigo IV, mas o corte já estava
   * escrito no backlog antes disso.
   */
  const ed = useGruposDeEditor({
    store, tabs, activeId, grupos, grupoFocado, aoEsvaziarFoco, ehEditavel, metaDe,
  });
  const { editorRef, registrarEditor, salvarNaAba, salvarGrupoFocado, salvarTodosOsGrupos } = ed;
  const { grupoDaUri } = ed;


  // O ARRANJO dos grupos mora em `editor/useLayoutDeGrupos.ts` — ver a nota lá.
  const { layout, definirLayout, dividir, duplicar, redimensionarLayout } = useLayoutDeGrupos({
    store, tabs, grupoFocado, salvarTodosOsGrupos,
  });

  const abrirArquivo = useCallback(
    async (caminho: string) => {
      const jaAberta = store.get(`file:${caminho}`);
      if (jaAberta !== null) {
        // Já aberta: foca, preservando edições não salvas.
        store.activate(jaAberta.id);
        return;
      }

      const { aba } = await montarAbaDeArquivo(caminho, Api.readFile, linguagemDe);
      // Salva a aba corrente antes de abrir a nova, senão o conteúdo se perde.
      salvarGrupoFocado();
      store.open(aba);
    },
    [salvarGrupoFocado, store]
  );

  const abrirArquivoRemoto = useCallback(
    async (conexaoId: string, caminho: string) => {
      const jaAberta = store.get(idDaAbaRemota(conexaoId, caminho));
      if (jaAberta !== null) {
        store.activate(jaAberta.id);
        return;
      }
      // Salva a aba corrente antes de abrir a nova, senão o conteúdo se perde.
      salvarGrupoFocado();
      store.open(await lerParaAba(conexaoId, caminho, linguagemDe, iconeDeArquivo));
    },
    [salvarGrupoFocado, store]
  );

  /**
   * Abre o arquivo e leva o cursor até a posição — venha ele de onde vier.
   *
   * O salto é pedido ANTES de abrir, e não depois: se a aba nasce agora, quem
   * o executa é o efeito de carregar; se ela já estava aberta e à vista, o
   * efeito não roda e o salto sai daqui mesmo.
   */
  const abrirArquivoEm = useCallback(
    async (caminho: string, linha: number, coluna: number) => {
      const id = `file:${caminho}`;
      ed.irAoCarregar(id, { linha, coluna });
      await abrirArquivo(caminho);

      const aba = store.get(id);
      if (aba === null) return;
      if (ed.abaCarregada(aba.grupo) !== id) return;
      const editor = ed.editorDoGrupo(aba.grupo);
      if (editor === null) return;
      editor.goToPosition(linha, coluna);
    },
    [abrirArquivo, ed, store]
  );

  // As abas que NÃO são arquivo — query, texto, tabela, formulário, terminal.
  // Saíram daqui quando o portão do Artigo IV pegou este arquivo em 824 linhas,
  // e o corte é o que o backlog já apontava: elas não têm caminho, não são
  // salvas com Ctrl+S e não interessam ao vigia de disco. Ver `useAbasDeDados`.
  const dados = useAbasDeDados(store, salvarGrupoFocado);

  /**
   * Abre uma aba sem título, com o conteúdo e a linguagem dados.
   *
   * Nasce suja porque conteúdo que não está em disco é exatamente o que a marca
   * de não salvo significa.
   *
   * O `JSON` do CodeLens de SQL (spec 038) usa a forma com conteúdo: o
   * resultado como texto é algo para LER e copiar, não uma grade, e uma aba sem
   * título é o lugar do que ainda não decidiu se vira arquivo.
   */
  /**
   * Grava o conteúdo do caderno no `meta` e marca a aba como não salva.
   *
   * Ao contrário do editor, o caderno atualiza o `meta` a CADA tecla: ele não
   * tem uma instância imperativa de onde ler na hora de salvar.
   */
  const mudarCaderno = useCallback(
    (id: string, conteudo: string) => {
      const aba = store.get(id);
      if (aba === null) return;
      store.update(id, { meta: { ...aba.meta, content: conteudo }, dirty: true });
    },
    [store]
  );

  const abrirSemTitulo = useCallback(
    (conteudo = '', linguagem = 'plain') => {
      salvarGrupoFocado();
      const titulo = proximoSemTitulo(store.list().map((t) => t.title));
      store.open({
        id: `untitled:${titulo}`,
        type: 'editor',
        title: titulo,
        dirty: true,
        icon: ICONE_DE_ARQUIVO,
        meta: { path: null, content: conteudo, language: linguagem, view: null },
      });
    },
    [salvarGrupoFocado, store]
  );

  /**
   * Joga fora o modelo de texto que ficou sem nenhuma vista (T028).
   *
   * O modelo morre com a ÚLTIMA vista, e não com a primeira: descartá-lo com a
   * gêmea aberta apagaria o texto do outro grupo. E deixá-lo vivo depois da
   * última é pior que vazamento — reabrir o arquivo mostraria o modelo velho em
   * vez do que está em disco.
   */
  const descartarSeOrfao = useCallback(
    (chave: string) => {
      const usado = store
        .list()
        .some((t) => chaveDoModelo(t.id, metaDe(t).path ?? null) === chave);
      if (!usado) descartarModelo(chave);
    },
    [store]
  );

  const fechar = useCallback(
    async (id: string) => {
      const aba = store.get(id);
      // A gêmea que fica segura o texto (T028): fechar uma das duas vistas não
      // perde nada, então perguntar "fechar sem salvar?" seria alarme falso.
      const outraVista = aba !== null && gemeas(store.list().map((t) => t.id), id).length > 1;
      if (aba !== null && aba.dirty && !outraVista) {
        const ok = await confirmar({
          titulo: 'Alterações não salvas',
          mensagem: `"${aba.title}" tem alterações não salvas.\n\nFechar mesmo assim?`,
          rotuloConfirmar: 'fechar sem salvar',
          destrutivo: true,
        });
        if (!ok) return;
      }
      // (2) NÃO zera `ultimaAtiva` aqui — ver o comentário do topo.
      store.close(id);

      if (aba !== null) descartarSeOrfao(chaveDoModelo(aba.id, metaDe(aba).path));
    },
    [confirmar, descartarSeOrfao, store]
  );

  /**
   * Marca uma aba e as gêmeas dela (T028).
   *
   * O mesmo arquivo em dois grupos divide o texto, então tem de dividir também
   * a marca de "não salvo": deixar uma limpa faria o F5 perguntar por uma e não
   * pela outra, e fechar a limpa não avisaria nada.
   */
  const marcarComGemeas = useCallback(
    (id: string, sujo: boolean) => {
      for (const outro of gemeas(store.list().map((t) => t.id), id)) {
        if (store.get(outro)?.dirty !== sujo) store.update(outro, { dirty: sujo });
      }
    },
    [store]
  );

  const marcarSujo = useCallback(() => {
    if (ed.estaCarregando()) return; // troca de aba não é edição do usuário
    const id = ed.abaCarregadaEmFoco();
    if (id === null) return;
    setEdicoes((n) => n + 1);
    marcarComGemeas(id, true);
  }, [ed, marcarComGemeas]);

  /**
   * Grava a aba ativa e devolve o caminho.
   *
   * Devolve `null` quando não há arquivo conhecido — aba sem título ou aba de
   * query. Quem chama decide o que fazer: no caso do sem-título, pedir o nome.
   * Este gancho não pergunta nada, para continuar sem depender de interface.
   */
  const salvar = useCallback(async (): Promise<string | null> => {
    const aba = active;
    if (aba === null) return null;
    const meta = metaDe(aba);

    // Arquivo do servidor (spec 053): vai de volta por onde veio. Vem ANTES da
    // guarda de `path`, que é nulo aqui — o arquivo não existe em disco.
    const remoto = await gravarSeRemota(
      aba,
      ehEditavel(aba) ? editorRef.current : null,
      meta.content
    );
    if (remoto !== null) {
      marcarComGemeas(aba.id, false);
      return remoto;
    }

    if (meta.path === null) return null;

    // O caderno (spec 048) não tem editor do Monaco: o conteúdo dele já mora no
    // `meta`, atualizado a cada tecla pelos blocos. Os demais leem do editor,
    // porque o `meta` só é atualizado ao trocar de aba — salvar dali gravaria a
    // versão de antes da última tecla.
    if (aba.type === 'caderno') {
      await Api.saveFile(meta.path, meta.content);
      store.update(aba.id, { dirty: false });
      return meta.path;
    }


    const editor = editorRef.current;
    if (editor === null || !ehEditavel(aba)) return null;
    await Api.saveFile(meta.path, editor.getValue());
    marcarComGemeas(aba.id, false);
    return meta.path;
  }, [active, marcarComGemeas, store]);

  /**
   * Grava tudo que está sujo e tem para onde ir.
   *
   * O conteúdo da aba ATIVA vem do editor, não do estado da aba: o estado só é
   * atualizado ao trocar de aba, então salvar a partir dele gravaria a versão
   * de antes da última tecla (AC-2).
   */
  const salvarTodas = useCallback(async (): Promise<{ gravadas: number; semNome: number }> => {
    // Todos os grupos, não só o focado: "Save All" com a tela dividida tem que
    // gravar os dois lados.
    salvarTodosOsGrupos();

    // Uma gravação por ARQUIVO, e não por vista: com o mesmo arquivo aberto
    // dos dois lados, as duas abas estão sujas e gravá-lo duas vezes contaria
    // dois em "3 arquivos salvos".
    const vistos = new Set<string>();
    const sujas = store
      .list()
      .filter((aba) => aba.dirty && ehEditavel(aba))
      .filter((aba) => {
        const base = idBaseDe(aba.id);
        if (vistos.has(base)) return false;
        vistos.add(base);
        return true;
      });
    let gravadas = 0;
    let semNome = 0;

    for (const aba of sujas) {
      const meta = metaDe(aba);
      if (meta.path === null) {
        semNome += 1;
        continue;
      }
      await Api.saveFile(meta.path, meta.content);
      marcarComGemeas(aba.id, false);
      gravadas += 1;
    }
    return { gravadas, semNome };
  }, [marcarComGemeas, salvarTodosOsGrupos, store]);

  /**
   * Abre um arquivo num grupo específico.
   *
   * Arquivo já aberto é MOVIDO, e não duplicado: arrastar da árvore algo que já
   * está numa aba significa "quero ele aqui", não "quero dois dele".
   */
  const abrirNoGrupo = useCallback(
    async (caminho: string, grupo: number): Promise<void> => {
      const jaAberta = store.get(`file:${caminho}`);
      if (jaAberta !== null) {
        store.mover(jaAberta.id, grupo);
        store.activate(jaAberta.id);
        return;
      }
      store.focarGrupo(grupo);
      await abrirArquivo(caminho);
    },
    [abrirArquivo, store]
  );

  /**
   * Reabre as abas de uma sessão guardada (spec 029).
   *
   * O como mora em `tabs/restauracao.ts` desde o T028, quando este arquivo
   * bateu de novo no teto do Artigo IV.
   */
  const restaurarSessao = useCallback(
    (sessao: SessaoDeAbas): Promise<void> =>
      restaurarSessaoCom({
        store,
        abrirArquivo,
        caminhoDaAba: (aba) => (ehEditavel(aba) ? metaDe(aba).path : null),
        setLayout: definirLayout,
      })(sessao),
    [abrirArquivo, definirLayout, store]
  );

  // Onde uma aba cai ao ser solta. Mora em `tabs/soltura.ts` desde a spec 053,
  // quando este arquivo bateu no teto do Artigo IV.
  const soltarNoGrupo = useCallback(
    (grupoAlvo: number, zona: Zona, carga: CargaDeArraste): void =>
      soltarNoGrupoCom({
        mover: store.mover,
        abrirNoGrupo,
        salvarTodosOsGrupos,
        setLayout: definirLayout,
      })(grupoAlvo, zona, carga),
    [abrirNoGrupo, salvarTodosOsGrupos, store]
  );

  const reordenarAba = useCallback(
    (grupo: number, id: string, antesDe: string | null): void => {
      // Grava os editores antes: se a aba muda de grupo, o outro lado passa a
      // mostrar outro arquivo, e o que estava na tela precisa já estar no store.
      salvarTodosOsGrupos();
      store.reordenar(id, grupo, antesDe);
    },
    [salvarTodosOsGrupos, store]
  );

  /**
   * Alterna a aba ativa entre o texto e o conteúdo renderizado.
   *
   * Salva o editor no store ANTES de trocar: o preview precisa mostrar o que
   * está na tela, inclusive o que ainda não foi gravado em disco. Sem isso, o
   * botão mostraria a versão de antes da última tecla.
   */
  // O preview mora em `editor/usePreview.ts` — ver a nota lá.
  const { emPreview, alternarPreview, abrirRenderizado } = usePreview({
    abrirTexto: dados.abrirTexto,
    idAtivo: store.activeId,
    salvarGrupoFocado,
  });

  const linguagemAtiva = active === null ? '' : metaDe(active).language;

  const conteudoDaAba = useCallback(
    (id: string): string => {
      const aba = store.get(id);
      return aba === null ? '' : metaDe(aba).content;
    },
    [store]
  );

  const reverter = useCallback(async (): Promise<void> => {
    const aba = active;
    const editor = editorRef.current;
    if (aba === null || editor === null || !ehEditavel(aba)) {
      throw new Error('Não há arquivo aberto para reverter.');
    }
    const meta = metaDe(aba);
    if (meta.path === null) {
      throw new Error('Esta aba ainda não foi salva — não há versão em disco para voltar.');
    }

    const dados = await Api.readFile(meta.path);
    ed.semSujar(() => editor.setValue(dados.content));
    store.update(aba.id, { dirty: false, meta: { ...meta, content: dados.content, view: null } });
  }, [active, ed, store]);

  /**
   * Relê do disco as abas abertas dos caminhos dados.
   *
   * Substituir em arquivos reescreve o disco POR BAIXO do editor. Sem isto a
   * aba aberta segue mostrando o texto de antes — e salvá-la depois desfaz a
   * substituição em silêncio, que é o pior desfecho possível: o usuário viu
   * "3 arquivos alterados" e o arquivo voltou ao que era.
   */
  const recarregarDoDisco = useCallback(
    async (caminhos: readonly string[]): Promise<void> => {
      for (const caminho of caminhos) {
        const aba = store.get(`file:${caminho}`);
        if (aba === null || !ehEditavel(aba)) continue;

        const dados = await Api.readFile(caminho);
        store.update(aba.id, {
          dirty: false,
          meta: { ...metaDe(aba), content: dados.content, view: null },
        });

        // O efeito de carregar não vai reagir: para ele esta aba já é a ativa
        // do grupo. Quem está na tela precisa ser trocado aqui.
        if (store.ativaDoGrupo(aba.grupo) !== aba.id) continue;
        const editor = ed.editorDoGrupo(aba.grupo);
        if (editor === null) continue;
        ed.semSujar(() => editor.setValue(dados.content));
      }
    },
    [ed, store]
  );

  const sincronizarComDisco = useCallback(
    async (caminhos: readonly string[]): Promise<readonly string[]> => {
      const emConflito: string[] = [];
      const limpos: string[] = [];

      for (const caminho of caminhos) {
        const aba = store.get(`file:${caminho}`);
        if (aba === null || !ehEditavel(aba)) continue;
        if (aba.dirty) emConflito.push(aba.title);
        else limpos.push(caminho);
      }

      if (emConflito.length > 0) {
        setConflitos((atual) => {
          const proximo = new Set(atual);
          for (const caminho of caminhos) {
            const aba = store.get(`file:${caminho}`);
            if (aba !== null && aba.dirty) proximo.add(aba.id);
          }
          return proximo;
        });
      }
      // A aba sem alteração pode ser trocada sem perguntar nada: não há duas
      // versões, há uma só, e ela está no disco.
      if (limpos.length > 0) await recarregarDoDisco(limpos);
      return emConflito;
    },
    [recarregarDoDisco, store]
  );

  /**
   * Liga a aba sem título ao arquivo recém-criado.
   *
   * Troca o id junto com o caminho: o id `untitled:...` deixaria a aba
   * invisível para `abrirArquivo`, que procura por `file:<caminho>` — e abrir o
   * mesmo arquivo pela árvore criaria uma segunda aba do mesmo conteúdo.
   *
   * **A primeira linha é o conserto de um defeito que apagava o trabalho na
   * tela.** O `content` do `meta` só é atualizado ao trocar de aba, e uma aba
   * sem título nunca foi trocada — então ele estava vazio. A aba nova nascia com
   * conteúdo vazio, o efeito carregava esse vazio no editor, e o texto sumia da
   * tela logo depois de ser salvo. Em disco o arquivo ficava certo, o que tornava
   * o defeito ainda mais confuso: parecia que salvar tinha apagado tudo.
   */
  const adotarArquivo = useCallback(
    (idAntigo: string, caminho: string) => {
      const abaOriginal = store.get(idAntigo);
      if (abaOriginal === null) return;
      salvarNaAba(idAntigo, abaOriginal.grupo);

      const aba = store.get(idAntigo);
      if (aba === null) return;
      const language = linguagemDe(caminho);
      store.close(idAntigo);
      // A aba sem título deixa de existir, e o modelo dela junto: o texto passa
      // a viver no modelo do ARQUIVO, com a chave nova.
      descartarSeOrfao(chaveDoModelo(idAntigo, null));
      store.open({
        id: `file:${caminho}`,
        type: language === 'sql' ? 'sql' : 'editor',
        title: caminho.split('/').pop() ?? caminho,
        icon: iconeDeArquivo(caminho, language),
        dirty: false,
        grupo: aba.grupo,
        meta: { ...metaDe(aba), path: caminho, language },
      });
      editorRef.current?.setLanguage(language);
    },
    [descartarSeOrfao, salvarNaAba, store]
  );

  return {
    store,
    tabs,
    activeId,
    active,
    grupos,
    grupoFocado,
    layout,
    podeDividir: true,
    soltarNoGrupo,
    reordenarAba,
    editorRef,
    registrarEditor,
    dividir,
    duplicar,
    redimensionarLayout,
    emPreview,
    alternarPreview,
    conteudoDaAba,
    focarGrupo: (grupo: number) => store.focarGrupo(grupo),
    cursor,
    edicoes,
    abrirArquivo,
    abrirArquivoRemoto,
    abrirArquivoEm,
    abrirQuery: dados.abrirQuery,
    abrirTexto: dados.abrirTexto,
    abrirRenderizado,
    linguagemAtiva,
    abrirFormulario: dados.abrirFormulario,
    abrirTerminal: dados.abrirTerminal,
    abrirProcessos: dados.abrirProcessos,
    abrirServidor: dados.abrirServidor,
    abrirTabela: dados.abrirTabela,
    abrirSemTitulo,
    mudarCaderno,
    fecharPorCaminho: (caminho: string) => {
      for (const aba of store.list()) {
        const meta = aba.meta as { path?: string | null };
        // `store.close` e não `fechar`: `fechar` pergunta sobre alteração não
        // salva, e não há o que salvar num arquivo que acabou de ser apagado.
        if (meta.path === caminho) store.close(aba.id);
      }
      // Arquivo apagado do disco: o modelo tem de ir junto, senão recriá-lo lá
      // fora e abrir de novo mostraria o texto de antes.
      descartarSeOrfao(chaveDoModelo('', caminho));
    },
    abaDaUri: (uri: string) => {
      const grupo = grupoDaUri(uri);
      if (grupo === null) return null;
      const id = store.ativaDoGrupo(grupo);
      return id === null ? null : store.get(id);
    },
    adotarArquivo,
    // Uma função só: `marcarComGemeas` faz o mesmo quando não há gêmea.
    marcarAbaSuja: marcarComGemeas,
    ativar: (id) => store.activate(id),
    fechar,
    marcarSujo,
    salvar,
    salvarTodas,
    reverter,
    recarregarDoDisco,
    sincronizarComDisco,
    conflitos,
    limparConflito: (id: string) =>
      setConflitos((atual) => {
        if (!atual.has(id)) return atual;
        const proximo = new Set(atual);
        proximo.delete(id);
        return proximo;
      }),
    restaurarSessao,
    aoMoverCursor: (linha, coluna) => setCursor({ linha, coluna }),
  };
}
