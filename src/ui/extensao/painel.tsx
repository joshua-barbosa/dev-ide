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
import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { PublicConnection, TreeNode } from '../../shared/contracts';
import { definirBaseDaApi } from '../api-http';
import Dialog from '@mui/material/Dialog';
import { ConnectionForm } from '../connections/ConnectionForm';
import { ConnectionsPanel } from '../connections/ConnectionsPanel';
import { useConnections } from '../connections/useConnections';
import { useContextMenu } from '../ContextMenu';
import { useDialogs } from '../useDialogs';
import { useMenusDeConexao } from '../acoes/useMenusDeConexao';
import { criarTema } from '../theme';
import { useAcoesRemotas } from '../acoes/useAcoesRemotas';
import {
  abrirDiagramaEr, escreverNaSaida, mostrarSaida, novaQuery, pedirTexto, renomearQuery,
} from './acoes';
import { aindaNao, ligarPonte, pedirAoHost } from './ponte';
import { Api } from '../api';
import type { Vinculo } from '../../shared/sql/vinculo';

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

  const abrirArquivoRemoto = useCallback(
    async (conexaoId: string, caminho: string): Promise<void> => {
      // Vai como URI `braytech:`, que o host serve por um FileSystemProvider —
      // então o arquivo abre EDITÁVEL e o Ctrl+S grava no servidor. Abrir uma
      // cópia sem volta seria pior que não abrir: ele usa SSH justamente para
      // editar.
      pedirAoHost({ tipo: 'abrirArquivoRemoto', conexaoId, caminho });
    },
    []
  );

  // As ações remotas são as MESMAS da IDE (spec 053). O que muda é onde cada
  // janela acontece: pedir texto, saída e download vão para o VS Code.
  const acoesRemotas = useAcoesRemotas({
    copiar,
    pedir: (o) => pedirTexto({ titulo: o.titulo, placeholder: o.placeholder, valorInicial: o.valorInicial ?? '' }),
    confirmar: dialogs.confirmar,
    abrirArquivoRemoto,
    confirmarScript: async (nome, conteudo) =>
      dialogs.confirmar({
        titulo: `Executar ${nome}?`,
        mensagem: conteudo.slice(0, 2000),
        rotuloConfirmar: 'Executar',
        destrutivo: true,
      }),
    escreverNaSaida,
    mostrarSaida,
    recarregarNo: (id, caminho) => ctrl.recarregarNo(id, caminho),
    avisar: (p) => { void p.catch(falha); },
    somenteLeitura: (id) => ctrl.acharConexao(id)?.readOnly === true,
  });

  /** O formulário de conexão. Aberto num diálogo: aqui não há abas. */
  const [formulario, setFormulario] = useState<
    { readonly conexao: PublicConnection | null; readonly grupo: string } | null
  >(null);

  const menus = useMenusDeConexao({
    abrir: menu.abrir,
    copiar,
    abrirQuery,
    abrirFormulario: (conexao: PublicConnection) => setFormulario({ conexao, grupo: '' }),
    excluir: (conexao: PublicConnection) => ctrl.excluir(conexao),
    abrirTerminalDaConexao: async (conexao: PublicConnection) => {
      pedirAoHost({ tipo: 'abrirTerminal', connectionId: conexao.id, rotulo: conexao.label });
    },
    recarregarMetadados: async (id: string) => {
      await ctrl.recarregarNo(id, []);
    },
    abrirProcessos: () => aindaNao('Lista de processos'),
    // O `+` do cabeçalho e o do menu abrem o MESMO formulário.
    acoesRemotas,
    novaQuery: async (connectionId: string, no: TreeNode, tipo: 'sql' | 'sqlbook') => {
      const database = typeof no.meta?.database === 'string' ? no.meta.database : null;
      if (database === null) return;
      await novaQuery({ connectionId, database }, tipo);
      await ctrl.recarregarNo(connectionId, []);
    },
    diagramaEr: abrirDiagramaEr,
    // Quem sabe desenhar é a SESSÃO, e ela diz. Antes isto era `false` fixo, e
    // o item aparecia só para dizer que não existia.
    sabeDesenharEr: (id: string) => ctrl.capacidadesDe(id)?.diagramaEr === true,
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
        onAbrirArquivoRemoto={abrirArquivoRemoto}
        onAbrirServidor={() => aindaNao('Painel do servidor')}
        onAbrirTerminal={(conexao) => {
          pedirAoHost({ tipo: 'abrirTerminal', connectionId: conexao.id, rotulo: conexao.label });
        }}
        onNovaConexao={(grupo?: string) => setFormulario({ conexao: null, grupo: grupo ?? '' })}
        onRenomearGrupo={async (caminho: string) => {
          const novo = await pedirTexto({ titulo: 'Novo nome do grupo', valorInicial: caminho });
          if (novo === null || novo.trim() === '' || novo.trim() === caminho) return;
          await Api.renameGroup(caminho, novo.trim());
          await ctrl.recarregar();
        }}
        onDiagramaEr={abrirDiagramaEr}
        onNovoObjeto={(id, caminho, nomeBase, sql, database) => {
          pedirAoHost({
            tipo: 'abrirQuery', connectionId: id, database,
            titulo: `${nomeBase}.sql`, conteudo: sql,
          });
          void caminho;
        }}
        onNovaQuery={async (vinculo: Vinculo | null) => {
          if (vinculo === null) return;
          await novaQuery(vinculo);
          await ctrl.recarregarNo(vinculo.connectionId, []);
        }}
        onRenomearQuery={async (vinculo: Vinculo | null, no: TreeNode) => {
          if (vinculo === null) return;
          if (await renomearQuery(vinculo, no.label)) {
            await ctrl.recarregarNo(vinculo.connectionId, []);
          }
        }}
        onApagarQuery={async (vinculo: Vinculo | null, no: TreeNode) => {
          if (vinculo === null) return;
          const ok = await dialogs.confirmar({
            titulo: 'Apagar query',
            mensagem: `Apagar "${no.label}"? Isto não tem volta.`,
            rotuloConfirmar: 'Apagar',
          });
          if (!ok) return;
          await Api.deleteQuery(vinculo, no.label);
          await ctrl.recarregarNo(vinculo.connectionId, []);
        }}
        onErro={falha}
        confirmar={dialogs.confirmar}
        avisar={dialogs.avisar}
      />
      {menu.elemento}
      {dialogs.elemento}
      <Dialog
        open={formulario !== null}
        onClose={() => setFormulario(null)}
        maxWidth="md"
        fullWidth
      >
        {formulario !== null && (
          <ConnectionForm
            // Remonta ao trocar de conexão: o formulário guarda estado próprio,
            // e reaproveitar a instância misturaria os campos de duas conexões.
            key={formulario.conexao?.id ?? 'nova'}
            drivers={[...ctrl.drivers.values()]}
            gruposConhecidos={ctrl.grupos}
            conexao={formulario.conexao}
            grupoInicial={formulario.grupo}
            onSujar={() => undefined}
            onCancelar={() => setFormulario(null)}
            onSalvar={async (input, conectar) => {
              await ctrl.salvarConexao(input, formulario.conexao?.id ?? null, conectar);
              setFormulario(null);
            }}
          />
        )}
      </Dialog>
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
