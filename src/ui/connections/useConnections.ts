// Estado dos painéis de conexão.
//
// Um só gancho serve Database e Service: o que muda entre eles é apenas o
// filtro de painel, declarado por cada driver. Expansão e cache de filhos são
// compartilhados de propósito — as duas árvores nunca mostram a mesma conexão,
// então não há como uma confundir a outra.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SessionCapabilities,
  ConnectionInput, ConnectionsState, GroupNode, PublicConnection, TreeNode,
} from '../../shared/contracts';
import { gruposExistentes } from '../../shared/connections/form';
import { padraoDeFiltro } from '../../shared/tree/filtro';
import {
  estaVazio,
  interpretarData,
  interpretarTamanho,
  type FiltroDaArvore,
} from '../../shared/tree/filtro-da-arvore';
import {
  chaveDoNo, expansoesSemAConexao, filhosSemAConexao,
} from '../../shared/connections/arvore-aberta';
import { Api, type CriteriosDeArvore, type DriverInfo } from '../api';
import type { ArquivoDeQuery, Vinculo } from '../../shared/sql/vinculo';

/**
 * O nó da categoria `Query`, injetado pela interface sob cada database.
 *
 * `__queries__` com underscores dos dois lados para não colidir com nome de
 * categoria vindo de driver — `tables`, `views`, `functions`, `procedures`.
 */
export const ID_DE_QUERIES = '__queries__';

function noDeQueries(database: string): TreeNode {
  return {
    id: ID_DE_QUERIES,
    label: 'Query',
    icon: 'query',
    hasChildren: true,
    meta: { queries: true, database },
  };
}

/** Um arquivo `.sql` salvo, como nó de árvore. */
function noDeArquivo(arquivo: ArquivoDeQuery): TreeNode {
  return {
    id: arquivo.nome,
    label: arquivo.nome.replace(/\.sql$/i, ''),
    icon: 'query',
    hasChildren: false,
    meta: { arquivoDeQuery: true, nome: arquivo.nome, caminho: arquivo.caminho },
  };
}

/**
 * O vínculo de um caminho de árvore que termina na categoria `Query`.
 *
 * O database é o penúltimo pedaço, e isso vale para os três drivers:
 * `[main, __queries__]` no SQLite, `[server, servidor-2, __queries__]` no MySQL,
 * `[server, nuntius, __queries__]` no PostgreSQL.
 */
function vinculoDoCaminho(connectionId: string, caminho: readonly string[]): Vinculo | null {
  if (caminho[caminho.length - 1] !== ID_DE_QUERIES) return null;
  const database = caminho[caminho.length - 2];
  return database === undefined ? null : { connectionId, database };
}

/**
 * O filtro da tela traduzido para o que viaja na rede.
 *
 * O nome vira padrão de `LIKE` e o tamanho vira bytes AQUI, uma vez só. Mandar
 * o texto cru e interpretar no servidor daria duas interpretações da mesma
 * frase, e elas divergiriam.
 */
function criteriosDe(filtro: FiltroDaArvore | undefined): CriteriosDeArvore | undefined {
  if (filtro === undefined) return undefined;
  return {
    filtro: padraoDeFiltro(filtro.nome),
    dono: filtro.dono === '' ? null : filtro.dono,
    minBytes: filtro.tamanho === '' ? null : interpretarTamanho(filtro.tamanho),
    desde: filtro.desde === '' ? null : interpretarData(filtro.desde, new Date()),
  };
}

/** Chave de cache: id da conexão mais o caminho do nó. */
/** A chave do cache de filhos. A montagem mora em `shared` e é testada lá. */
const chaveDe = chaveDoNo;

/** Um pedido de senha em aberto — o que o diálogo precisa saber para se desenhar. */
export interface PedidoDeSenha {
  /** `trocar` pede DUAS senhas: a atual e a nova (T100). */
  readonly modo: 'criar' | 'destrancar' | 'trocar';
}

