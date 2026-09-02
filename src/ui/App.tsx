// Esqueleto da interface: a moldura que os painéis preenchem.
//
// Estrutura: barra de menu, lateral, divisória, área de editor com abas e saída,
// barra de status.
//
// É aqui que o registro de comandos ganha corpo: `ACOES` liga cada id declarado
// em `shared/commands.ts` à função que o executa, e `contexto` diz o que está
// disponível agora. Menu, paleta e atalhos leem essa mesma dupla — por isso um
// comando novo entra numa linha e aparece nos três lugares.
import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { aplicarVariaveis, criarTema } from './theme';
import { paletaDe } from '../shared/temas';
import { useFormatacaoAcoes } from './acoes/useFormatacaoAcoes';
import { useSaidaAcoes } from './acoes/useSaidaAcoes';
import { PainelDeCodeSnap } from './editor/PainelDeCodeSnap';
import { acaoDeMenuDaFoto, useFotoDoTrecho } from './editor/useFotoDoTrecho';
import { contextoDeComandos } from './acoes/useContextoDeComandos';
import { TelaDeRequisitos } from './ajuda/TelaDeRequisitos';
import { useTemaAtual } from './useTemaAtual';
import { temPreview } from '../shared/markdown';
import { Sidebar } from './Sidebar';
import { Resizer } from './Resizer';
import { useSidebarWidth } from './useSidebarWidth';
import { useWorkspace } from './useWorkspace';
import { EditorGroup } from './EditorGroup';
import { EditorGrid } from './EditorGrid';
import { ACAO_DO_MONACO } from '../shared/editor/acoes-monaco';
import type { PublicConnection } from '../shared/contracts';
import { useConnections } from './connections/useConnections';
import { VaultDialog } from './connections/VaultDialog';
import { ConnectionForm } from './connections/ConnectionForm';
import { TerminalHost } from './terminal/TerminalHost';
import { BarraDoTerminal } from './terminal/BarraDoTerminal';
import { TERMINAL_LOCAL } from '../shared/terminal/chaves';
import type { AparenciaDoTerminal } from '../shared/terminal/aparencia';

/**
 * O "herda tudo" compartilhado.
 *
 * Constante, e não `{}` na chamada: um objeto literal novo a cada renderização
 * faria o efeito do emulador disparar sempre, e ele remede e avisa o PTY.
 */
const VAZIA: AparenciaDoTerminal = {};
import { useContextMenu } from './ContextMenu';
import { useDialogs } from './useDialogs';
import { useCodebase } from './sql/useCodebase';
import { MenuBar } from './MenuBar';
import { StatusBar } from './StatusBar';
import { QuickInput } from './QuickInput';
import { useQuickInput } from './useQuickInput';
import { comandoDoAtalho, filtrarComandos, formatarAtalho } from '../shared/commands';
import { BottomPanel } from './BottomPanel';
import { ResizerHorizontal } from './ResizerHorizontal';
import { useLayout, ALTURA_PADRAO_PAINEL } from './useLayout';
import { usePersistido } from './usePersistido';
import { useProblemas } from './useProblemas';
import {
  abrirTerminal as abrirNoPainel, ativarTerminal, dividirTerminal, fecharTerminal,
  normalizarTerminais, orientacaoDoPar, paneisVisiveis, SEM_TERMINAIS,
} from '../shared/terminais';
import { useExecution } from './useExecution';
import { propsDaAbaDeTabela } from './tabela/propsDaAbaDeTabela';
import { useMenusDeConexao } from './acoes/useMenusDeConexao';
import { useVinculo } from './query/useVinculo';
import { ligarCodeLensDeSql, propsDeVinculo, useAcoesDeQuery } from './query/useAcoesDeQuery';
import { useAcoesRemotas } from './acoes/useAcoesRemotas';
import { depsDasAcoesRemotas } from './acoes/depsDasAcoesRemotas';
import { mapaDeAcoes } from './acoes/mapaDeAcoes';
import { Api } from './api';
import { usePasta } from './files/usePasta';
import { useRecentesDeArquivo } from './files/useRecentesDeArquivo';
import { usePrefs } from './usePrefs';
import { useAutoSave } from './useAutoSave';
import { useSessaoDeAbas } from './useSessaoDeAbas';
import { useVigia } from './useVigia';
import { useHistorico } from './useHistorico';
import { useSaltos } from './acoes/useSaltos';
import { TelaDePreferencias } from './prefs/TelaDePreferencias';
import { useSnippets } from './useSnippets';
import { useBusca } from './files/useBusca';
import { useComandosAcoes } from './acoes/useComandosAcoes';
import { useArquivoAcoes } from './acoes/useArquivoAcoes';
import { useCodigoAcoes } from './acoes/useCodigoAcoes';
import { usePastaAcoes } from './acoes/usePastaAcoes';
import { useAberturas } from './acoes/useAberturas';
import { useConexoesAcoes } from './acoes/useConexoesAcoes';
import { useStatusAcoes } from './acoes/useStatusAcoes';
import { useSnippetsAcoes } from './acoes/useSnippetsAcoes';

