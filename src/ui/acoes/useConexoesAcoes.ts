// As ações da árvore de conexões (specs 005, 008 e 009).
//
// Mesmo corte dos outros arquivos daqui, pelo mesmo motivo: o `App` passou de
// mil linhas, e o teto do Artigo IV é 800.
import { Api } from '../api';
import { pedirComRetentativa } from '../useQuickInput';
import type { Vinculo } from '../../shared/sql/vinculo';
import type { PublicConnection, TreeNode } from '../../shared/contracts';
import type { QuickInputController } from '../useQuickInput';
import type { Workspace } from '../useWorkspace';
import type { Execution } from '../useExecution';
import type { ConnectionsController } from '../connections/useConnections';
import type { ControleDeVinculo } from '../query/useVinculo';

export interface ConexoesAcoesDeps {
  readonly qi: QuickInputController;
  readonly ws: Workspace;
  readonly exec: Execution;
  readonly conexoes: ConnectionsController;
  readonly vinculos: ControleDeVinculo;
  /** Confirmação antes de apagar arquivo — é irreversível. */
  confirmar(opcoes: {
    readonly titulo?: string;
    readonly mensagem: string;
    readonly rotuloConfirmar?: string;
    readonly destrutivo?: boolean;
  }): Promise<boolean>;
}

export interface ConexoesAcoes {
  abrirFormulario(conexao: PublicConnection | null, grupo?: string): void;
  abrirTerminalDaConexao(conexao: PublicConnection): Promise<void>;
  filtrarCategoria(id: string, caminho: readonly string[], atual: string | null): Promise<void>;
  novoObjeto(
    id: string,
    caminho: readonly string[],
    no: TreeNode,
    database?: string | null
  ): void;
  renomearGrupo(caminho: string): Promise<void>;
  abrirQueryDoNo(
    id: string,
    no: { label: string; meta?: Record<string, unknown> },
    database: string | null
  ): void;
  /** `Abrir Query` no nó de um database: abre o arquivo dele, já amarrado. */
  abrirQueryDoDatabase(id: string, no: TreeNode): Promise<void>;
  /** Cria, renomeia ou apaga um arquivo da categoria `Query`. */
  novaQuery(vinculo: Vinculo, tipo?: 'sql' | 'sqlbook'): Promise<void>;
  renomearQuery(vinculo: Vinculo, nome: string): Promise<void>;
  apagarQuery(vinculo: Vinculo, nome: string, caminho: string): Promise<void>;
}

