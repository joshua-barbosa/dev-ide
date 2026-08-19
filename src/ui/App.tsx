// Esqueleto da interface: a moldura que os painéis preenchem.
//
// Estrutura: barra de menu, lateral, divisória, área de editor com abas e saída,
// barra de status.
//
// É aqui que o registro de comandos ganha corpo: `ACOES` liga cada id declarado
// em `shared/commands.ts` à função que o executa, e `contexto` diz o que está
// disponível agora. Menu, paleta e atalhos leem essa mesma dupla — por isso um
// comando novo entra numa linha e aparece nos três lugares.
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { tokens } from './theme';
import { Sidebar } from './Sidebar';
import { Resizer } from './Resizer';
import { useSidebarWidth } from './useSidebarWidth';
import { useWorkspace } from './useWorkspace';
import { EditorHost } from './editor/EditorHost';
import { ACAO_DO_MONACO } from '../shared/editor/acoes-monaco';
import { TabBar } from './tabs/TabBar';
import type { PublicConnection, TreeNode } from '../shared/contracts';
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
import { LINGUAGENS } from '../shared/editor/idiomas';
import {
  comandoDoAtalho, filtrarComandos, formatarAtalho,
  type ContextoDeComandos, type IdImplementado,
} from '../shared/commands';
import { ResultGrid } from './grid/ResultGrid';
import { OutputPanel } from './OutputPanel';
import { useExecution } from './useExecution';
import { useProject } from './files/useProject';
import { usePrefs } from './usePrefs';

