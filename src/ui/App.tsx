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
import { NOMES_DE_TEMA, ROTULO_DO_TEMA, TEMAS, type NomeDoTema } from '../shared/temas';
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
import { useContextMenu } from './ContextMenu';
import { useDialogs } from './useDialogs';
import { Api } from './api';
import { MenuBar } from './MenuBar';
import { StatusBar } from './StatusBar';
import { QuickInput } from './QuickInput';
import { pedirComRetentativa, useQuickInput } from './useQuickInput';
import {
  comandoDoAtalho, filtrarComandos, formatarAtalho,
  type ContextoDeComandos, type IdImplementado,
} from '../shared/commands';
import { BottomPanel } from './BottomPanel';
import { ResizerHorizontal } from './ResizerHorizontal';
import { useLayout, ALTURA_PADRAO_PAINEL } from './useLayout';
import { usePersistido } from './usePersistido';
import { useProblemas } from './useProblemas';
import {
  abrirTerminal as abrirNoPainel, ativarTerminal, dividirTerminal, fecharTerminal,
  podeDividirTerminal,
  normalizarTerminais, paneisVisiveis, SEM_TERMINAIS,
} from '../shared/terminais';
import { useExecution } from './useExecution';
import { useVinculo } from './query/useVinculo';
import { ligarCodeLensDeSql, propsDeVinculo, useAcoesDeQuery } from './query/useAcoesDeQuery';
import { usePasta } from './files/usePasta';
import { usePrefs } from './usePrefs';
import { useAutoSave } from './useAutoSave';
import { useSessaoDeAbas } from './useSessaoDeAbas';
import { useVigia } from './useVigia';
import { useHistorico } from './useHistorico';
import { useSnippets } from './useSnippets';
import { useBusca } from './files/useBusca';
import { useComandosAcoes } from './acoes/useComandosAcoes';
import { useArquivoAcoes } from './acoes/useArquivoAcoes';
import { useCodigoAcoes } from './acoes/useCodigoAcoes';
import { usePastaAcoes } from './acoes/usePastaAcoes';
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

  const ws = useWorkspace({ confirmar: dialogs.confirmar });
  const conexoes = useConnections({ confirmar: dialogs.confirmar });
  const menu = useContextMenu(falhaDaIde);
  const pasta = usePasta();
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
  const tema = prefs.prefs['workbench.theme'] as NomeDoTema;
  // As variáveis CSS precisam existir ANTES da primeira pintura: escrevê-las
  // num `useEffect` deixaria o primeiro quadro sem cor nenhuma.
  aplicarVariaveis(TEMAS[tema]);
  const temaMui = useMemo(() => criarTema(tema), [tema]);

  const layout = useLayout();
  const nav = useHistorico({ abaExiste: (abaId) => ws.store.get(abaId) !== null });
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

  /**
   * Trocar de aba é um salto; mover o cursor não é.
   *
   * É a decisão central da spec 016: registrar cada movimento faria `Back`
   * andar uma casa por vez e não servir para nada.
   */
  useEffect(() => {
    if (ws.activeId !== null) nav.registrarSalto({ abaId: ws.activeId, linha: ws.cursor.linha });
    // `cursor` FORA das dependências de propósito — é justamente o que não deve
    // disparar registro.
  }, [ws.activeId]);

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

  /** Abre o arquivo do símbolo, se preciso, e pula para a linha. */
  const irParaSimbolo = (arquivo: string, linha: number): void => {
    const atual = (ws.active?.meta as { path?: string | null } | undefined)?.path ?? null;
    // De onde se saiu já está no histórico: o efeito de `activeId` registrou ao
    // chegar aqui. O que falta é a linha de destino, que não é troca de aba.
    const pular = () => window.setTimeout(() => {
      ws.editorRef.current?.goToLine(linha);
      const destino = ws.store.list().find(
        (t) => (t.meta as { path?: string | null }).path === arquivo
      );
      if (destino !== undefined) nav.registrarSalto({ abaId: destino.id, linha });
    }, 0);
    if (arquivo === atual) {
      pular();
      return;
    }
    ws.abrirArquivo(arquivo).then(pular).catch(falhaDaIde);
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

  const arquivoAcoes = useArquivoAcoes({
    qi, ws, pasta, prefs, avisar: dialogs.avisar, confirmar: dialogs.confirmar,
  });
  const codigoAcoes = useCodigoAcoes({ qi, ws, avisar: dialogs.avisar });
  const pastaAcoes = usePastaAcoes({
    qi, pasta, avisar: dialogs.avisar, abrirArquivo: ws.abrirArquivo,
  });
  /** O caminho do arquivo em foco — a chave do vínculo e do painel de símbolos. */
  const caminhoAtivo =
    (ws.active?.meta as { path?: string | null } | undefined)?.path ?? null;

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
   * Abre o `config.json` como aba do editor.
   *
   * É a "tela de configurações" desta IDE, e de propósito: a IDE já sabe abrir,
   * editar e salvar arquivo, então isto custa uma linha e cobre 100% das
   * chaves. Um formulário custaria um campo por preferência, e ficaria para
   * trás a cada chave nova.
   */
  const abrirPreferencias = async (): Promise<void> => {
    const { path } = await Api.prefsFile();
    await ws.abrirArquivo(path);
  };

  const abrirPorCaminho = async (): Promise<void> => {
    const caminho = await qi.pedir({
      titulo: 'Abrir arquivo',
      placeholder: 'Caminho absoluto do arquivo',
    });
    if (caminho !== null) await ws.abrirArquivo(caminho);
  };

  /** Escolhe o tema. Vale para moldura, editor e terminal ao mesmo tempo. */
  const escolherTema = async (): Promise<void> => {
    const escolhido = await qi.pedir({
      titulo: 'Tema da interface',
      placeholder: 'Escolha um tema',
      opcoes: NOMES_DE_TEMA.map((nome) => ({
        valor: nome,
        rotulo: ROTULO_DO_TEMA[nome],
        detalhe: nome === tema ? 'atual' : undefined,
        icone: nome === tema ? 'lucide:check' : 'lucide:circle-dot',
      })),
    });
    if (escolhido !== null) await prefs.definir({ 'workbench.theme': escolhido as NomeDoTema });
  };

  const { escolherLinguagem, irParaLinha } = useStatusAcoes({
    qi,
    ws,
    trocarLinguagem,
    registrarSalto: nav.registrarSalto,
  });

  /** Leva a uma posição do histórico: ativa a aba e pula para a linha. */
  const irPara = (posicao: { abaId: string; linha: number } | null): void => {
    if (posicao === null) return;
    ws.ativar(posicao.abaId);
    // Depois da troca de aba: o editor só carrega o conteúdo no efeito seguinte.
    window.setTimeout(() => ws.editorRef.current?.goToLine(posicao.linha), 0);
  };

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

  const copiar = (texto: string): void => {
    void navigator.clipboard?.writeText(texto);
  };

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
  const dividirTerminalNoPainel = (): void => {
    setTerminais((atual) => dividirTerminal(atual, `term-${crypto.randomUUID()}`));
    layout.mostrarPainel('terminal');
  };

  const texto = (): string => exec.saida.map((l) => l.texto).join('');

  /** Leva a saída para uma aba do editor, sem passar por arquivo. */
  const abrirSaidaNoEditor = (): void => {
    const conteudo = texto();
    if (conteudo === '') return;
    ws.abrirTexto('saida:editor', 'output.log', conteudo, 'plaintext');
  };

  /** Grava a saída na pasta aberta, com o nome pedido pela entrada rápida. */
  const salvarSaidaComo = async (): Promise<void> => {
    const conteudo = texto();
    if (conteudo === '') return;
    if (pasta.pasta === '') {
      await dialogs.avisar(
        'Abra uma pasta antes de salvar a saída — é nela que o arquivo será gravado.',
        'Salvar saída'
      );
      return;
    }
    await pedirComRetentativa(
      qi,
      { titulo: 'Salvar saída como', placeholder: 'ex.: saida.log', valorInicial: 'saida.log' },
      (nome) => pasta.criarArquivo(nome, conteudo)
    );
  };

  const comandosAcoes = useComandosAcoes({
    qi, avisar: dialogs.avisar, rodarNoTerminal: (c) => novoTerminalNoPainel(c),
  });
  const snippetsAcoes = useSnippetsAcoes({ qi, ws, snippets, linguagem });


  /** Ids dos terminais que dividem a tela com o ativo. */
  const visiveisNoPainel = new Set(paneisVisiveis(terminais).map((t) => t.id));

  const contexto: ContextoDeComandos = {
    // `tabela` entrou na lista quando a spec 043 encontrou o defeito: o ▷ da
    // barra de abas aparecia numa aba de tabela e executava o EDITOR do grupo,
    // que ainda guardava o último arquivo aberto ali. Quem executa numa aba de
    // tabela é o botão da própria aba.
    temEditor:
      ws.active !== null &&
      !['grid', 'conexao', 'tabela'].includes(ws.active.type),
    temProjeto: pasta.pasta !== '',
    abaSuja: ws.active?.dirty === true,
    temAba: ws.active !== null,
    temSelecao: true,
    temConexaoAtiva: exec.conexaoAtiva !== null,
    cofreDestrancado: conexoes.estado?.vault.unlocked === true,
    executando: exec.executando,
    podeVoltar: nav.podeVoltar,
    podeAvancar: nav.podeAvancar,
    podeDividirTerminal: podeDividirTerminal(terminais),
  };

  const avisar = (p: Promise<unknown>): void => {
    void p.catch(falhaDaIde);
  };

  // O `Run | +Tab | JSON` do editor precisa de alguém que saiba executar.
  ligarCodeLensDeSql(ws, exec, avisar);

  /**
   * Liga cada id declarado à função que o executa.
   *
   * Um comando não pendente sem entrada aqui vira clique morto — por isso há
   * teste de completude cruzando as duas listas.
   */
  const ACOES: Readonly<Record<IdImplementado, () => void>> = {
    'file.new': novoArquivo,
    'file.newProject': () => avisar(pastaAcoes.novoProjeto()),
    'file.open': () => avisar(abrirPorCaminho()),
    'file.openFolder': () => avisar(pastaAcoes.abrirPasta()),
    'file.openWorkspace': () => avisar(pastaAcoes.escolherProjeto()),
    'file.openRecent': () => avisar(pastaAcoes.abrirRecente()),
    'file.save': () => avisar(arquivoAcoes.salvarArquivo()),
    'file.saveAs': () => avisar(arquivoAcoes.salvarArquivo()),
    'file.saveAll': () => avisar(arquivoAcoes.salvarTudo()),
    'file.autoSave': () => avisar(arquivoAcoes.alternarAutoSave()),
    'file.revert': () => avisar(arquivoAcoes.reverterArquivo()),
    'file.preferences': () => avisar(abrirPreferencias()),
    'file.closeEditor': () => { if (ws.activeId !== null) ws.fechar(ws.activeId); },

    'edit.undo': () => document.execCommand('undo'),
    'edit.redo': () => document.execCommand('redo'),
    'edit.cut': () => document.execCommand('cut'),
    'edit.copy': () => document.execCommand('copy'),
    'edit.snippets': () => avisar(snippetsAcoes.abrir()),
    'edit.paste': () => avisar(navigator.clipboard.readText().then((t) => {
      document.execCommand('insertText', false, t);
    })),

    'selection.all': () => document.execCommand('selectAll'),

    'view.commandPalette': () => avisar(abrirPaleta()),
    'view.explorer': () => setPainelLateral('files'),
    // Os três abrem o MESMO painel: `Find in Files` e `Replace in Files` são a
    // busca vista do menu Edit, e `Search` é a mesma vista da lateral.
    'view.search': () => setPainelLateral('search'),
    'edit.findInFiles': () => setPainelLateral('search'),
    'edit.replaceInFiles': () => setPainelLateral('search'),
    'view.symbols': () => setPainelLateral('symbols'),
    'view.database': () => setPainelLateral('database'),
    'view.service': () => setPainelLateral('service'),
    // Passou a significar o que o nome diz: mostrar o painel naquela aba. Antes
    // este comando LIMPAVA a saída, o que ninguém adivinharia pelo rótulo.
    'view.appearance': () => avisar(escolherTema()),
    'view.output': () => layout.mostrarPainel('output'),
    'view.problems': () => layout.mostrarPainel('problems'),
    'view.toggleSidebar': layout.alternarLateral,
    'view.togglePanel': layout.alternarPainel,
    'view.splitEditor': ws.dividir,
    // Alterna e PERSISTE. A ação do Monaco alternaria e esqueceria — e o
    // usuário espera que a escolha sobreviva a recarregar a página.
    'view.wordWrap': () =>
      avisar(prefs.definir({ 'editor.wordWrap': !prefs.prefs['editor.wordWrap'] })),

    'go.file': () => avisar(abrirPorCaminho()),
    'go.symbol': () => setPainelLateral('symbols'),
    'go.line': () => avisar(irParaLinha()),
    'go.definition': () => avisar(codigoAcoes.irParaDefinicao()),
    'go.typeDefinition': () => avisar(codigoAcoes.irParaDefinicaoDeTipo()),
    'go.references': () => avisar(codigoAcoes.verReferencias()),
    'go.back': () => irPara(nav.voltar()),
    'go.forward': () => irPara(nav.avancar()),

    'run.file': () => executar('file'),
    'run.selection': () => executar('block'),
    'run.stop': () => avisar(exec.parar()),
    'run.disconnect': () => {
      const id = exec.conexaoAtiva;
      if (id !== null) avisar(conexoes.desconectar(id));
    },

    'terminal.new': () => novoTerminalNoPainel(),
    'terminal.split': dividirTerminalNoPainel,
    'terminal.runTask': () => avisar(comandosAcoes.abrir()),
    'terminal.connection': () => {
      const conexao = conexoes.acharConexao(exec.conexaoAtiva);
      if (conexao !== null) avisar(conexoesAcoes.abrirTerminalDaConexao(conexao));
    },

    'help.commands': () => avisar(abrirPaleta()),
    // Destino honesto em vez de remoção: a IDE não tem documentação escrita,
    // mas tem um README — e é para ele que o usuário deve ser levado.
    'help.docs': () => avisar(Api.docs().then(({ path }) => ws.abrirArquivo(path))),
    'help.about': () => void dialogs.avisar(
      'IDE local com painéis de banco e serviço, sem licença e sem limite de conexões.',
      'dev-ide'
    ),
  };

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
          }}
          onErro={falhaDaIde}
          onAbrirArquivo={ws.abrirArquivo}
          pasta={pasta}
          onIrParaSimbolo={irParaSimbolo}
          caminhoAtivo={caminhoAtivo}
          conexoes={{
            ctrl: conexoes,
            onAbrirQuery: conexoesAcoes.abrirQueryDoNo,
            onNovaConexao: (grupo?: string) => conexoesAcoes.abrirFormulario(null, grupo),
            onRenomearGrupo: (caminho: string) => avisar(conexoesAcoes.renomearGrupo(caminho)),
            onAbrirTerminal: (conexao: PublicConnection) => avisar(conexoesAcoes.abrirTerminalDaConexao(conexao)),
            onFiltrar: (id, caminho, atual) => avisar(conexoesAcoes.filtrarCategoria(id, caminho, atual)),
            onNovoObjeto: conexoesAcoes.novoObjeto,
            // Arquivos de query (spec 038) — ver `query/useAcoesDeQuery`.
            ...acoesDeQuery,
            onErro: falhaDeConexao,
            onMenuNo: (e, id, caminho, no, database) =>
              menu.abrir(e, [
                { label: 'Copiar nome', onClick: () => copiar(no.label) },
                ...(no.actions === undefined || no.actions.length === 0 ? [] : [null]),
                // Sem diálogo de confirmação, e de propósito (spec 040): uma
                // ação de menu GERA o SQL e o abre — nada é executado. O
                // diálogo que existia aqui afirmava "esta ação altera o
                // servidor", o que era falso. O `danger` continua, pintando o
                // item de vermelho, e o aviso de verdade vai no SQL gerado,
                // que é onde ele é lido. Rodar é o `▷ Run` da spec 038.
                ...(no.actions ?? []).map((acao) => ({
                  label: acao.label,
                  danger: acao.danger,
                  onClick: async () => {
                    const r = await Api.runAction(id, { nodePath: caminho, actionId: acao.id });
                    // O database vem herdado da subárvore: o menu de contexto
                    // sabe onde clicou, e a aba precisa nascer amarrada.
                    ws.abrirQuery(
                      `acao:${id}:${r.title}`, r.title, r.content, id, database
                    );
                  },
                })),
              ]),
            onMenuConexao: (e, conexao) =>
              menu.abrir(e, [
                { label: 'Copiar nome', onClick: () => copiar(conexao.label) },
                conexoes.estado?.openIds.includes(conexao.id) === true
                  ? { label: 'Desconectar', onClick: () => conexoes.desconectar(conexao.id) }
                  : { label: 'Conectar', onClick: () => conexoes.abrirConexao(conexao) },
                { label: 'Recarregar metadados', onClick: () => conexoes.recarregarMetadados(conexao.id) },
                null,
                { label: 'Editar conexão…', onClick: () => conexoesAcoes.abrirFormulario(conexao) },
                { label: 'Excluir conexão', danger: true, onClick: () => conexoes.excluir(conexao) },
              ]),
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
            <EditorGrid
              layout={ws.layout}
              grupo={(g) => (
                <EditorGroup
                  grupo={g}
                  abas={ws.tabs.filter((t) => t.grupo === g)}
                  ativaId={ws.store.ativaDoGrupo(g)}
                  onExportar={ws.abrirSemTitulo}
                  onConfirmarEscrita={(mensagem, titulo) =>
                    dialogs.confirmar({
                      titulo,
                      mensagem,
                      rotuloConfirmar: 'Gravar',
                      destrutivo: true,
                    })
                  }
                  conexaoSomenteLeitura={(t) =>
                    conexoes.acharConexao((t.meta as { connectionId?: string }).connectionId)
                      ?.readOnly === true
                  }
                  focado={ws.grupoFocado === g}
                  dividido={ws.grupos.length > 1}
                  fontSize={prefs.prefs['editor.fontSize']}
                  tabSize={prefs.prefs['editor.tabSize']}
                  wordWrap={prefs.prefs['editor.wordWrap']}
                  terminalFontSize={prefs.prefs['terminal.fontSize']}
                  tema={tema}
                  snippets={snippets.lista}
                  grades={exec.grades}
                  emPreview={ws.emPreview}
                  conteudoDaAba={ws.conteudoDaAba}
                  onPreview={
                    ws.grupoFocado === g && temPreview(linguagem) ? ws.alternarPreview : undefined
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
                  onComando={executarComando}
                  formulario={formularioDeConexao}
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
                onAbrirNoEditor={abrirSaidaNoEditor}
                onSalvarComo={() => avisar(salvarSaidaComo())}
                onNovoTerminal={() => novoTerminalNoPainel()}
                onDividirTerminal={dividirTerminalNoPainel}
                onAtivarTerminal={(id) => setTerminais((a) => ativarTerminal(a, id))}
                onFecharTerminal={(id) => setTerminais((a) => fecharTerminal(a, id))}
                onEsconder={layout.alternarPainel}
              >
                {/* Todos montados, só o ativo à vista — mesma regra do editor e
                    das abas de terminal. Renderizar só o ativo desmontaria o
                    componente ao alternar, matando o processo e apagando o
                    buffer. */}
                {/* Todos montados; à vista, os do PAR do ativo — é o lado a
                    lado do "split terminal". Esconder continua sendo
                    `display: none`, nunca desmontar. */}
                {terminais.lista.map((t) => (
                  <Box
                    key={t.id}
                    data-pane-terminal={t.titulo}
                    sx={{
                      flex: 1, minHeight: 0, minWidth: 0,
                      display: visiveisNoPainel.has(t.id) ? 'flex' : 'none',
                      borderLeft: 1,
                      borderColor: 'divider',
                      '&:first-of-type': { borderLeft: 0 },
                    }}
                  >
                    <TerminalHost
                      ativo={visiveisNoPainel.has(t.id) && layout.painelVisivel}
                      fontSize={prefs.prefs['terminal.fontSize']}
                      tema={tema}
                      comandoInicial={comandosIniciais.get(t.id) ?? null}
                      sessaoId={t.id}
                    />
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
