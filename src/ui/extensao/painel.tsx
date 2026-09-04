// O painel de conexões da IDE, dentro do VS Code.
//
// **Não é uma imitação: é o MESMO componente.** Ele pediu *"exatamente o que
// fizemos no DATABASES e SERVICES da nossa IDE"*, e a primeira tentativa — a
// árvore nativa do editor — sempre ia ficar um passo atrás: ícone traduzido à
// mão que não bate, menu de contexto virando lista de opções, ação que existe
// lá e não aqui. Cada um desses ele encontrou em minutos de uso.
//
// Aqui rodam `ConnectionsPanel`, `useConnections`, `useMenusDeConexao`,
// `useContextMenu` e `useDialogs` — os originais. O que cruza para o VS Code é
// só ABRIR: query, tabela, chave, terminal. Ver `ponte.ts`.
import { StrictMode, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { PublicConnection, TreeNode } from '../../shared/contracts';
import { definirBaseDaApi } from '../api-http';
import { ConnectionsPanel } from '../connections/ConnectionsPanel';
import { useConnections } from '../connections/useConnections';
import { useContextMenu } from '../ContextMenu';
import { useDialogs } from '../useDialogs';
import { useMenusDeConexao } from '../acoes/useMenusDeConexao';
import { criarTema } from '../theme';
import { aindaNao, ligarPonte, pedirAoHost } from './ponte';

/** O que o host injeta na página antes de carregar este pacote. */
declare const BRAYTECH: {
  readonly base: string;
  readonly painel: 'database' | 'service';
};

function Painel() {
  const dialogs = useDialogs();
  const falha = useCallback((erro: unknown) => {
    pedirAoHost({
      tipo: 'erro',
      mensagem: erro instanceof Error ? erro.message : String(erro),
    });
  }, []);

  const ctrl = useConnections({ confirmar: dialogs.confirmar });
  const menu = useContextMenu(falha);

  const copiar = useCallback((texto: string) => {
    pedirAoHost({ tipo: 'copiar', texto });
  }, []);

  const abrirQuery = useCallback(
    (
      _id: string,
      titulo: string,
      conteudo: string,
      connectionId: string,
      database: string | null
    ) => {
      pedirAoHost({ tipo: 'abrirQuery', connectionId, database, titulo, conteudo });
    },
    []
  );

  // As ações remotas (SFTP) ainda não têm par no VS Code; o menu delas fica
  // vazio, e é isso que faz o menu comum aparecer no lugar.
  const acoesRemotas = useMemo(
    () => ({
      menu: () => [] as readonly unknown[],
      favoritar: async () => aindaNao('Favoritar arquivo remoto'),
      baixar: async () => aindaNao('Baixar arquivo remoto'),
      executarScript: async () => aindaNao('Executar script remoto'),
    }),
    []
  );

  const menus = useMenusDeConexao({
    abrir: menu.abrir,
    copiar,
    abrirQuery,
    abrirFormulario: () => aindaNao('Cadastro de conexão'),
    excluir: async () => aindaNao('Excluir conexão'),
    abrirTerminalDaConexao: async (conexao: PublicConnection) => {
      pedirAoHost({ tipo: 'abrirTerminal', connectionId: conexao.id, rotulo: conexao.label });
    },
    recarregarMetadados: async (id: string) => {
      await ctrl.recarregarNo(id, []);
    },
    abrirProcessos: () => aindaNao('Lista de processos'),
    acoesRemotas,
    novaQuery: async () => aindaNao('Nova query'),
    diagramaEr: async () => aindaNao('Diagrama ER'),
    sabeDesenharEr: () => false,
    // As mesmas duas linhas do `App`: a conexão aberta vem do estado do cofre,
    // e o somente-leitura é campo da própria conexão.
    estaAberta: (id: string) => ctrl.estado?.openIds.includes(id) === true,
    desconectar: (id: string) => ctrl.desconectar(id),
    abrirConexao: (conexao: PublicConnection) => ctrl.abrirConexao(conexao),
    confirmar: dialogs.confirmar,
  });

  return (
    <>
      <ConnectionsPanel
        painel={BRAYTECH.painel}
        ctrl={ctrl}
        acoesRemotas={acoesRemotas}
        somenteLeitura={(id) => ctrl.acharConexao(id)?.readOnly === true}
        onMenuNo={menus.onMenuNo}
        onMenuConexao={menus.onMenuConexao}
        onAbrirQuery={(id, no, database) => {
          const objeto = typeof no.meta?.object === 'string' ? no.meta.object : no.label;
          const schema = typeof no.meta?.schema === 'string' ? no.meta.schema : null;
          const alvo = schema === null ? objeto : `${schema}.${objeto}`;
          pedirAoHost({
            tipo: 'abrirQuery',
            connectionId: id,
            database,
            titulo: `${objeto}.sql`,
            conteudo: `SELECT * FROM ${alvo} LIMIT 100;`,
          });
        }}
        onAbrirTabela={async (connectionId, nodePath, titulo) => {
          pedirAoHost({ tipo: 'abrirTabela', connectionId, nodePath, titulo });
        }}
        onAbrirChave={(connectionId, chave) => {
          pedirAoHost({ tipo: 'abrirChave', connectionId, chave });
        }}
        onAbrirArquivoDeQuery={async (no: TreeNode) => {
          const caminho = typeof no.meta?.path === 'string' ? no.meta.path : null;
          if (caminho === null) return;
          pedirAoHost({ tipo: 'abrirArquivo', caminho });
        }}
        onAbrirQueryDoDatabase={async (connectionId, no) => {
          const database = typeof no.meta?.database === 'string' ? no.meta.database : null;
          if (database === null) return;
          pedirAoHost({
            tipo: 'abrirQuery', connectionId, database,
            titulo: `${database}.sql`, conteudo: '',
          });
        }}
        onAbrirArquivoRemoto={async () => aindaNao('Abrir arquivo remoto (SFTP)')}
        onAbrirServidor={() => aindaNao('Painel do servidor')}
        onAbrirTerminal={(conexao) => {
          pedirAoHost({ tipo: 'abrirTerminal', connectionId: conexao.id, rotulo: conexao.label });
        }}
        onNovaConexao={() => aindaNao('Cadastro de conexão')}
        onRenomearGrupo={() => aindaNao('Renomear grupo')}
        onDiagramaEr={async () => aindaNao('Diagrama ER')}
        onNovoObjeto={() => aindaNao('Criar objeto')}
        onNovaQuery={async () => aindaNao('Nova query')}
        onRenomearQuery={async () => aindaNao('Renomear query')}
        onApagarQuery={async () => aindaNao('Apagar query')}
        onErro={falha}
        confirmar={dialogs.confirmar}
        avisar={dialogs.avisar}
      />
      {menu.elemento}
      {dialogs.elemento}
    </>
  );
}

// A ordem importa: a ponte instala o transporte, e só depois o painel monta e
// começa a pedir. A base só vale fora do VS Code, onde não há ponte.
ligarPonte();
definirBaseDaApi(BRAYTECH.base);

const raiz = document.getElementById('raiz');
if (raiz !== null) {
  createRoot(raiz).render(
    <StrictMode>
      <ThemeProvider theme={criarTema('escuro')}>
        <CssBaseline />
        <Painel />
      </ThemeProvider>
    </StrictMode>
  );
}