export function App() {
  const lateral = useSidebarWidth();
  const dialogs = useDialogs();
  const ws = useWorkspace({ confirmar: dialogs.confirmar });
  const conexoes = useConnections({ confirmar: dialogs.confirmar });
  const menu = useContextMenu(dialogs.aoFalhar);
  const exec = useExecution(ws);
  const projeto = useProject();
  const qi = useQuickInput();
  const prefs = usePrefs(dialogs.aoFalhar);
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
    void exec.executar(modo, linguagem).catch(dialogs.aoFalhar);
  };

  /** Abre o arquivo do símbolo, se preciso, e pula para a linha. */
  const irParaSimbolo = (arquivo: string, linha: number): void => {
    const atual = (ws.active?.meta as { path?: string | null } | undefined)?.path ?? null;
    const pular = () => window.setTimeout(() => ws.editorRef.current?.goToLine(linha), 0);
    if (arquivo === atual) {
      pular();
      return;
    }
    ws.abrirArquivo(arquivo).then(pular).catch(dialogs.aoFalhar);
  };

  /**
   * Cria um arquivo sem título. Não pergunta nada — o nome vem no salvar.
   *
   * É o defeito que motivou esta spec: exigir a extensão antes da primeira
   * linha obriga a decidir a linguagem antes de saber o que se vai escrever.
   */
  const novoArquivo = (): void => {
    ws.novoSemTitulo();
  };

  /** Grava a aba ativa, pedindo o nome se ela ainda não tem arquivo. */
  const salvarArquivo = async (): Promise<void> => {
    const caminho = await ws.salvar();
    if (caminho !== null) {
      // Salvou o próprio `config.json`? Relê — é o que faz editar a preferência
      // no editor surtir efeito sem recarregar a página.
      if (caminho === prefs.caminho) await prefs.recarregar();
      await projeto.recarregar();
      return;
    }
    const aba = ws.active;
    if (aba === null || aba.type === 'grid' || aba.type === 'conexao') return;

    const conteudo = ws.editorRef.current?.getValue() ?? '';
    const criado = await pedirComRetentativa(
      qi,
      { titulo: 'Nome do arquivo', placeholder: 'ex.: utils.ts, script.py' },
      (nome) => projeto.criarArquivo(nome, conteudo)
    );
    // Cancelar mantém a aba como está, com o conteúdo intacto (AC-18).
    if (criado === null) return;
    ws.adotarArquivo(aba.id, criado);
  };

  const novoProjeto = async (): Promise<void> => {
    await pedirComRetentativa(
      qi,
      { titulo: 'Nome do projeto', placeholder: 'ex.: meu-projeto' },
      (nome) => projeto.criarProjeto(nome)
    );
  };

  const escolherProjeto = async (): Promise<void> => {
    const escolhido = await qi.pedir({
      titulo: 'Abrir workspace',
      placeholder: 'Escolha um projeto',
      opcoes: projeto.projetos.map((nome) => ({
        valor: nome,
        rotulo: nome,
        icone: 'folder',
      })),
    });
    if (escolhido !== null) projeto.selecionar(escolhido);
  };

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

  const escolherLinguagem = async (): Promise<void> => {
    const escolhida = await qi.pedir({
      titulo: 'Selecionar linguagem',
      placeholder: 'Linguagem',
      opcoes: LINGUAGENS.map(([valor, rotulo, icone]) => ({ valor, rotulo, icone })),
    });
    if (escolhida !== null) trocarLinguagem(escolhida);
  };

  const irParaLinha = async (): Promise<void> => {
    const alvo = await qi.pedir({ titulo: 'Ir para a linha', placeholder: 'Número da linha' });
    const numero = Number(alvo);
    if (alvo !== null && Number.isInteger(numero) && numero > 0) {
      ws.editorRef.current?.goToLine(numero);
    }
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

  /** Monta o SELECT de um objeto, qualificando com o schema quando houver. */
  const abrirQueryDoNo = (id: string, no: { label: string; meta?: Record<string, unknown> }) => {
    const objeto = typeof no.meta?.object === 'string' ? no.meta.object : no.label;
    const schema = typeof no.meta?.schema === 'string' ? no.meta.schema : null;
    const alvo = schema === null ? objeto : `${schema}.${objeto}`;
    exec.definirConexaoAtiva(id);
    ws.abrirQuery(`sql:${id}:${alvo}`, `${objeto}.sql`, `SELECT * FROM ${alvo} LIMIT 100;`, id);
  };

  const contexto: ContextoDeComandos = {
    temEditor: ws.active !== null && ws.active.type !== 'grid' && ws.active.type !== 'conexao',
    temProjeto: projeto.projeto !== '',
    abaSuja: ws.active?.dirty === true,
    temAba: ws.active !== null,
    temSelecao: true,
    temConexaoAtiva: exec.conexaoAtiva !== null,
    cofreDestrancado: conexoes.estado?.vault.unlocked === true,
  };

  const avisar = (p: Promise<unknown>): void => {
    void p.catch(dialogs.aoFalhar);
  };

  /**
   * Liga cada id declarado à função que o executa.
   *
   * Um comando não pendente sem entrada aqui vira clique morto — por isso há
   * teste de completude cruzando as duas listas.
   */
  const ACOES: Readonly<Record<IdImplementado, () => void>> = {
    'file.new': novoArquivo,
    'file.newProject': () => avisar(novoProjeto()),
    'file.open': () => avisar(abrirPorCaminho()),
    'file.openWorkspace': () => avisar(escolherProjeto()),
    'file.save': () => avisar(salvarArquivo()),
    'file.saveAs': () => avisar(salvarArquivo()),
    'file.preferences': () => avisar(abrirPreferencias()),
    'file.closeEditor': () => { if (ws.activeId !== null) ws.fechar(ws.activeId); },

    'edit.undo': () => document.execCommand('undo'),
    'edit.redo': () => document.execCommand('redo'),
    'edit.cut': () => document.execCommand('cut'),
    'edit.copy': () => document.execCommand('copy'),
    'edit.paste': () => avisar(navigator.clipboard.readText().then((t) => {
      document.execCommand('insertText', false, t);
    })),

    'selection.all': () => document.execCommand('selectAll'),

    'view.commandPalette': () => avisar(abrirPaleta()),
    'view.explorer': () => setPainelLateral('files'),
    'view.symbols': () => setPainelLateral('symbols'),
    'view.database': () => setPainelLateral('database'),
    'view.service': () => setPainelLateral('service'),
    'view.output': () => exec.limparSaida(),
    // Alterna e PERSISTE. A ação do Monaco alternaria e esqueceria — e o
    // usuário espera que a escolha sobreviva a recarregar a página.
    'view.wordWrap': () =>
      avisar(prefs.definir({ 'editor.wordWrap': !prefs.prefs['editor.wordWrap'] })),

    'go.file': () => avisar(abrirPorCaminho()),
    'go.symbol': () => setPainelLateral('symbols'),
    'go.line': () => avisar(irParaLinha()),

    'run.file': () => executar('file'),
    'run.selection': () => executar('block'),
    'run.disconnect': () => {
      const id = exec.conexaoAtiva;
      if (id !== null) avisar(conexoes.desconectar(id));
    },

    'terminal.new': () => ws.abrirTerminal(null, 'Terminal'),
    'terminal.connection': () => {
      const conexao = conexoes.acharConexao(exec.conexaoAtiva);
      if (conexao !== null) avisar(abrirTerminalDaConexao(conexao));
    },

    'help.commands': () => avisar(abrirPaleta()),
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

  const abrirFormulario = (conexao: PublicConnection | null, grupo?: string): void => {
    ws.abrirFormulario(
      conexao?.id ?? null,
      conexao === null ? 'Nova conexão' : conexao.label,
      grupo
    );
  };

  /**
   * Abre o terminal de uma conexão.
   *
   * Destranca o cofre antes: a credencial precisa ser resolvida do lado do
   * servidor para virar o arquivo temporário. Sem isso a aba abriria e falharia.
   */
  const abrirTerminalDaConexao = async (conexao: PublicConnection): Promise<void> => {
    if (!(await conexoes.garantirDestrancado())) return;
    ws.abrirTerminal(conexao.id, conexao.label);
  };

  /** Pede o padrão e aplica o filtro naquela categoria. */
  const filtrarCategoria = async (
    id: string,
    caminho: readonly string[],
    atual: string | null
  ): Promise<void> => {
    const padrao = await qi.pedir({
      titulo: 'Filtrar por nome',
      placeholder: 'ex.: alunos, tiraduvidas_%, %_2024',
      valorInicial: atual ?? '',
      // Vazio aqui é resposta, não desistência: é como se limpa o filtro.
      permiteVazio: true,
    });
    // Cancelar não mexe no filtro; apagar o texto é o que limpa (AC-9).
    if (padrao === null) return;
    await conexoes.definirFiltro(id, caminho, padrao);
  };

  /** Abre o esqueleto de criação numa aba de query, sem executar nada. */
  const novoObjeto = (id: string, caminho: readonly string[], no: TreeNode): void => {
    const template = typeof no.meta?.template === 'string' ? no.meta.template : '';
    if (template === '') return;
    exec.definirConexaoAtiva(id);
    ws.abrirQuery(`novo:${id}:${caminho.join('/')}`, `novo_${no.id}.sql`, template, id);
  };

  /**
   * Renomeia um grupo, arrastando os descendentes junto.
   *
   * A rota já reescreve o prefixo de todos os caminhos, então renomear "ACME"
   * move "ACME/Bancos" junto — é o que o usuário espera de uma pasta.
   */
  const renomearGrupo = async (caminho: string): Promise<void> => {
    const atual = caminho.split('/').pop() ?? caminho;
    const novo = await qi.pedir({
      titulo: `Renomear "${caminho}"`,
      placeholder: 'Novo nome do grupo',
      valorInicial: atual,
    });
    if (novo === null || novo.trim() === '' || novo.trim() === atual) return;

    const pai = caminho.includes('/') ? `${caminho.slice(0, caminho.lastIndexOf('/'))}/` : '';
    await Api.renameGroup(caminho, `${pai}${novo.trim()}`);
    await conexoes.recarregar();
  };
  const abaAtual = ws.activeId ?? '';

  const semAbas = ws.tabs.length === 0;
  const mostrarEditor =
    !semAbas &&
    ws.active?.type !== 'grid' &&
    ws.active?.type !== 'conexao' &&
    ws.active?.type !== 'terminal';

  return (
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
      <MenuBar contexto={contexto} onComando={executarComando} />

      <Box component="main" sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar
          width={lateral.width}
          painelAtivo={painelLateral}
          onPainelAtivo={setPainelLateral}
          onNovoProjeto={() => avisar(novoProjeto())}
          onErro={dialogs.aoFalhar}
          onAbrirArquivo={ws.abrirArquivo}
          projeto={projeto}
          onIrParaSimbolo={irParaSimbolo}
          caminhoAtivo={(ws.active?.meta as { path?: string | null } | undefined)?.path ?? null}
          conexoes={{
            ctrl: conexoes,
            onAbrirQuery: abrirQueryDoNo,
            onNovaConexao: (grupo?: string) => abrirFormulario(null, grupo),
            onRenomearGrupo: (caminho: string) => avisar(renomearGrupo(caminho)),
            onAbrirTerminal: (conexao: PublicConnection) => avisar(abrirTerminalDaConexao(conexao)),
            onFiltrar: (id, caminho, atual) => avisar(filtrarCategoria(id, caminho, atual)),
            onNovoObjeto: novoObjeto,
            onErro: dialogs.aoFalhar,
            onMenuNo: (e, id, caminho, no) =>
              menu.abrir(e, [
                { label: 'Copiar nome', onClick: () => copiar(no.label) },
                ...(no.actions === undefined || no.actions.length === 0 ? [] : [null]),
                ...(no.actions ?? []).map((acao) => ({
                  label: acao.label,
                  danger: acao.danger,
                  onClick: async () => {
                    if (acao.danger === true) {
                      const ok = await dialogs.confirmar({
                        titulo: acao.label,
                        mensagem: `"${acao.label}" em ${no.label}.\n\nEsta ação altera o servidor.`,
                        rotuloConfirmar: acao.label.toLowerCase(),
                        destrutivo: true,
                      });
                      if (!ok) return;
                    }
                    const r = await Api.runAction(id, { nodePath: caminho, actionId: acao.id });
                    ws.abrirQuery(`acao:${id}:${r.title}`, r.title, r.content, id);
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
                { label: 'Editar conexão…', onClick: () => abrirFormulario(conexao) },
                { label: 'Excluir conexão', danger: true, onClick: () => conexoes.excluir(conexao) },
              ]),
          }}
        />
        <Resizer dragging={lateral.dragging} onStart={lateral.startDrag} onReset={lateral.reset} />

        <Box
          component="section"
          sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
        >
          <TabBar
            tabs={ws.tabs}
            activeId={ws.activeId}
            onActivate={ws.ativar}
            onClose={ws.fechar}
            onExecutar={contexto.temEditor ? () => executar('file') : undefined}
            ehSql={ws.active?.type === 'sql'}
          />

          {/* O editor fica montado sempre: desmontá-lo ao ficar sem abas perderia
              a instância e a ref imperativa. Some de vista, não do DOM. */}
          <Box sx={{ flex: 1, display: mostrarEditor ? 'flex' : 'none', minHeight: 0 }}>
            <EditorHost
              ref={ws.editorRef}
              onChange={ws.marcarSujo}
              onCursor={ws.aoMoverCursor}
              fontSize={prefs.prefs['editor.fontSize']}
              tabSize={prefs.prefs['editor.tabSize']}
              wordWrap={prefs.prefs['editor.wordWrap']}
            />
          </Box>

          {ws.active?.type === 'grid' && (
            <ResultGrid {...(exec.grades.get(ws.active.id) ?? { resultado: null })} />
          )}

          {/* Cada terminal aberto fica MONTADO, e apenas some de vista.
              Renderizar só o ativo desmontaria o componente ao trocar de aba —
              o que mataria o processo e jogaria fora o que estava na tela.
              É a mesma regra do editor, algumas linhas acima. Desmontar só
              acontece quando a aba é fechada, e aí matar é o certo. */}
          {ws.tabs
            .filter((t) => t.type === 'terminal')
            .map((t) => (
              <Box
                key={t.id}
                sx={{
                  flex: 1,
                  minHeight: 0,
                  display: ws.activeId === t.id ? 'flex' : 'none',
                }}
              >
                <TerminalHost
                  ativo={ws.activeId === t.id}
                  fontSize={prefs.prefs['terminal.fontSize']}
                  connectionId={
                    typeof t.meta.connectionId === 'string' ? t.meta.connectionId : null
                  }
                />
              </Box>
            ))}

          {ws.active?.type === 'conexao' && (
            <ConnectionForm
              // Remonta ao trocar de conexão: o formulário guarda estado próprio,
              // e reaproveitar a instância misturaria os campos de duas conexões.
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
          )}

          {semAbas && (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: tokens.bgEditor,
                color: 'text.secondary',
                fontSize: 13,
              }}
            >
              Nenhuma aba aberta — abra um arquivo pela árvore lateral.
            </Box>
          )}

          <OutputPanel
            linhas={exec.saida}
            status={exec.status}
            onLimpar={exec.limparSaida}
          />
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
  );
}