export interface ConnectionsController {
  readonly pedidoDeSenha: PedidoDeSenha | null;
  responderSenha(senha: string, lembrar: boolean, nova?: string): Promise<void>;
  cancelarSenha(): void;
  readonly estado: ConnectionsState | null;
  readonly drivers: ReadonlyMap<string, DriverInfo>;
  readonly erro: string | null;
  readonly expandidos: ReadonlySet<string>;
  readonly filhos: ReadonlyMap<string, readonly TreeNode[]>;
  readonly carregando: ReadonlySet<string>;
  recarregar(): Promise<void>;
  criarCofre(): Promise<void>;
  destrancar(): Promise<void>;
  /** Troca a senha mestra, recifrando todos os segredos (T100). */
  trocarSenha(): Promise<void>;
  trancar(): Promise<void>;
  alternarGrupo(caminho: string): void;
  recolherTudo(): void;
  abrirConexao(conexao: PublicConnection): Promise<void>;
  desconectar(id: string): Promise<void>;
  alternarNo(id: string, caminho: readonly string[], no?: TreeNode): Promise<void>;
  recarregarMetadados(id: string): Promise<void>;
  excluir(conexao: PublicConnection): Promise<void>;
  salvarConexao(input: ConnectionInput, id: string | null, conectar: boolean): Promise<void>;
  readonly grupos: readonly string[];
  acharConexao(id: unknown): PublicConnection | null;
  /** Todas as conexões, achatadas — a árvore é aninhada, a escolha não é. */
  todasAsConexoes(): readonly PublicConnection[];
  /** Filtro em vigor num nó de categoria, ou `null`. */
  filtroDe(id: string, caminho: readonly string[]): FiltroDaArvore | null;
  definirFiltro(id: string, caminho: readonly string[], filtro: FiltroDaArvore): Promise<void>;
  /** Recarrega só este nó, preservando o resto da árvore. */
  recarregarNo(id: string, caminho: readonly string[]): Promise<void>;
  /** Garante o cofre aberto, pedindo a senha se preciso. Falso = cancelado. */
  garantirDestrancado(): Promise<boolean>;
  chaveDe(id: string, caminho: readonly string[]): string;
  /** O que o servidor respondeu sobre si — a distro, no caso do SSH. */
  descricaoDe(id: string): string | null;
  /** O que a sessão sabe fazer — é o que liga as sub-abas do servidor. */
  capacidadesDe(id: string): SessionCapabilities | null;
}