export function useConexoesAcoes(deps: ConexoesAcoesDeps): ConexoesAcoes {
  const { qi, ws, exec, conexoes } = deps;

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
  const novoObjeto = (
    id: string,
    caminho: readonly string[],
    no: TreeNode,
    database: string | null = null
  ): void => {
    const template = typeof no.meta?.template === 'string' ? no.meta.template : '';
    if (template === '') return;
    exec.definirConexaoAtiva(id);
    ws.abrirQuery(`novo:${id}:${caminho.join('/')}`, `novo_${no.id}.sql`, template, id, database);
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

  /** Monta o SELECT de um objeto, qualificando com o schema quando houver. */
  const abrirQueryDoNo = (
    id: string,
    no: { label: string; meta?: Record<string, unknown> },
    database: string | null
  ) => {
    const objeto = typeof no.meta?.object === 'string' ? no.meta.object : no.label;
    const schema = typeof no.meta?.schema === 'string' ? no.meta.schema : null;
    const alvo = schema === null ? objeto : `${schema}.${objeto}`;
    exec.definirConexaoAtiva(id);
    ws.abrirQuery(`sql:${id}:${alvo}`, `${objeto}.sql`, `SELECT * FROM ${alvo} LIMIT 100;`, id, database);
  };


  /**
   * `Abrir Query` num database (spec 038, AC-1).
   *
   * O arquivo se chama como o database e mora sob a conexão — e é isso que faz o
   * vínculo existir sem ninguém perguntar nada: o CAMINHO já diz contra quem
   * cada query dali roda.
   */
  const abrirQueryDoDatabase = async (id: string, no: TreeNode): Promise<void> => {
    const database = typeof no.meta?.database === 'string' ? no.meta.database : null;
    if (database === null) return;
    if (!(await conexoes.garantirDestrancado())) return;
    const { caminho } = await Api.openQuery({ connectionId: id, database });
    await ws.abrirArquivo(caminho);
  };

  /**
   * Cria um arquivo na pasta `Query`, perguntando O QUÊ antes do nome.
   *
   * A primeira versão (spec 038) só perguntava o nome, e decidia o tipo em
   * silêncio pela extensão: quem não soubesse digitar `.sqlbook` nunca criaria
   * um caderno. Um botão `+` que não diz o que acrescenta é um botão que só
   * serve para quem já sabe — e a ferramenta de referência pergunta.
   *
   * `tipo` vem preenchido quando a escolha já foi feita no menu do botão
   * direito; do `+` ele vem vazio e a pergunta acontece.
   */
  const novaQuery = async (vinculo: Vinculo, tipo?: 'sql' | 'sqlbook'): Promise<void> => {
    const escolhido = tipo ?? (await qi.pedir({
      titulo: 'O que criar nesta conexão?',
      placeholder: 'Tipo de arquivo',
      opcoes: [
        {
          valor: 'sql',
          rotulo: 'Query SQL',
          detalhe: 'um arquivo .sql — uma ou várias consultas soltas',
          icone: 'lucide:file-code',
        },
        {
          valor: 'sqlbook',
          rotulo: 'Query Book',
          detalhe: 'um caderno .sqlbook — blocos de SQL com texto explicando',
          icone: 'lucide:notebook-pen',
        },
      ],
    }));
    if (escolhido === null) return;

    const extensao = escolhido === 'sqlbook' ? '.sqlbook' : '.sql';
    const nome = await pedirComRetentativa(
      qi,
      {
        titulo: escolhido === 'sqlbook' ? 'Novo Query Book' : 'Nova query SQL',
        placeholder: `nome do arquivo (${extensao})`,
      },
      async (valor) => {
        // A extensão é acrescentada aqui, e não deixada por conta do servidor:
        // lá o padrão é `.sql`, e um caderno pedido pelo menu viraria `.sql`.
        const comExtensao = valor.toLowerCase().endsWith(extensao) ? valor : `${valor}${extensao}`;
        const { caminho } = await Api.createQuery(vinculo, comExtensao);
        await ws.abrirArquivo(caminho);
      }
    );
    if (nome !== null) await conexoes.recarregar();
  };

  const renomearQuery = async (vinculo: Vinculo, nome: string): Promise<void> => {
    const novo = await pedirComRetentativa(
      qi,
      { titulo: `Renomear "${nome}"`, placeholder: 'novo nome', valorInicial: nome },
      (valor) => Api.renameQuery(vinculo, nome, valor).then(() => undefined)
    );
    if (novo !== null) await conexoes.recarregar();
  };

  const apagarQuery = async (vinculo: Vinculo, nome: string, caminho: string): Promise<void> => {
    // Apagar arquivo é irreversível: confirma, como manda a spec (AC-27).
    const ok = await deps.confirmar({
      titulo: 'Apagar query',
      mensagem: `Apagar "${nome}"? O arquivo sai do disco.`,
      rotuloConfirmar: 'Apagar',
      destrutivo: true,
    });
    if (!ok) return;
    await Api.deleteQuery(vinculo, nome);
    // A aba do arquivo apagado não pode ficar aberta apontando para o nada.
    ws.fecharPorCaminho(caminho);
    await conexoes.recarregar();
  };

  return {
    abrirFormulario,
    abrirQueryDoDatabase,
    novaQuery,
    renomearQuery,
    apagarQuery,
    abrirTerminalDaConexao,
    filtrarCategoria,
    novoObjeto,
    renomearGrupo,
    abrirQueryDoNo,
  };
}
