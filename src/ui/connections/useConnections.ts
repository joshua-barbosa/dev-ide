// Estado dos painéis de conexão.
//
// Um só gancho serve Database e Service: o que muda entre eles é apenas o
// filtro de painel, declarado por cada driver. Expansão e cache de filhos são
// compartilhados de propósito — as duas árvores nunca mostram a mesma conexão,
// então não há como uma confundir a outra.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectionInput, ConnectionsState, GroupNode, PublicConnection, TreeNode,
} from '../../shared/contracts';
import { gruposExistentes } from '../../shared/connections/form';
import { Api, type DriverInfo } from '../api';

/** Chave de cache: id da conexão mais o caminho do nó. */
const chaveDe = (id: string, caminho: readonly string[]): string =>
  [id, ...caminho].join('\u0000');

/** Um pedido de senha em aberto — o que o diálogo precisa saber para se desenhar. */
export interface PedidoDeSenha {
  readonly modo: 'criar' | 'destrancar';
}

export interface ConnectionsController {
  readonly pedidoDeSenha: PedidoDeSenha | null;
  responderSenha(senha: string, lembrar: boolean): Promise<void>;
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
  trancar(): Promise<void>;
  alternarGrupo(caminho: string): void;
  abrirConexao(conexao: PublicConnection): Promise<void>;
  desconectar(id: string): Promise<void>;
  alternarNo(id: string, caminho: readonly string[]): Promise<void>;
  recarregarMetadados(id: string): Promise<void>;
  excluir(conexao: PublicConnection): Promise<void>;
  salvarConexao(input: ConnectionInput, id: string | null, conectar: boolean): Promise<void>;
  readonly grupos: readonly string[];
  acharConexao(id: unknown): PublicConnection | null;
  chaveDe(id: string, caminho: readonly string[]): string;
}

export function useConnections(): ConnectionsController {
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
    async (senha: string, lembrar: boolean) => {
      const pedido = pedidoDeSenha;
      if (pedido === null) return;
      if (pedido.modo === 'criar') await Api.createVault(senha, lembrar);
      else await Api.unlockVault(senha, lembrar);

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

  const trancar = useCallback(async () => {
    await Api.lockVault();
    // Trancar fecha as sessões no servidor; o que estava expandido não vale mais.
    setExpandidos(new Set());
    setFilhos(new Map());
    await recarregar();
  }, [recarregar]);

  const alternarGrupo = useCallback(
    (caminho: string) => {
      const chave = `grupo:${caminho}`;
      setExpandidos((atual) => marcar(atual, chave, !atual.has(chave)));
    },
    [marcar]
  );

  const buscarFilhos = useCallback(
    async (id: string, caminho: readonly string[]) => {
      const chave = chaveDe(id, caminho);
      setCarregando((atual) => marcar(atual, chave, true));
      try {
        const nos = await Api.children(id, caminho);
        setFilhos((atual) => new Map(atual).set(chave, nos));
      } finally {
        setCarregando((atual) => marcar(atual, chave, false));
      }
    },
    [marcar]
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
        await Api.connect(conexao.id);
        await buscarFilhos(conexao.id, []);
        await recarregar(); // atualiza openIds, que marca a conexão como viva
      } catch (e) {
        setExpandidos((atual) => marcar(atual, chave, false));
        throw new Error(
          `Não foi possível conectar em "${conexao.label}":\n\n${(e as Error).message}`
        );
      }
    },
    [buscarFilhos, expandidos, garantirDestrancado, marcar, recarregar]
  );

  const desconectar = useCallback(
    async (id: string) => {
      await Api.disconnect(id);
      setExpandidos((atual) => marcar(atual, `conn:${id}`, false));
      setFilhos(new Map());
      await recarregar();
    },
    [marcar, recarregar]
  );

  const alternarNo = useCallback(
    async (id: string, caminho: readonly string[]) => {
      const chave = `no:${chaveDe(id, caminho)}`;
      if (expandidos.has(chave)) {
        setExpandidos((atual) => marcar(atual, chave, false));
        return;
      }
      setExpandidos((atual) => marcar(atual, chave, true));
      if (!filhos.has(chaveDe(id, caminho))) {
        try {
          await buscarFilhos(id, caminho);
        } catch (e) {
          setExpandidos((atual) => marcar(atual, chave, false));
          throw e;
        }
      }
    },
    [buscarFilhos, expandidos, filhos, marcar]
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
      const ok = window.confirm(
        `Excluir a conexão "${conexao.label}"?\n\nA credencial cifrada será removida do cofre.`
      );
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
      trancar,
      alternarGrupo,
      abrirConexao,
      desconectar,
      alternarNo,
      recarregarMetadados,
      excluir,
      salvarConexao,
      grupos,
      acharConexao,
      chaveDe,
    }),
    [
      abrirConexao, acharConexao, alternarGrupo, alternarNo, cancelarSenha, carregando, criarCofre,
      desconectar, destrancar, drivers, erro, estado, excluir, expandidos, filhos,
      grupos, pedidoDeSenha, recarregar, recarregarMetadados, responderSenha,
      salvarConexao, trancar,
    ]
  );
}
