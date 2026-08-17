// Esqueleto da interface: a moldura que os painéis preenchem.
//
// A estrutura é a mesma de antes — barra de ferramentas, lateral, divisória,
// área de editor com abas e saída, barra de status — porque o critério desta
// migração é paridade, não redesenho.
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { tokens } from './theme';
import { Sidebar } from './Sidebar';
import { Resizer } from './Resizer';
import { useSidebarWidth } from './useSidebarWidth';
import { useWorkspace } from './useWorkspace';
import { EditorHost } from './editor/EditorHost';
import { TabBar } from './tabs/TabBar';
import { useConnections } from './connections/useConnections';
import { useContextMenu } from './ContextMenu';
import { Api } from './api';
import { Toolbar } from './Toolbar';
import { ResultGrid } from './grid/ResultGrid';
import { OutputPanel } from './OutputPanel';
import { useExecution } from './useExecution';
import { useProject } from './files/useProject';

export function App() {
  const lateral = useSidebarWidth();
  const ws = useWorkspace();
  const conexoes = useConnections();
  const menu = useContextMenu();
  const exec = useExecution(ws);
  const projeto = useProject();
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
    void exec.executar(modo, linguagem).catch((e: Error) => window.alert(e.message));
  };

  const novoArquivo = (): void => {
    const conteudo = ws.active === null ? '' : (ws.editorRef.current?.getValue() ?? '');
    projeto
      .criarArquivo(conteudo)
      .then((caminho) => (caminho === null ? undefined : ws.abrirArquivo(caminho)))
      .catch((e: Error) => window.alert(e.message));
  };

  /** Abre o arquivo do símbolo, se preciso, e pula para a linha. */
  const irParaSimbolo = (arquivo: string, linha: number): void => {
    const atual = (ws.active?.meta as { path?: string | null } | undefined)?.path ?? null;
    const pular = () => window.setTimeout(() => ws.editorRef.current?.goToLine(linha), 0);
    if (arquivo === atual) {
      pular();
      return;
    }
    ws.abrirArquivo(arquivo).then(pular).catch((e: Error) => window.alert(e.message));
  };

  const abrirPorCaminho = (): void => {
    const caminho = window.prompt('Caminho do arquivo para abrir (absoluto):');
    if (caminho === null || caminho.trim() === '') return;
    ws.abrirArquivo(caminho.trim()).catch((e: Error) => window.alert(e.message));
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

  // Ctrl+S salva a aba ativa.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void ws.salvar().catch((err: Error) => window.alert(err.message));
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executar('file');
      }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [ws]);

  const semAbas = ws.tabs.length === 0;
  const mostrarEditor = !semAbas && ws.active?.type !== 'grid';

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
      <Toolbar
        linguagem={linguagem}
        onLinguagem={trocarLinguagem}
        onNovo={novoArquivo}
        onAbrir={abrirPorCaminho}
        onSalvar={() =>
          void ws
            .salvar()
            .then(() => projeto.recarregar())
            .catch((e: Error) => window.alert(e.message))
        }
        onExecutar={executar}
        ehSql={ws.active?.type === 'sql'}
      />

      <Box component="main" sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar
          width={lateral.width}
          onAbrirArquivo={ws.abrirArquivo}
          projeto={projeto}
          onIrParaSimbolo={irParaSimbolo}
          caminhoAtivo={(ws.active?.meta as { path?: string | null } | undefined)?.path ?? null}
          conexoes={{
            ctrl: conexoes,
            onAbrirQuery: abrirQueryDoNo,
            onMenuNo: (e, id, caminho, no) =>
              menu.abrir(e, [
                { label: 'Copiar nome', onClick: () => copiar(no.label) },
                ...(no.actions === undefined || no.actions.length === 0 ? [] : [null]),
                ...(no.actions ?? []).map((acao) => ({
                  label: acao.label,
                  danger: acao.danger,
                  onClick: async () => {
                    if (acao.danger === true) {
                      const ok = window.confirm(`"${acao.label}" em ${no.label}.\n\nConfirmar?`);
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
                { label: 'Editar conexão…', onClick: () => window.alert('Formulário de conexão — próxima spec.') },
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
          />

          {/* O editor fica montado sempre: desmontá-lo ao ficar sem abas perderia
              a instância e a ref imperativa. Some de vista, não do DOM. */}
          <Box sx={{ flex: 1, display: mostrarEditor ? 'flex' : 'none', minHeight: 0 }}>
            <EditorHost ref={ws.editorRef} onChange={ws.marcarSujo} onCursor={ws.aoMoverCursor} />
          </Box>

          {ws.active?.type === 'grid' && (
            <ResultGrid {...(exec.grades.get(ws.active.id) ?? { resultado: null })} />
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

      <Box
        component="footer"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.25,
          py: 0.4,
          bgcolor: 'background.paper',
          borderTop: 1,
          borderColor: 'divider',
          color: 'text.secondary',
          fontFamily: tokens.fontMono,
          fontSize: 11,
        }}
      >
        <span>{ws.active === null ? 'nenhum arquivo' : ws.active.title}</span>
        {ws.active?.dirty === true && (
          <Box component="span" sx={{ color: 'primary.main' }}>
            ● não salvo
          </Box>
        )}
        <Box component="span" sx={{ ml: 'auto' }}>
          Ln {ws.cursor.linha}, Col {ws.cursor.coluna}
        </Box>
      </Box>

      {menu.elemento}
    </Box>
  );
}
