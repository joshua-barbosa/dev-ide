// As abas que não são arquivo.
//
// Query, texto solto, tabela, formulário de conexão e terminal. O que elas têm
// em comum é o que as separa das outras: **não têm caminho em disco**. Não são
// salvas com `Ctrl+S`, o vigia da spec 037 não as observa, e a sessão da spec
// 030 não as traz de volta — porque cada uma depende de algo vivo do outro lado.
//
// Saíram de `useWorkspace` quando o portão do Artigo IV (spec 028) o pegou em
// 824 linhas ao ganhar a aba de tabela. O backlog já apontava este corte.
//
// Todas salvam o grupo em foco antes de abrir: sem isso, a aba nova entraria
// por cima do editor sem que o conteúdo do anterior tivesse ido para o store —
// foi assim que a spec 020 fez um lado da tela dividida nascer em branco.
import { useCallback, useRef } from 'react';
import type { TabStore } from '../../shared/tabs';

export interface AbasDeDados {
  abrirQuery(
    id: string,
    titulo: string,
    conteudo: string,
    connectionId: string,
    database: string | null
  ): void;
  abrirTexto(id: string, titulo: string, conteudo: string, linguagem: string): void;
  abrirTabela(
    connectionId: string,
    nodePath: readonly string[],
    titulo: string,
    database: string | null
  ): void;
  abrirFormulario(connectionId: string | null, titulo: string, grupoInicial?: string): void;
  abrirTerminal(connectionId: string | null, titulo: string): void;
  /** A lista de processos de uma conexão (spec 047). */
  abrirProcessos(connectionId: string, titulo: string): void;
  /** A tela de configurações (T001). Uma só, como no VS Code. */
  abrirPreferencias(): void;
  /** A aba de um SERVIDOR, com as sub-abas que ele sabe oferecer (spec 055). */
  abrirServidor(connectionId: string, titulo: string): void;
}

export function useAbasDeDados(store: TabStore, salvarGrupoFocado: () => void): AbasDeDados {
  const abrirQuery = useCallback(
    (
      id: string,
      titulo: string,
      conteudo: string,
      connectionId: string,
      database: string | null
    ) => {
      salvarGrupoFocado();
      store.open({
        id,
        type: 'sql',
        title: titulo,
        // O `database` viaja no `meta` porque esta aba NÃO é um arquivo: não
        // tem caminho, e o vínculo por caminho (spec 038) não a alcança. Ela já
        // nasce sabendo — veio de um nó da árvore.
        meta: {
          path: null, content: conteudo, language: 'sql', view: null, connectionId, database,
        },
      });
    },
    [salvarGrupoFocado, store]
  );

  /**
   * Abre texto que não veio de arquivo — hoje, a saída da execução.
   *
   * Separado de `abrirQuery` porque aquele marca a aba como `sql`, e a saída de
   * um programa não é SQL. Reaproveitar por preguiça daria realce errado e um
   * botão "executar consulta" onde não há consulta.
   */
  const abrirTexto = useCallback(
    (id: string, titulo: string, conteudo: string, linguagem: string) => {
      salvarGrupoFocado();
      store.open({
        id,
        type: 'file',
        title: titulo,
        meta: { path: null, content: conteudo, language: linguagem, view: null },
      });
    },
    [salvarGrupoFocado, store]
  );

  /**
   * Abre a aba do formulário de conexão.
   *
   * O `id` inclui a conexão, então reabrir a mesma edição foca a aba existente
   * em vez de duplicar — regra que o store já tem e que já tem teste.
   */
  const abrirTabela = useCallback(
    (
      connectionId: string,
      nodePath: readonly string[],
      titulo: string,
      database: string | null
    ) => {
      salvarGrupoFocado();
      store.open({
        // O caminho entra no id: a mesma tabela de dois bancos são duas abas.
        id: `tabela:${connectionId}:${nodePath.join('/')}`,
        type: 'tabela',
        title: titulo,
        icon: 'table',
        // O `database` vem junto para o SQL LIVRE (spec 043) rodar no banco
        // certo — o `nodePath` leva o driver até a tabela, mas um `SELECT`
        // escrito à mão precisa do vínculo, como qualquer query.
        meta: { connectionId, nodePath, database },
      });
    },
    [salvarGrupoFocado, store]
  );

  const abrirFormulario = useCallback(
    (connectionId: string | null, titulo: string, grupoInicial?: string) => {
      salvarGrupoFocado();
      store.open({
        id: connectionId === null ? 'conexao:nova' : `conexao:${connectionId}`,
        type: 'conexao',
        title: titulo,
        icon: 'lucide:plug',
        meta: { connectionId, grupoInicial: grupoInicial ?? null },
      });
    },
    [salvarGrupoFocado, store]
  );

  /**
   * Abre uma aba de terminal.
   *
   * O id inclui um contador porque dois terminais da mesma conexão são
   * legítimos — ao contrário do formulário, onde reabrir deve focar o existente.
   */
  const proximoTerminal = useRef(0);
  const abrirTerminal = useCallback(
    (connectionId: string | null, titulo: string) => {
      salvarGrupoFocado();
      proximoTerminal.current += 1;
      store.open({
        id: `terminal:${proximoTerminal.current}`,
        type: 'terminal',
        title: titulo,
        icon: 'terminal',
        meta: { connectionId },
      });
    },
    [salvarGrupoFocado, store]
  );


  const abrirServidor = useCallback(
    (connectionId: string, titulo: string) => {
      salvarGrupoFocado();
      // Uma aba por servidor: reabrir foca a existente. Duplicar daria duas
      // sub-abas de SFTP na mesma conexão, cada uma numa pasta diferente — e o
      // usuário não teria como saber qual é qual.
      store.open({
        id: `servidor:${connectionId}`,
        type: 'servidor',
        title: titulo,
        icon: 'lucide:server',
        meta: { connectionId, label: titulo },
      });
    },
    [salvarGrupoFocado, store]
  );

  const abrirProcessos = useCallback(
    (connectionId: string, titulo: string) => {
      salvarGrupoFocado();
      // Uma aba por conexão: reabrir foca a existente em vez de duplicar.
      store.open({
        id: `processos:${connectionId}`,
        type: 'processos',
        title: `Processos · ${titulo}`,
        icon: 'lucide:activity',
        meta: { connectionId },
      });
    },
    [salvarGrupoFocado, store]
  );

  const abrirPreferencias = useCallback(() => {
    salvarGrupoFocado();
    // Id fixo: reabrir foca a que já está aberta. Duas telas de configuração
    // seriam duas verdades sobre o mesmo arquivo.
    store.open({
      id: 'preferencias',
      type: 'preferencias',
      title: 'Configurações',
      icon: 'lucide:settings',
      meta: {},
    });
  }, [salvarGrupoFocado, store]);

  return {
    abrirQuery, abrirTexto, abrirTabela, abrirFormulario, abrirTerminal, abrirProcessos,
    abrirPreferencias,
    abrirServidor,
  };
}