/** Mesma injeção do workspace: quem desenha o diálogo é o App. */
export interface ConnectionsDeps {
  confirmar(opcoes: {
    titulo?: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
}

export function useConnections({ confirmar }: ConnectionsDeps): ConnectionsController {
  const [estado, setEstado] = useState<ConnectionsState | null>(null);
  const [drivers, setDrivers] = useState<ReadonlyMap<string, DriverInfo>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<ReadonlySet<string>>(new Set());
  const [filhos, setFilhos] = useState<ReadonlyMap<string, readonly TreeNode[]>>(new Map());
  const [carregando, setCarregando] = useState<ReadonlySet<string>>(new Set());

  const recarregar = useCallback(async () => {
    setEstado(await Api.connections());
  }, []);

  useEffect(() => {
    Promise.all([Api.drivers(), Api.connections()])
      .then(([lista, atual]) => {
        setDrivers(new Map(lista.map((d) => [d.type, d])));
        setEstado(atual);
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  const [pedidoDeSenha, setPedidoDeSenha] = useState<PedidoDeSenha | null>(null);
  const respostaPendente = useRef<((destrancou: boolean) => void) | null>(null);

  /**
   * Abre o diálogo de senha e só resolve quando o usuário responde.
   *
   * Existe porque clicar numa conexão com o cofre trancado precisa ESPERAR o
   * destrancamento antes de seguir — era o que o `prompt()` do navegador dava de
   * graça, e o que um diálogo desenhado precisa recriar à mão.
   */
  const pedirSenha = useCallback((modo: PedidoDeSenha['modo']): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // Um pedido em aberto por vez: quem chegar depois herda o mesmo resultado.
      respostaPendente.current?.(false);
      respostaPendente.current = resolve;
      setPedidoDeSenha({ modo });
    });
  }, []);

  /**
   * Responde ao diálogo. O erro de senha errada sobe de propósito: quem mostra é
   * o diálogo, que precisa continuar aberto com o que foi digitado.
   */
  const responderSenha = useCallback(
    async (senha: string, lembrar: boolean, nova?: string) => {
      const pedido = pedidoDeSenha;
      if (pedido === null) return;
      if (pedido.modo === 'criar') await Api.createVault(senha, lembrar);
      else if (pedido.modo === 'trocar') {
        await Api.trocarSenhaMestra(senha, nova ?? '', lembrar);
      } else await Api.unlockVault(senha, lembrar);

      setPedidoDeSenha(null);
      await recarregar();
      respostaPendente.current?.(true);
      respostaPendente.current = null;
    },
    [pedidoDeSenha, recarregar]
  );

  const cancelarSenha = useCallback(() => {
    setPedidoDeSenha(null);
    respostaPendente.current?.(false);
    respostaPendente.current = null;
  }, []);

  const marcar = useCallback((conjunto: ReadonlySet<string>, chave: string, ligado: boolean) => {
    const proximo = new Set(conjunto);
    if (ligado) proximo.add(chave);
    else proximo.delete(chave);
    return proximo;
  }, []);

  /**
   * Garante o cofre destrancado, pedindo a senha na hora. Clicar numa conexão
   * é intenção clara de usá-la; recusar e mandar procurar o botão seria pior.
   * Devolve false se o usuário cancelou — aí a ação só desiste, sem alarde.
   */
  const garantirDestrancado = useCallback(async (): Promise<boolean> => {
    if (estado?.vault.unlocked === true) return true;
    return pedirSenha('destrancar');
  }, [estado, pedirSenha]);

  const criarCofre = useCallback(async () => {
    await pedirSenha('criar');
  }, [pedirSenha]);

  const destrancar = useCallback(async () => {
    await pedirSenha('destrancar');
  }, [pedirSenha]);

  const trocarSenha = useCallback(async () => {
    await pedirSenha('trocar');
  }, [pedirSenha]);

  const trancar = useCallback(async () => {
    await Api.lockVault();
    // Trancar fecha as sessões no servidor; o que estava expandido não vale mais.
    setExpandidos(new Set());
    setFilhos(new Map());
    await recarregar();
  }, [recarregar]);

  /**
   * Recolhe grupos, conexões e nós de uma vez.
   *
   * O cache de filhos é preservado: recolher é gesto de arrumação, não de
   * descarte — reabrir não deve custar outra ida ao servidor.
   */
  const recolherTudo = useCallback(() => {
    setExpandidos(new Set());
  }, []);

  const alternarGrupo = useCallback(
    (caminho: string) => {
      const chave = `grupo:${caminho}`;
      setExpandidos((atual) => marcar(atual, chave, !atual.has(chave)));
    },
    [marcar]
  );

  // Filtros por `conexão + caminho`: filtrar as tabelas de um schema não pode
  // mexer noutro (AC-10).
  const [filtros, setFiltros] = useState<ReadonlyMap<string, FiltroDaArvore>>(new Map());
  const filtrosRef = useRef(filtros);
  filtrosRef.current = filtros;

  /**
   * Os filtros guardados de uma conexão, do disco para a memória (T111).
   *
   * As chaves vêm do servidor no mesmo formato de `chaveDe` sem o id — juntar
   * os dois aqui é o que faz o filtro reencontrar o nó a que pertence.
   */
  const carregarFiltros = useCallback(async (id: string) => {
    try {
      const guardados = await Api.treeFilters(id);
      const proximo = new Map(filtrosRef.current);
      for (const [caminho, filtro] of Object.entries(guardados)) {
        proximo.set([id, caminho].join('\u0000'), filtro);
      }
      filtrosRef.current = proximo;
      setFiltros(proximo);
    } catch {
      // Sem filtro guardado a árvore abre inteira — nunca deixa de abrir.
    }
  }, []);

  const buscarFilhos = useCallback(
    async (id: string, caminho: readonly string[], noPai?: TreeNode) => {
      const chave = chaveDe(id, caminho);
      setCarregando((atual) => marcar(atual, chave, true));
      try {
        // A categoria `Query` é NOSSA, não do driver: os arquivos são da IDE, e
        // pedir que cada driver liste arquivos que ele não conhece inverteria o
        // Artigo III. O driver declara que o nó é um database (`meta.database`);
        // a interface decide que isso merece uma pasta de queries (spec 038).
        // Reconhecido pelo CAMINHO, e não pelo nó: `recarregarNo` só recebe o
        // caminho, e sem isto criar um arquivo não o fazia aparecer — a árvore
        // ia pedir filhos ao DRIVER, que não sabe dos nossos arquivos. Achado
        // pelo teste de ponta a ponta.
        const vinculo = vinculoDoCaminho(id, caminho);
        if (vinculo !== null) {
          const arquivos = await Api.listQueries(vinculo);
          setFilhos((atual) => new Map(atual).set(chave, arquivos.map(noDeArquivo)));
          return;
        }

        // Lido por ref: `buscarFilhos` é chamado de dentro de outros callbacks,
        // e depender do valor capturado buscaria com o filtro de um render atrás.
        const nos = await Api.children(id, caminho, criteriosDe(filtrosRef.current.get(chave)));
        const database = typeof noPai?.meta?.database === 'string' ? noPai.meta.database : null;
        setFilhos((atual) =>
          new Map(atual).set(chave, database === null ? nos : [noDeQueries(database), ...nos])
        );
      } finally {
        setCarregando((atual) => marcar(atual, chave, false));
      }
    },
    [marcar]
  );

  const [descricoes, setDescricoes] = useState<ReadonlyMap<string, string>>(new Map());
  const [capacidades, setCapacidades] = useState<ReadonlyMap<string, SessionCapabilities>>(
    new Map()
  );

  const abrirConexao = useCallback(
    async (conexao: PublicConnection) => {
      const chave = `conn:${conexao.id}`;
      if (expandidos.has(chave)) {
        setExpandidos((atual) => marcar(atual, chave, false));
        return;
      }
      if (!(await garantirDestrancado())) return;

      setExpandidos((atual) => marcar(atual, chave, true));
      try {
        const caps = await Api.connect(conexao.id);
        setCapacidades((atual) => new Map(atual).set(conexao.id, caps));
        // Os filtros guardados entram ANTES da primeira listagem (T111): depois
        // seria uma árvore montada sem filtro e remontada com ele — piscando, e
        // com uma ida ao servidor a mais por categoria.
        await carregarFiltros(conexao.id);
        await buscarFilhos(conexao.id, []);
        await recarregar(); // atualiza openIds, que marca a conexão como viva
        // A descrição vem DEPOIS e sem travar a árvore: ela é enfeite útil, e
        // esperar por ela adiaria o que o usuário clicou para ver.
        Api.describe(conexao.id)
          .then((texto) => {
            if (texto !== null) {
              setDescricoes((atual) => new Map(atual).set(conexao.id, texto));
            }
          })
          .catch(() => {
            // Um servidor que não sabe se descrever não é um erro de conexão.
          });
      } catch (e) {
        setExpandidos((atual) => marcar(atual, chave, false));
        throw new Error(
          `Não foi possível conectar em "${conexao.label}":\n\n${(e as Error).message}`
        );
      }
    },
    [buscarFilhos, carregarFiltros, expandidos, garantirDestrancado, marcar, recarregar]
  );

  /**
   * Fecha UMA conexão.
   *
   * **O cache de filhos é limpo só do que é dela.** Ele era zerado inteiro, e
   * como a chave começa pelo id da conexão, isso apagava a árvore já carregada
   * de TODAS as outras: elas continuavam expandidas, sem filhos, e a tela ficava
   * igual à de quem desconectou tudo. O servidor sempre fechou só a pedida — o
   * estrago era só aqui.
   *
   * As marcas de expansão dos nós internos também saem: reconectar depois com
   * `expandidos` cheio faria a árvore tentar reabrir ramos que ainda não têm
   * filhos, disparando uma busca por nó de uma vez só.
   */
  const desconectar = useCallback(
    async (id: string) => {
      await Api.disconnect(id);
      setExpandidos((atual) => expansoesSemAConexao(atual, id));
      setFilhos((atual) => filhosSemAConexao(atual, id));
      await recarregar();
    },
    [recarregar]
  );

  const alternarNo = useCallback(
    async (id: string, caminho: readonly string[], no?: TreeNode) => {
      const chave = `no:${chaveDe(id, caminho)}`;
      if (expandidos.has(chave)) {
        setExpandidos((atual) => marcar(atual, chave, false));
        return;
      }
      setExpandidos((atual) => marcar(atual, chave, true));
      if (!filhos.has(chaveDe(id, caminho))) {
        try {
          await buscarFilhos(id, caminho, no);
        } catch (e) {
          setExpandidos((atual) => marcar(atual, chave, false));
          throw e;
        }
      }
    },
    [buscarFilhos, expandidos, filhos, marcar]
  );

  const filtroDe = useCallback(
    (id: string, caminho: readonly string[]): FiltroDaArvore | null =>
      filtros.get(chaveDe(id, caminho)) ?? null,
    [filtros]
  );

  /** Recarrega um nó só. O resto da árvore nem percebe. */
  const recarregarNo = useCallback(
    async (id: string, caminho: readonly string[]) => {
      await buscarFilhos(id, caminho);
    },
    [buscarFilhos]
  );

  const definirFiltro = useCallback(
    async (id: string, caminho: readonly string[], filtro: FiltroDaArvore) => {
      const chave = chaveDe(id, caminho);
      const proximo = new Map(filtrosRef.current);
      if (estaVazio(filtro)) proximo.delete(chave);
      else proximo.set(chave, filtro);

      // Atualiza a ref antes de buscar: `buscarFilhos` lê dela, e o `setState`
      // ainda não teria surtido efeito.
      filtrosRef.current = proximo;
      setFiltros(proximo);
      // Guardar não pode segurar a lista: o filtro já está em vigor na tela, e
      // esperar o disco só adiaria o que ele pediu (T111).
      Api.saveTreeFilter(id, caminho, filtro).catch(() => {
        // Não conseguir guardar não desfaz o filtro desta sessão.
      });
      await buscarFilhos(id, caminho);
    },
    [buscarFilhos]
  );

  const recarregarMetadados = useCallback(
    async (id: string) => {
      setFilhos(new Map());
      await buscarFilhos(id, []);
    },
    [buscarFilhos]
  );

  /**
   * Grava a conexão e, opcionalmente, já abre a sessão.
   *
   * Destrancar vem antes de gravar porque é aí que o segredo precisa ser
   * cifrado — abrir o formulário com o cofre trancado é legítimo.
   */
  const salvarConexao = useCallback(
    async (input: ConnectionInput, id: string | null, conectar: boolean) => {
      if (!(await garantirDestrancado())) {
        throw new Error('O cofre precisa estar destrancado para salvar.');
      }

      const salva = id === null
        ? await Api.createConnection(input)
        : await Api.updateConnection(id, input);
      await recarregar();

      if (conectar) await abrirConexao(salva);
    },
    [abrirConexao, garantirDestrancado, recarregar]
  );

  const excluir = useCallback(
    async (conexao: PublicConnection) => {
      const ok = await confirmar({
        titulo: 'Excluir conexão',
        mensagem:
          `Excluir a conexão "${conexao.label}"?\n\n` +
          'A credencial cifrada será removida do cofre.',
        rotuloConfirmar: 'excluir',
        destrutivo: true,
      });
      if (!ok) return;
      await Api.deleteConnection(conexao.id);
      await recarregar();
    },
    [recarregar]
  );

  // Vem da árvore que o servidor já manda: sugerir grupo existente evita que o
  // usuário crie "ACME/bancos" ao lado de "ACME/Bancos" por descuido.
  const grupos = useMemo(
    () => (estado === null ? [] : gruposExistentes(estado.tree)),
    [estado]
  );

  /** Conexão por id, achatando a árvore. Aceita `unknown` porque a origem é o
   *  `meta` da aba, que é um registro sem tipo. */
  const todasAsConexoes = useCallback((): readonly PublicConnection[] => {
    if (estado === null) return [];
    const juntar = (grupo: GroupNode): PublicConnection[] => [
      ...grupo.connections,
      ...grupo.groups.flatMap(juntar),
    ];
    return juntar(estado.tree);
  }, [estado]);

  const acharConexao = useCallback(
    (id: unknown): PublicConnection | null => {
      if (typeof id !== 'string' || estado === null) return null;
      const procurar = (grupo: GroupNode): PublicConnection | null => {
        for (const c of grupo.connections) if (c.id === id) return c;
        for (const sub of grupo.groups) {
          const achada = procurar(sub);
          if (achada !== null) return achada;
        }
        return null;
      };
      return procurar(estado.tree);
    },
    [estado]
  );

  return useMemo(
    () => ({
      estado,
      drivers,
      erro,
      expandidos,
      filhos,
      carregando,
      recarregar,
      pedidoDeSenha,
      responderSenha,
      cancelarSenha,
      criarCofre,
      destrancar,
      trocarSenha,
      trancar,
      alternarGrupo,
      recolherTudo,
      abrirConexao,
      desconectar,
      alternarNo,
      recarregarMetadados,
      excluir,
      salvarConexao,
      grupos,
      acharConexao,
      todasAsConexoes,
      filtroDe,
      definirFiltro,
      recarregarNo,
      garantirDestrancado,
      chaveDe,
      descricaoDe: (id: string) => descricoes.get(id) ?? null,
      capacidadesDe: (id: string) => capacidades.get(id) ?? null,
    }),
    [
      abrirConexao, acharConexao, alternarGrupo, alternarNo, cancelarSenha, carregando, criarCofre,
      capacidades, desconectar, descricoes, destrancar, drivers, erro, estado, excluir, expandidos, filhos,
      garantirDestrancado,
      grupos, pedidoDeSenha, recarregar, recarregarMetadados, responderSenha,
      salvarConexao, todasAsConexoes, trancar,
    ]
  );
}
