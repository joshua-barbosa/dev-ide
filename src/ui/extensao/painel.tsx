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
import { StrictMode, useCallback, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { PublicConnection, TreeNode } from '../../shared/contracts';
import { definirBaseDaApi } from '../api-http';
import { ConnectionsPanel } from '../connections/ConnectionsPanel';
import { useConnections } from '../connections/useConnections';
import { useContextMenu } from '../ContextMenu';
import { dialogosNativos } from './dialogos';
import { useMenusDeConexao } from '../acoes/useMenusDeConexao';
import { useAcoesRemotas } from '../acoes/useAcoesRemotas';
import {
  abrirDiagramaEr, baixarRemoto, escolherSimNao, escreverNaSaida, mostrarSaida, novaQuery,
  pedirSenha, pedirTexto, renomearQuery,
} from './acoes';
import { ComTemaDoEditor } from './ComTemaDoEditor';
import { aindaNao, ligarPonte, pedirAoHost, quandoOHostPedirRecarga } from './ponte';
import { Api } from '../api';
import type { Vinculo } from '../../shared/sql/vinculo';

/** O que o host injeta na página antes de carregar este pacote. */
declare const BRAYTECH: {
  readonly base: string;
  readonly painel: 'database' | 'service';
};

function Painel() {
  // As perguntas vão para a caixa do PRÓPRIO editor. Desenhá-las aqui dentro
  // daria o que ele fotografou: um diálogo espremido numa coluna de 300 px.
  const dialogs = useMemo(() => dialogosNativos(), []);
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
        mensagem: conteudo.slice(0, 4000),
        rotuloConfirmar: 'Executar',
        destrutivo: true,
      }),
    escreverNaSaida,
    mostrarSaida,
    recarregarNo: (id, caminho) => ctrl.recarregarNo(id, caminho),
    avisar: (p) => { void p.catch(falha); },
    somenteLeitura: (id) => ctrl.acharConexao(id)?.readOnly === true,
    // O `<a download>` do navegador não baixa nada dentro de uma webview do VS
    // Code. Quem salva é o host, com o diálogo nativo de "salvar como".
    baixarPeloHost: baixarRemoto,
  });

  /**
   * O cadastro vai para uma ABA do editor, não para uma caixa aqui dentro.
   *
   * Ele viu o formulário espremido nesta coluna, com rolagem dentro de rolagem,
   * e disse que ficava horrível — e estava certo: um driver como o MySQL declara
   * treze campos em quatro seções.
   */
  const abrirFormulario = useCallback((conexao: PublicConnection | null, grupo: string) => {
    pedirAoHost({
      tipo: 'abrirFormulario',
      conexaoId: conexao?.id ?? null,
      grupo,
      rotulo: conexao?.label ?? '',
    });
  }, []);

  // As abas gravam e avisam; quem redesenha a árvore é este painel. O aviso
  // pode mirar um ramo, para a árvore inteira não se recolher a cada gravação.
  const ctrlRef = useRef(ctrl);
  ctrlRef.current = ctrl;
  useEffect(
    () =>
      quandoOHostPedirRecarga((pedido) => {
        const c = ctrlRef.current;
        if (pedido.filtro !== undefined && pedido.conexaoId !== undefined) {
          void c.definirFiltro(
            pedido.conexaoId,
            pedido.caminho ?? [],
            pedido.filtro as Parameters<typeof c.definirFiltro>[2]
          );
          return;
        }
        if (pedido.conexaoId !== undefined) {
          void c.recarregarNo(pedido.conexaoId, pedido.caminho ?? []);
          return;
        }
        void c.recarregar();
      }),
    []
  );

  // O cofre pede a senha pela caixa nativa, com `password: true`.
  //
  // Antes disto NÃO havia nada: o `VaultDialog` mora no `App` da IDE, que não
  // existe aqui, então clicar no cadeado marcava o pedido e ficava parado para
  // sempre. Um botão que não faz nada é pior que um botão ausente.
  const pedido = ctrl.pedidoDeSenha;
  useEffect(() => {
    if (pedido === null) return;
    const c = ctrlRef.current;
    void (async () => {
      const titulos = {
        criar: 'Criar o cofre — escolha a senha-mestra',
        destrancar: 'Destrancar o cofre',
        trocar: 'Trocar a senha-mestra — senha ATUAL',
      };
      const senha = await pedirSenha(titulos[pedido.modo]);
      if (senha === null || senha === '') {
        c.cancelarSenha();
        return;
      }
      if (pedido.modo === 'trocar') {
        const nova = await pedirSenha('Trocar a senha-mestra — senha NOVA');
        if (nova === null || nova === '') {
          c.cancelarSenha();
          return;
        }
        await c.responderSenha(senha, false, nova);
        return;
      }
      // Lembrar é escolha dele, e o cofre diz se pode ser oferecida.
      const podeLembrar = c.estado?.vault.canRemember !== false;
      const lembrar =
        podeLembrar &&
        (await escolherSimNao('Lembrar o destrancamento neste computador?'));
      await c.responderSenha(senha, lembrar);
    })().catch(falha);
  }, [pedido, falha]);

  const menus = useMenusDeConexao({
    abrir: menu.abrir,
    copiar,
    abrirQuery,
    abrirFormulario: (conexao: PublicConnection) => abrirFormulario(conexao, ''),
    excluir: (conexao: PublicConnection) => ctrl.excluir(conexao),
    abrirTerminalDaConexao: async (conexao: PublicConnection) => {
      pedirAoHost({ tipo: 'abrirTerminal', connectionId: conexao.id, rotulo: conexao.label });
    },
    // `recarregarMetadados` LIMPA o cache inteiro; `recarregarNo(id, [])` só
    // rebusca a raiz e deixa as subárvores expandidas com dados velhos.
    recarregarMetadados: async (id: string) => {
      await ctrl.recarregarMetadados(id);
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
        onAbrirTabela={async (connectionId, nodePath, titulo, database) => {
          pedirAoHost({ tipo: 'abrirTabela', connectionId, nodePath, titulo, database,
            somenteLeitura: ctrl.acharConexao(connectionId)?.readOnly === true });
        }}
        onAbrirChave={(connectionId, chave) => {
          pedirAoHost({
            tipo: 'abrirChave', connectionId, chave,
            // Sem isto o visor de chave nasce EDITÁVEL numa conexão marcada
            // somente-leitura.
            somenteLeitura: ctrl.acharConexao(connectionId)?.readOnly === true,
          });
        }}
        onAbrirArquivoDeQuery={async (no: TreeNode, vinculo) => {
          // A chave é `caminho`, não `path`: eu tinha lido a errada, e por isso
          // clicar num .sql ou .sqlbook da árvore não abria nada.
          const caminho = typeof no.meta?.caminho === 'string' ? no.meta.caminho : null;
          if (caminho === null) return;
          if (caminho.endsWith('.sqlbook')) {
            // O caderno nasce AMARRADO: o vínculo vem da árvore, e sem ele o
            // bloco de SQL não teria contra quem rodar.
            pedirAoHost({
              tipo: 'abrirCaderno',
              caminho,
              connectionId: vinculo?.connectionId ?? null,
              database: vinculo?.database ?? null,
            });
            return;
          }
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
        onNovaConexao={(grupo?: string) => abrirFormulario(null, grupo ?? '')}
        // Os dois diálogos ricos do painel também vão para a área do editor:
        // são formulários, e formulário numa coluna de 300 px vira o que ele
        // fotografou.
        onPedirCriacao={(p) => pedirAoHost({ tipo: 'abrirDialogo', dialogo: 'criacao', pedido: p })}
        onPedirFiltro={(p) => pedirAoHost({ tipo: 'abrirDialogo', dialogo: 'filtro', pedido: p })}
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
          // O ramo onde o objeto vai nascer recarrega: sem isto, criar e não
          // ver é indistinguível de criar e falhar.
          void ctrl.recarregarNo(id, caminho);
        }}
        onNovaQuery={async (vinculo: Vinculo | null) => {
          if (vinculo === null) return;
          await novaQuery(vinculo);
          await ctrl.recarregarNo(vinculo.connectionId, []);
        }}
        onRenomearQuery={async (vinculo: Vinculo | null, no: TreeNode) => {
          if (vinculo === null) return;
          // O NOME do arquivo está no `meta`; o `label` vem sem o `.sql`.
          const nome = typeof no.meta?.nome === 'string' ? no.meta.nome : no.label;
          if (await renomearQuery(vinculo, nome)) {
            await ctrl.recarregarNo(vinculo.connectionId, []);
          }
        }}
        onApagarQuery={async (vinculo: Vinculo | null, no: TreeNode) => {
          if (vinculo === null) return;
          const nome = typeof no.meta?.nome === 'string' ? no.meta.nome : no.label;
          const ok = await dialogs.confirmar({
            titulo: 'Apagar query',
            mensagem: `Apagar "${nome}"? O arquivo sai do disco.`,
            rotuloConfirmar: 'Apagar',
          });
          if (!ok) return;
          await Api.deleteQuery(vinculo, nome);
          // A aba do arquivo apagado tem de fechar junto: deixá-la aberta
          // apontando para o que não existe mais é pior que não abrir.
          const caminho = typeof no.meta?.caminho === 'string' ? no.meta.caminho : null;
          if (caminho !== null) pedirAoHost({ tipo: 'fecharArquivo', caminho });
          await ctrl.recarregarNo(vinculo.connectionId, []);
        }}
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
      <ComTemaDoEditor>
        <Painel />
      </ComTemaDoEditor>
    </StrictMode>
  );
}
