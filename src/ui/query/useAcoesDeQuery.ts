// As ações dos arquivos de query, prontas para o painel de conexões.
//
// Nasceu de um portão, não de um gosto: o teste do Artigo IV (spec 028) pegou o
// `App` em 845 linhas ao ganhar a spec 038. O corte foi aqui porque este é o
// pedaço mais coeso do que entrou — quatro tratadores que só falam de arquivo de
// query e que o painel recebe juntos.
//
// O padrão é o mesmo do `useConexoesAcoes`: o painel sabe do NÓ, este módulo
// sabe o que fazer com ele, e o `App` só liga um no outro.
import type { TreeNode } from '../../shared/contracts';
import type { Execution } from '../useExecution';
import { definirTratadorDeStatement } from './codelens';
import type { ControleDeVinculo } from './useVinculo';
import type { Vinculo } from '../../shared/sql/vinculo';
import type { Workspace } from '../useWorkspace';
import type { ConexoesAcoes } from '../acoes/useConexoesAcoes';

/** O que o `ConnectionsPanel` espera receber para os arquivos de query. */
export interface AcoesDeQuery {
  onAbrirQueryDoDatabase(connectionId: string, no: TreeNode): Promise<void>;
  onAbrirTabela(
    connectionId: string,
    nodePath: readonly string[],
    titulo: string,
    database: string | null
  ): Promise<void>;
  onAbrirArquivoDeQuery(no: TreeNode): Promise<void>;
  onNovaQuery(vinculo: Vinculo | null): Promise<void>;
  onRenomearQuery(vinculo: Vinculo | null, no: TreeNode): Promise<void>;
  onApagarQuery(vinculo: Vinculo | null, no: TreeNode): Promise<void>;
}

/** Lê um campo de texto do `meta` de um nó, ou `null`. */
function texto(no: TreeNode, campo: string): string | null {
  const valor = no.meta?.[campo];
  return typeof valor === 'string' && valor !== '' ? valor : null;
}

export function useAcoesDeQuery(ws: Workspace, acoes: ConexoesAcoes): AcoesDeQuery {
  return {
    onAbrirQueryDoDatabase: acoes.abrirQueryDoDatabase,

    onAbrirTabela: async (connectionId, nodePath, titulo, database) => {
      ws.abrirTabela(connectionId, nodePath, titulo, database);
    },

    onAbrirArquivoDeQuery: async (no) => {
      const caminho = texto(no, 'caminho');
      // Abre pela rota de arquivo comum: daí em diante é um arquivo como
      // qualquer outro, com Ctrl+S, vigia de disco e volta depois do F5.
      if (caminho !== null) await ws.abrirArquivo(caminho);
    },

    onNovaQuery: async (vinculo) => {
      if (vinculo !== null) await acoes.novaQuery(vinculo);
    },

    onRenomearQuery: async (vinculo, no) => {
      const nome = texto(no, 'nome');
      if (vinculo !== null && nome !== null) await acoes.renomearQuery(vinculo, nome);
    },

    onApagarQuery: async (vinculo, no) => {
      const nome = texto(no, 'nome');
      const caminho = texto(no, 'caminho');
      if (vinculo !== null && nome !== null && caminho !== null) {
        await acoes.apagarQuery(vinculo, nome, caminho);
      }
    },
  };
}


/**
 * Liga o `Run | +Tab | JSON` do editor a quem sabe executar.
 *
 * Religado a CADA renderização, de propósito: o tratador é global — o CodeLens é
 * registrado por linguagem, não por editor —, e guardá-lo uma vez só o faria
 * fechar sobre um `exec` velho. É assim que um comando passa a rodar com o
 * estado de ontem.
 */
export function ligarCodeLensDeSql(
  ws: Workspace,
  exec: Execution,
  avisar: (p: Promise<unknown>) => void
): void {
  definirTratadorDeStatement((modo, statement, uri) => {
    // A URI diz de QUAL editor veio o clique. Com a tela dividida há um modelo
    // por grupo, e sem isto o `Run` da esquerda rodaria o arquivo da direita.
    const aba = ws.abaDaUri(uri) ?? ws.active;
    const meta = (aba?.meta ?? {}) as {
      path?: string | null; connectionId?: string; database?: string;
    };
    const daAba =
      typeof meta.connectionId === 'string' && typeof meta.database === 'string'
        ? { connectionId: meta.connectionId, database: meta.database }
        : null;
    avisar(
      exec.executarStatement(modo, statement, meta.path ?? null, aba?.title ?? 'Query', daAba)
    );
  });
}

/**
 * O que a barra de status mostra sobre o vínculo — nada, quando não é SQL.
 *
 * Devolve um objeto para ser espalhado nas props: a ausência das duas chaves é
 * o que faz o botão não existir, e é diferente de existir mostrando "sem
 * conexão".
 */
export function propsDeVinculo(
  linguagem: string,
  caminho: string | null,
  temEditor: boolean,
  vinculos: ControleDeVinculo,
  avisar: (p: Promise<unknown>) => void
): { vinculo?: Vinculo | null; onTrocarVinculo?: () => void } {
  // `temEditor` não é detalhe: sem ele, com a aba de RESULTADO em foco o rodapé
  // anunciava "⚠ sem conexão" — porque a linguagem ainda era `sql` e o caminho
  // já era nulo. Falar do vínculo de um arquivo que não está em foco é pior que
  // não falar nada. Achado no navegador, virou teste.
  if (!temEditor || linguagem !== 'sql') return {};
  // A `versao` é lida para o botão repintar quando o vínculo muda: o gancho
  // guarda a verdade num ref, e ref não provoca renderização.
  void vinculos.versao;
  return {
    vinculo: vinculos.vinculoDe(caminho),
    onTrocarVinculo: () => {
      if (caminho !== null) avisar(vinculos.trocar(caminho));
    },
  };
}