export function App() {
  const lateral = useSidebarWidth();
  const dialogs = useDialogs();
  const problemas = useProblemas();

  /**
   * Mostra o erro E o guarda em `Problems`.
   *
   * Declarado antes dos demais ganchos porque vários os recebem. O diálogo
   * continua sendo o susto do momento; a lista é o que sobra depois — que era
   * exatamente o que faltava, já que o painel se chamava "saída" e não recebia
   * nada além do runner.
   */
  const falhou = (origem: 'conexão' | 'ide' | 'execução') => (erro: unknown): void => {
    problemas.registrar(origem, erro);
    dialogs.aoFalhar(erro);
  };
  const falhaDeConexao = falhou('conexão');
  const falhaDaIde = falhou('ide');

  const ws = useWorkspace({
    confirmar: dialogs.confirmar,
    // A lista de recentes do `Ctrl+P` (T051). Aqui, e não em cada chamador:
    // árvore, busca, símbolos e o próprio `Ctrl+P` abrem todos por `abrirArquivo`.
    aoAbrirArquivo: (caminho) => recentesDeArquivo.registrar(caminho),
  });
  /**
   * O snippet que a barra do painel mandou, por pane (T087).
   *
   * Por pane, e não um só: com quatro terminais lado a lado, um estado
   * compartilhado mandaria o comando para todos ao mesmo tempo.
   */
  const [comandosDoPainel, setComandosDoPainel] = useState<
    ReadonlyMap<string, { readonly id: number; readonly texto: string }>
  >(new Map());
  /** A aparência de cada pane do painel (T086). Vazia = herda tudo. */
  const [aparenciasDoPainel, setAparenciasDoPainel] = useState<
    ReadonlyMap<string, AparenciaDoTerminal>
  >(new Map());
  const conexoes = useConnections({ confirmar: dialogs.confirmar });
  const menu = useContextMenu(falhaDaIde);
  const pasta = usePasta();
  const recentesDeArquivo = useRecentesDeArquivo(pasta.pasta);
  const qi = useQuickInput();
  // O vínculo precisa existir ANTES da execução: é ele que diz contra quem cada
  // arquivo roda (spec 038).
  const vinculos = useVinculo({
    qi,
    conexoes: () => conexoes.todasAsConexoes(),
    garantirDestrancado: conexoes.garantirDestrancado,
  });
  const exec = useExecution(
    ws,
    (mensagem) => problemas.registrar('execução', mensagem),
    vinculos
  );
  const prefs = usePrefs(falhaDaIde);
  // T013: seguindo o sistema, quem manda é ele — dentro dos dois temas que ele
  // mesmo declarou. Ver `useTemaAtual`.
  const tema = useTemaAtual(prefs.prefs);
  // As variáveis CSS precisam existir ANTES da primeira pintura: escrevê-las
  // num `useEffect` deixaria o primeiro quadro sem cor nenhuma.
  aplicarVariaveis(paletaDe(tema));
  const temaMui = useMemo(() => criarTema(tema), [tema]);

  const layout = useLayout();
  const nav = useHistorico({
    // Aba viva, ou aba fechada de um arquivo que ainda dá para reabrir (T011).
    alcancavel: (posicao) =>
      ws.store.get(posicao.abaId) !== null || posicao.caminho !== undefined,
  });
  const snippets = useSnippets(falhaDaIde);
  const busca = useBusca(falhaDaIde, ws.recarregarDoDisco);
  useAutoSave({ ws, prefs: prefs.prefs, aoFalhar: falhaDaIde });
  // As abas do editor voltam depois do F5, como os terminais do painel (spec 030).
  useSessaoDeAbas({ ws, pasta: pasta.pasta, aoFalhar: falhaDaIde });
  // O disco mudando por fora da IDE deixa de passar despercebido (spec 037).
  useVigia({
    ws,
    pasta,
    aoAvisar: (mensagem) => problemas.registrar('ide', mensagem),
    aoFalhar: falhaDaIde,
  });
  // Terminais de SHELL, que desde a decisão D6 moram no painel inferior. O de
  // conexão continua sendo aba do editor — saída longa de query merece tela
  // cheia, comando curto de shell não.
  // Persistido: os ids precisam sobreviver ao F5 para o servidor reatar as
  // sessões. É o que faz recarregar a página não matar o terminal (spec 023).
  const [terminais, setTerminais] = usePersistido('terminais', SEM_TERMINAIS, normalizarTerminais);
  // O comando que cada terminal recém-aberto deve rodar. Fica fora do store de
  // terminais porque é de uso único — some assim que o shell o recebe.
  const [comandosIniciais, setComandosIniciais] = useState<ReadonlyMap<string, string>>(new Map());
  const [painelLateral, setPainelLateral] = useState('files');
  const [linguagem, setLinguagem] = useState('javascript');

  // O seletor de tipo acompanha a aba ativa.
  useEffect(() => {
    const atual = ws.editorRef.current?.getLanguage();
    if (atual !== undefined) setLinguagem(atual);
  }, [ws.activeId, ws.editorRef]);


  const trocarLinguagem = (lang: string): void => {
    ws.editorRef.current?.setLanguage(lang);
    setLinguagem(lang);
  };

  const executar = (modo: 'file' | 'block'): void => {
    // Trazer o painel à frente é metade da utilidade: rodar e não ver a saída
    // porque o painel estava escondido seria pior que não ter o botão.
    layout.mostrarPainel('output');
    void exec.executar(modo, linguagem).catch(falhou('execução'));
  };


  /**
   * Cria um arquivo sem título. Não pergunta nada — o nome vem no salvar.
   *
   * É o defeito que motivou esta spec: exigir a extensão antes da primeira
   * linha obriga a decidir a linguagem antes de saber o que se vai escrever.
   */
  const novoArquivo = (): void => {
    ws.abrirSemTitulo();
  };

  const copiar = (texto: string): void => {
    void navigator.clipboard?.writeText(texto);
  };

  const { irPara, irParaSimbolo, saltoDe } = useSaltos({
    ws, nav, avisar: (p) => avisar(p), onErro: falhaDaIde,
  });

  const arquivoAcoes = useArquivoAcoes({
    qi, ws, pasta, prefs, avisar: dialogs.avisar, confirmar: dialogs.confirmar,
  });
  const codigoAcoes = useCodigoAcoes({ qi, ws, avisar: dialogs.avisar });
  const pastaAcoes = usePastaAcoes({
    qi, pasta, avisar: dialogs.avisar, abrirArquivo: ws.abrirArquivo,
    confirmar: dialogs.confirmar,
    // As abas seguem o disco (T043): renomear as leva junto, excluir as fecha.
    aoRenomear: ws.renomearPorCaminho,
    aoExcluir: ws.fecharPorCaminho,
    abrirMenu: menu.abrir,
    copiar,
    // O terminal ganha o `cd` como comando inicial, que é o mesmo caminho que
    // as tarefas do `tasks.json` usam para o `options.cwd` (spec 076).
    abrirTerminalEm: (destino) => novoTerminalNoPainel(`cd ${JSON.stringify(destino)}`),
    // O `Incluir` da busca fala em glob relativo à raiz; a raiz inteira vira
    // string vazia, que é "tudo" — e é o que ela já fazia.
    buscarNaPasta: (destino) => {
      const dentro = destino === pasta.pasta ? '' : destino.replace(`${pasta.pasta}/`, '');
      busca.definirIncluir(dentro === '' ? '' : `${dentro}/**`);
      setPainelLateral('search');
    },
    recarregar: () => void pasta.recarregar().catch(falhaDaIde),
  });
  /** O caminho do arquivo em foco — a chave do vínculo e do painel de símbolos. */
  const caminhoAtivo =
    (ws.active?.meta as { path?: string | null } | undefined)?.path ?? null;

  useCodebase(vinculos.vinculoDe(caminhoAtivo)); // autocomplete de SQL (T053)

  const conexoesAcoes = useConexoesAcoes({
    qi,
    ws,
    exec,
    conexoes,
    vinculos,
    confirmar: dialogs.confirmar,
  });

  const acoesDeQuery = useAcoesDeQuery(ws, conexoesAcoes);


  /**
   * O que a ABA DE TABELA precisa, num objeto só.
   *
   * Extraído do JSX quando o portão do Artigo IV pegou o `App` em 806 linhas:
   * são sete props que só a aba de tabela usa, e passá-las inline fazia o
   * `EditorGroup` parecer ter dezenove responsabilidades em vez de duas.
   */
  const propsDeTabela = propsDaAbaDeTabela({
    ws, dialogs, qi, conexoes, exec, vinculos, onErro: falhaDeConexao,
    mostrarSaida: () => layout.mostrarPainel('output'),
  });


  const { abrirPreferencias, abrirPorCaminho, irParaArquivo, escolherTema } = useAberturas({
    qi,
    abrirArquivo: ws.abrirArquivo,
    tema,
    definirTema: (nome) => prefs.definir({ 'workbench.theme': nome }),
    pasta: pasta.pasta,
    recentes: recentesDeArquivo.lista,
    avisar: dialogs.avisar,
  });

  const { escolherLinguagem, irParaLinha } = useStatusAcoes({
    qi,
    ws,
    trocarLinguagem,
    registrarSalto: (posicao) => nav.registrarSalto(saltoDe(posicao.abaId, posicao.linha)),
  });

  /** Leva a uma posição do histórico: ativa a aba e pula para a linha. */

  const abrirPaleta = async (): Promise<void> => {
    const escolhido = await qi.pedir({
      placeholder: 'Digite um comando',
      opcoes: filtrarComandos('', contexto).map((c) => ({
        valor: c.id,
        rotulo: c.label,
        sufixo: c.keybinding,
      })),
    });
    if (escolhido !== null) executarComando(escolhido);
  };


  // As ações da árvore remota (spec 053). Vêm antes dos menus porque eles as
  // consomem: o menu de um nó remoto é inteiramente delas.
  const acoesRemotas = useAcoesRemotas(
    depsDasAcoesRemotas({
      ws, qi, exec, conexoes, copiar,
      confirmar: dialogs.confirmar,
      mostrarSaida: () => layout.mostrarPainel('output'),
      onErro: falhaDeConexao,
    })
  );

  const menusDeConexao = useMenusDeConexao({
    abrir: menu.abrir,
    acoesRemotas,
    copiar,
    // T064: o diagrama sai como markdown com um bloco Mermaid, aberto JÁ em
    // preview. O texto continua atrás do switch, para ele poder gravar o
    // diagrama no repositório como documentação.
    sabeDesenharEr: (id) => conexoes.capacidadesDe(id)?.diagramaEr === true,
    diagramaEr: conexoesAcoes.diagramaEr,
    abrirQuery: ws.abrirQuery,
    abrirFormulario: (conexao) => conexoesAcoes.abrirFormulario(conexao),
    excluir: conexoes.excluir,
    abrirTerminalDaConexao: conexoesAcoes.abrirTerminalDaConexao,
    recarregarMetadados: conexoes.recarregarMetadados,
    abrirProcessos: (conexao) => ws.abrirProcessos(conexao.id, conexao.label),
    novaQuery: async (connectionId, no, tipo) => {
      const database = typeof no.meta?.database === 'string' ? no.meta.database : null;
      if (database === null) return;
      await conexoesAcoes.novaQuery({ connectionId, database }, tipo);
    },
    estaAberta: (id) => conexoes.estado?.openIds.includes(id) === true,
    desconectar: conexoes.desconectar,
    abrirConexao: conexoes.abrirConexao,
    confirmar: dialogs.confirmar,
  });

  /**
   * Abre um terminal de shell NO PAINEL (decisão D6).
   *
   * O de conexão continua sendo aba do editor — `abrirTerminalDaConexao`.
   */
  const novoTerminalNoPainel = (comando?: string): void => {
    const id = `term-${crypto.randomUUID()}`;
    if (comando !== undefined) {
      setComandosIniciais((atual) => new Map(atual).set(id, comando));
    }
    setTerminais((atual) => abrirNoPainel(atual, id));
    layout.mostrarPainel('terminal');
  };

  /** Abre um terminal AO LADO do ativo, no mesmo par. */
  const dividirTerminalNoPainel = (orientacao: 'horizontal' | 'vertical' = 'horizontal') => {
    setTerminais((a) => dividirTerminal(a, `term-${crypto.randomUUID()}`, orientacao));
    layout.mostrarPainel('terminal');
  };

  const saidaAcoes = useSaidaAcoes({ qi, ws, exec, pasta, avisar: dialogs.avisar });

  const comandosAcoes = useComandosAcoes({
    qi, avisar: dialogs.avisar, rodarNoTerminal: (c) => novoTerminalNoPainel(c),
  });
  const snippetsAcoes = useSnippetsAcoes({ qi, ws, snippets, linguagem, avisar: dialogs.avisar });

  const foto = useFotoDoTrecho(ws);
  const formatacaoAcoes = useFormatacaoAcoes({
    ws, tabSize: prefs.prefs['editor.tabSize'],
    // O dialeto muda como o SQL quebra: `LIMIT` e `TOP` não são a mesma coisa.
    dialetoAtivo: conexoes.acharConexao(vinculos.vinculoDe(caminhoAtivo)?.connectionId)?.type ?? null,
    avisar: dialogs.avisar,
  });


  /** Ids dos terminais que dividem a tela com o ativo. */
  const visiveisNoPainel = new Set(paneisVisiveis(terminais).map((t) => t.id));

  const contexto = contextoDeComandos({ ws, pasta, exec, conexoes, nav, terminais });

  const avisar = (p: Promise<unknown>): void => {
    void p.catch(falhaDaIde);
  };

  // O `Run | +Tab | JSON` do editor precisa de alguém que saiba executar.
  ligarCodeLensDeSql(ws, exec, avisar);
  // O que cada comando faz. Mora em `acoes/mapaDeAcoes.ts` desde a spec 053,
  // quando o `App` bateu no teto do Artigo IV pela quinta vez — é o maior bloco
  // coeso do arquivo, e "o que cada comando faz" é um assunto só.
  const ACOES = mapaDeAcoes({
    ws, exec, conexoes, dialogs, layout, prefs, nav,
    arquivoAcoes, codigoAcoes, comandosAcoes, conexoesAcoes, pastaAcoes, snippetsAcoes,
    formatacaoAcoes,
    novoArquivo, novoTerminalNoPainel, dividirTerminalNoPainel, abrirPorCaminho, irParaArquivo,
    abrirPreferencias, abrirTelaDePreferencias: ws.abrirTelaDePreferencias, abrirPaleta, escolherTema, irPara, irParaLinha, executar,
    setPainelLateral, avisar,
  });

  const executarComando = (id: string): void => {
    // Comando atendido pelo editor não tem entrada em `ACOES`: quem o executa é
    // o Monaco. Sem este desvio, o item de menu ficaria ativo e inerte.
    const doEditor = ACAO_DO_MONACO[id];
    if (doEditor !== undefined) {
      ws.editorRef.current?.executarAcao(doEditor);
      return;
    }
    (ACOES as Record<string, (() => void) | undefined>)[id]?.();
  };

  /**
   * Atalhos de teclado, despachados pelo mesmo registro do menu e da paleta.
   *
   * O ouvinte é registrado uma vez, mas lê o despacho por `ref`. Sem isso ele
   * capturaria o `contexto` do primeiro render e passaria a decidir
   * disponibilidade com estado velho — um Ctrl+S deixaria de funcionar depois
   * de trocar de aba.
   */
  const despacho = useRef<(e: KeyboardEvent) => void>(() => {});
  despacho.current = (e: KeyboardEvent) => {
    const cmd = comandoDoAtalho(formatarAtalho(e), contexto);
    if (cmd === null) return;
    // Só engole a tecla quando há comando disponível — caso contrário o editor
    // perderia atalhos que ele próprio trata.
    e.preventDefault();
    executarComando(cmd.id);
  };

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent): void => despacho.current(e);
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, []);

  const abaAtual = ws.activeId ?? '';

  /**
   * O formulário de conexão, montado aqui porque é o `App` que conhece os
   * drivers. O grupo só decide ONDE ele aparece.
   */
  const formularioDeConexao =
    ws.active?.type !== 'conexao' ? null : (
      <ConnectionForm
        // Remonta ao trocar de conexão: o formulário guarda estado próprio, e
        // reaproveitar a instância misturaria os campos de duas conexões.
        key={ws.active.id}
        drivers={[...conexoes.drivers.values()]}
        gruposConhecidos={conexoes.grupos}
        conexao={conexoes.acharConexao(ws.active.meta.connectionId)}
        grupoInicial={
          typeof ws.active.meta.grupoInicial === 'string' ? ws.active.meta.grupoInicial : ''
        }
        onSujar={(sujo) => ws.marcarAbaSuja(abaAtual, sujo)}
        onCancelar={() => ws.fechar(abaAtual)}
        onSalvar={async (input, conectar) => {
          const id = ws.active?.meta.connectionId;
          await conexoes.salvarConexao(input, typeof id === 'string' ? id : null, conectar);
          ws.marcarAbaSuja(abaAtual, false);
          ws.fechar(abaAtual);
        }}
      />
    );

  return (
    <ThemeProvider theme={temaMui}>
    <CssBaseline />
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        color: 'text.primary',
        // Durante o arraste o cursor não pode mudar ao passar sobre o editor.
        ...(lateral.dragging ? { cursor: 'col-resize', userSelect: 'none' } : {}),
      }}
    >
      <MenuBar
        contexto={contexto}
        onComando={executarComando}
        lateralVisivel={layout.lateralVisivel}
        painelVisivel={layout.painelVisivel}
        onAlternarLateral={layout.alternarLateral}
        onAlternarPainel={layout.alternarPainel}
        estados={{ 'file.autoSave': prefs.prefs['editor.autoSave'] }}
      />

      <Box component="main" sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Escondida com `display: none`, e não desmontada: o painel de arquivos
            guarda quais pastas estão expandidas, e remontar perderia isso.
            Mesma regra do editor e dos terminais. */}
        <Box sx={{ display: layout.lateralVisivel ? 'contents' : 'none' }}>
        <Sidebar
          width={lateral.width}
          painelAtivo={painelLateral}
          onPainelAtivo={setPainelLateral}
          onAbrirPasta={() => avisar(pastaAcoes.abrirPasta())}
          onNovoArquivo={() => avisar(pastaAcoes.novoArquivoNaPasta())}
          onNovaPasta={() => avisar(pastaAcoes.novaPasta())}
          onMenuDoArquivo={pastaAcoes.menuDoItem}
          onMenuDaRaiz={pastaAcoes.menuDaRaiz}
          onMenuDoVazio={pastaAcoes.menuDoVazio}
          onAcrescentarPasta={() => avisar(pastaAcoes.acrescentarPasta())}
          onRenomearArquivo={(no) => avisar(pastaAcoes.renomearItem(no.path))}
          onExcluirArquivo={(no) => avisar(pastaAcoes.excluirItem(no.path, no.type === 'dir'))}
          busca={{
            busca,
            // Abre o arquivo e pula para a ocorrência — clicar num resultado
            // que não leva a lugar nenhum seria metade da feature.
            onAbrir: (caminho, o) => {
              void ws.abrirArquivoEm(caminho, o.linha, o.coluna).catch(falhaDaIde);
            },
            onConfirmar: (mensagem, rotulo) =>
              dialogs.confirmar({
                titulo: 'Substituir em arquivos',
                mensagem,
                rotuloConfirmar: rotulo,
                destrutivo: true,
              }),
            onErro: falhaDaIde,
          }}
          onErro={falhaDaIde}
          onAbrirArquivo={ws.abrirArquivo}
          pasta={pasta}
          onIrParaSimbolo={irParaSimbolo}
          caminhoAtivo={caminhoAtivo}
          conexoes={{
            ctrl: conexoes,
            onAbrirQuery: conexoesAcoes.abrirQueryDoNo,
            onAbrirArquivoRemoto: ws.abrirArquivoRemoto,
            onAbrirServidor: (conexao: PublicConnection) => {
              // Conecta ANTES de abrir a aba quando ainda não há sessão: sem
              // isto a aba nascia dizendo "Conectando…" para sempre, porque
              // ninguém chegava a conectar. Visto no navegador.
              if (conexoes.capacidadesDe(conexao.id) === null) {
                avisar(conexoes.abrirConexao(conexao));
              }
              ws.abrirServidor(conexao.id, conexao.label);
            },
            acoesRemotas,
            somenteLeitura: (id: string) => conexoes.acharConexao(id)?.readOnly === true,
            onNovaConexao: (grupo?: string) => conexoesAcoes.abrirFormulario(null, grupo),
            onRenomearGrupo: (caminho: string) => avisar(conexoesAcoes.renomearGrupo(caminho)),
            onAbrirTerminal: (conexao: PublicConnection) => avisar(conexoesAcoes.abrirTerminalDaConexao(conexao)),
            onDiagramaEr: conexoesAcoes.diagramaEr,
            onNovoObjeto: conexoesAcoes.novoObjeto,
            // Arquivos de query (spec 038) — ver `query/useAcoesDeQuery`.
            ...acoesDeQuery,
            onErro: falhaDeConexao,
            ...menusDeConexao,
          }}
        />
        <Resizer dragging={lateral.dragging} onStart={lateral.startDrag} onReset={lateral.reset} />
        </Box>

        <Box
          component="section"
          sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
        >
          {/* O arranjo dos grupos. Com um só, é exatamente a tela de antes. */}
          <Box sx={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
            <EditorGrid layout={ws.layout} onRedimensionar={ws.redimensionarLayout}
              grupo={(g) => (
                <EditorGroup
                  grupo={g}
                  abas={ws.tabs.filter((t) => t.grupo === g)}
                  ativaId={ws.store.ativaDoGrupo(g)}
                  {...propsDeTabela}                  focado={ws.grupoFocado === g}
                  dividido={ws.grupos.length > 1}
                  fontSize={prefs.prefs['editor.fontSize']}
                  tabSize={prefs.prefs['editor.tabSize']}
                  wordWrap={prefs.prefs['editor.wordWrap']}
                  terminalFontSize={prefs.prefs['terminal.fontSize']}
                  // O `{}` da barra do terminal abre o arquivo de snippets
                  // aqui mesmo, pelo caminho — como o `config.json` (T085).
                  onAbrirArquivo={ws.abrirArquivo}
                  tema={tema}
                  snippets={snippets.lista}
                  emmet={prefs.emmet}
                  grades={exec.grades}
                  emPreview={ws.emPreview}
                  conteudoDaAba={ws.conteudoDaAba}
                  onPreview={
                    ws.grupoFocado === g && temPreview(ws.linguagemAtiva)
                      ? ws.alternarPreview
                      : undefined
                  }
                  registrarEditor={ws.registrarEditor(g)}
                  onFocar={() => ws.focarGrupo(g)}
                  onAtivar={ws.ativar}
                  onFechar={ws.fechar}
                  onMudar={ws.marcarSujo}
                  onCursor={ws.aoMoverCursor}
                  onExecutar={
                    ws.grupoFocado === g && contexto.temEditor ? () => executar('file') : undefined
                  }
                  onSoltar={(zona, carga) => ws.soltarNoGrupo(g, zona, carga)}
                  onReordenarAba={(id, antesDe) => ws.reordenarAba(g, id, antesDe)}
                  onComando={executarComando}
                  abrirMenu={menu.abrir}
                  // Os bancos vêm do cache da árvore: eles já foram lidos ao
                  // expandir a conexão, e pedir de novo seria uma ida ao
                  // servidor por uma lista que a IDE tem na mão.
                  bancosDaConexao={(id) =>
                    (conexoes.filhos.get(id) ?? [])
                      .filter((n) => n.hasChildren)
                      .map((n) => n.label)
                  }
                  onAbrirSql={(titulo, sql) => ws.abrirTexto(`sql:${titulo}`, titulo, sql, 'sql')}
                  confirmar={dialogs.confirmar}
                  formulario={formularioDeConexao}
                  requisitos={<TelaDeRequisitos onErro={falhaDaIde} />}
                  acoesDeMenu={acaoDeMenuDaFoto(() => avisar(formatacaoAcoes.foto()))}
                  codesnap={
                    <PainelDeCodeSnap
                      {...foto}
                      cursor={ws.cursor}
                      paleta={paletaDe(tema)}
                      onErro={falhaDaIde}
                      avisar={dialogs.avisar}
                    />
                  }
                  preferencias={
                    <TelaDePreferencias
                      prefs={prefs.prefs}
                      sobrescritas={prefs.sobrescritas}
                      definir={prefs.definir}
                      abrirJson={() => avisar(abrirPreferencias())}
                      abrirDoProjeto={() =>
                        avisar(
                          Api.prefsProjectFile().then(({ path }) => ws.abrirArquivo(path))
                        )
                      }
                      onErro={falhaDaIde}
                    />
                  }
                />
              )}
            />
          </Box>

          {/* SEMPRE montado, escondido com `display: none`.
              Usar `&&` aqui desmontava o painel inteiro — e com ele os
              terminais, que morriam ao esconder. Esconder é esconder, não
              fechar (AC-4). É a mesma regra do editor e das abas, e este
              arquivo já a documentava dez linhas acima quando o defeito
              entrou. */}
          <Box
            sx={{
              display: layout.painelVisivel ? 'contents' : 'none',
            }}
          >
            <>
              <ResizerHorizontal
                onAltura={layout.definirAltura}
                onReset={() => layout.definirAltura(ALTURA_PADRAO_PAINEL)}
              />
              <BottomPanel
                aba={layout.abaDoPainel}
                onAba={layout.definirAba}
                altura={layout.alturaDoPainel}
                linhas={exec.saida}
                status={exec.status}
                problemas={problemas.lista}
                terminais={terminais}
                onLimpar={exec.limparSaida}
                onLimparProblemas={problemas.limpar}
                onAbrirNoEditor={saidaAcoes.abrirNoEditor}
                onSalvarComo={() => avisar(saidaAcoes.salvarComo())}
                onNovoTerminal={() => novoTerminalNoPainel()}
                onDividirTerminal={dividirTerminalNoPainel}
                onAtivarTerminal={(id) => setTerminais((a) => ativarTerminal(a, id))}
                onFecharTerminal={(id) => setTerminais((a) => fecharTerminal(a, id))}
                onEsconder={layout.alternarPainel}
              >
                {/* Todos montados; à vista, os do PAR do ativo — é o "split
                    terminal". Renderizar só o ativo desmontaria o componente ao
                    alternar, matando o processo e apagando o buffer: esconder é
                    `display: none`, nunca desmontar. */}
                {terminais.lista.map((t) => (
                  <Box
                    key={t.id}
                    data-pane-terminal={t.titulo}
                    sx={{
                      flex: 1, minHeight: 0, minWidth: 0,
                      display: visiveisNoPainel.has(t.id) ? 'flex' : 'none',
                      // A divisa acompanha a direção do par (T020).
                      ...(orientacaoDoPar(terminais, terminais.ativo ?? '') === 'vertical'
                        ? { borderTop: 1, '&:first-of-type': { borderTop: 0 } }
                        : { borderLeft: 1, '&:first-of-type': { borderLeft: 0 } }),
                      borderColor: 'divider',
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      {/* Snippets também no painel de baixo (T087). Eu tinha
                          recusado escrevendo "ninguém pediu" — e ele pediu.
                          `Reconectar` e `Duplicar` ficam de fora: o painel já
                          tem os dois na própria gestão de terminais. */}
                      <BarraDoTerminal
                        soSnippets
                        aparencia={aparenciasDoPainel.get(t.id) ?? VAZIA}
                        onAparencia={(nova) =>
                          setAparenciasDoPainel((atual) => new Map(atual).set(t.id, nova))
                        }
                        conexaoId={TERMINAL_LOCAL}
                        onEnviar={(texto) =>
                          setComandosDoPainel((atual) =>
                            new Map(atual).set(t.id, { id: Date.now(), texto })
                          )
                        }
                        onReconectar={() => undefined}
                        onDuplicar={() => undefined}
                        pedir={(o) => qi.pedir(o)}
                        confirmar={dialogs.confirmar}
                        onErro={dialogs.avisar}
                        abrirArquivo={ws.abrirArquivo}
                      />
                      <TerminalHost
                        ativo={visiveisNoPainel.has(t.id) && layout.painelVisivel}
                        fontSize={prefs.prefs['terminal.fontSize']}
                        tema={tema}
                        comandoInicial={comandosIniciais.get(t.id) ?? null}
                        comandoParaEnviar={comandosDoPainel.get(t.id) ?? null}
                        sessaoId={t.id}
                        aparencia={aparenciasDoPainel.get(t.id) ?? VAZIA}
                      />
                    </Box>
                  </Box>
                ))}
              </BottomPanel>
            </>
          </Box>
        </Box>
      </Box>

      <StatusBar
        titulo={ws.active?.title ?? null}
        sujo={ws.active?.dirty === true}
        linha={ws.cursor.linha}
        coluna={ws.cursor.coluna}
        linguagem={linguagem}
        onTrocarLinguagem={
          contexto.temEditor ? () => avisar(escolherLinguagem()) : undefined
        }
        onIrParaPosicao={contexto.temEditor ? () => avisar(irParaLinha()) : undefined}
        {...propsDeVinculo(linguagem, caminhoAtivo, contexto.temEditor, vinculos, avisar)}
      />

      <QuickInput
        aberto={qi.pedido !== null}
        titulo={qi.pedido?.titulo}
        placeholder={qi.pedido?.placeholder ?? ''}
        opcoes={qi.pedido?.opcoes}
        valorInicial={qi.pedido?.valorInicial}
        erro={qi.pedido?.erro ?? null}
        permiteVazio={qi.pedido?.permiteVazio === true}
        filtrar={qi.pedido?.filtrar}
        onConfirmar={qi.confirmar}
        onCancelar={qi.cancelar}
      />

      {/* Fora da lateral de propósito: o pedido de senha precisa sobreviver a
          trocar de painel enquanto o diálogo está aberto. */}
      <VaultDialog
        pedido={conexoes.pedidoDeSenha}
        podeLembrar={conexoes.estado?.vault.canRemember !== false}
        onResponder={conexoes.responderSenha}
        onCancelar={conexoes.cancelarSenha}
      />

      {dialogs.elemento}
      {menu.elemento}

    </Box>
    </ThemeProvider>
  );
}
