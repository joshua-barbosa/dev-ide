// A pasta aberta: árvore, símbolos e histórico.
//
// Substituiu `useProject` na spec 012, e a diferença é de modelo, não de nome:
// antes o espaço de trabalho era o **nome** de uma subpasta de `projects/`, o
// que trancava o usuário lá dentro. Agora é um **caminho**, e qualquer pasta da
// máquina serve.
//
// Uma requisição só devolve pasta, recentes, árvore e símbolos. Três chamadas
// dariam três momentos, e a árvore apareceria antes dos símbolos.
import { useCallback, useEffect, useState } from 'react';
import { nomeDoCaminho } from '../../shared/caminho-local';
import { enxertarNasRaizes } from '../../shared/enxerto-na-arvore';
import type { Plataforma } from '../../shared/plataforma';
import {
  Api, type FileNode, type Projeto, type RaizAberta, type RetratoDoEspaco,
} from '../api';

const VAZIO: RetratoDoEspaco = {
  raizes: [], pasta: null, recentes: [], arvore: [], truncated: false, plataforma: 'linux',
};

export interface PastaAberta {
  /**
   * As raízes abertas, cada uma com a árvore dela (T004).
   *
   * Vazio quando não há nenhuma. Com uma só, a tela é exatamente a de antes —
   * foi o critério para não reescrever o painel inteiro.
   */
  readonly raizes: readonly RaizAberta[];
  /** Caminho absoluto da PRIMEIRA raiz, ou `''` quando não há nenhuma. */
  readonly pasta: string;
  /** Só o nome, para o cabeçalho do painel. */
  readonly nome: string;
  readonly recentes: readonly string[];
  readonly arvore: readonly FileNode[];
  /**
   * Onde o SERVIDOR roda (D223).
   *
   * A interface não pode deduzir isto do navegador: com a IDE aberta no Chrome
   * de uma máquina e o servidor em outra, quem manda no separador de caminho é
   * quem tem os arquivos.
   */
  readonly plataforma: Plataforma;
  /** A árvore bateu no teto e foi cortada — o painel avisa. */
  readonly truncada: boolean;
  /** Projetos de `projects/`, que continuam sendo atalhos. */
  readonly projetos: readonly Projeto[];
  readonly erro: string | null;
  abrir(caminho: string): Promise<void>;
  fechar(): Promise<void>;
  esquecer(caminho: string): Promise<void>;
  recarregar(): Promise<void>;
  /** Pede ao servidor os filhos de uma pasta e os põe na árvore. */
  carregarFilhos(caminho: string): Promise<void>;
  criarProjeto(nome: string): Promise<void>;
  /** Devolve o caminho do arquivo criado; deixa o erro subir para a retentativa. */
  criarArquivo(nome: string, conteudo: string): Promise<string>;
  /** Cria uma pasta e devolve o caminho; deixa o erro subir para a retentativa. */
  criarPasta(nome: string): Promise<string>;
  /** Soma uma raiz ao espaço de trabalho (T004). */
  acrescentar(caminho: string): Promise<void>;
  /** Tira uma raiz, deixando as outras (T004). */
  remover(caminho: string): Promise<void>;
  /** Renomeia um item da árvore e devolve o caminho novo (T043). */
  renomear(caminho: string, nome: string): Promise<string>;
  /** Copia um item ao lado dele e devolve o caminho da cópia (T043). */
  duplicar(caminho: string): Promise<string>;
  excluir(caminho: string): Promise<void>;
}

export function usePasta(): PastaAberta {
  const [retrato, setRetrato] = useState<RetratoDoEspaco>(VAZIO);
  const [projetos, setProjetos] = useState<readonly Projeto[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregarProjetos = useCallback(async () => {
    setProjetos(await Api.listProjects());
  }, []);

  const recarregar = useCallback(async () => {
    setRetrato(await Api.workspace());
  }, []);

  /**
   * Carrega os filhos de uma pasta e os enxerta na árvore (spec 034).
   *
   * A árvore vem um nível por vez: `children` ausente é "ainda não carregada",
   * e é o que faz este pedido acontecer quando o usuário clica no `>`. Uma
   * lista vazia é "carregada e vazia" — pasta sem nada dentro —, e por isso as
   * duas não podem ser a mesma coisa.
   */
  const carregarFilhos = useCallback(async (caminho: string): Promise<void> => {
    const { nodes } = await Api.fileChildren(caminho);
    setRetrato((atual) => {
      // Quem escolhe a raiz e enxerta é `shared/enxerto-na-arvore`, com teste.
      const raizes = enxertarNasRaizes(atual.raizes, caminho, nodes, atual.plataforma);
      if (raizes === atual.raizes) return atual;
      const primeira = raizes[0];
      return { ...atual, raizes, arvore: primeira === undefined ? [] : primeira.arvore };
    });
  }, []);

  useEffect(() => {
    // A IDE reabre onde o usuário estava; na primeira vez, sobe sem pasta.
    recarregar().catch((e: Error) => setErro(e.message));
    carregarProjetos().catch((e: Error) => setErro(e.message));
  }, [recarregar, carregarProjetos]);

  const abrir = useCallback(async (caminho: string) => {
    setRetrato(await Api.openFolder(caminho));
    setErro(null);
  }, []);

  const acrescentar = useCallback(async (caminho: string) => {
    setRetrato(await Api.addFolder(caminho));
    setErro(null);
  }, []);

  const remover = useCallback(async (caminho: string) => {
    setRetrato(await Api.removeFolder(caminho));
  }, []);

  const fechar = useCallback(async () => {
    setRetrato(await Api.closeFolder());
  }, []);

  const esquecer = useCallback(async (caminho: string) => {
    setRetrato(await Api.forgetFolder(caminho));
  }, []);

  const criarProjeto = useCallback(
    async (nome: string) => {
      const criado = await Api.createProject(nome.trim());
      await carregarProjetos();
      // Criar e não abrir seria deixar o usuário a um passo do que ele pediu.
      setRetrato(await Api.openFolder(criado.dir));
    },
    [carregarProjetos]
  );

  const criarArquivo = useCallback(
    async (nome: string, conteudo: string): Promise<string> => {
      const criado = await Api.createWorkspaceFile(nome.trim(), conteudo);
      await recarregar();
      return criado.path;
    },
    [recarregar]
  );

  const criarPasta = useCallback(
    async (nome: string): Promise<string> => {
      const criada = await Api.createWorkspaceFolder(nome.trim());
      await recarregar();
      return criada.path;
    },
    [recarregar]
  );

  // As três mexem no disco e recarregam a árvore. O erro SOBE: quem chama
  // sabe se está num laço de retentativa (renomear) ou se mostra um aviso.
  const renomear = useCallback(
    async (caminho: string, nome: string): Promise<string> => {
      const novo = await Api.renameEntry(caminho, nome.trim());
      await recarregar();
      return novo.path;
    },
    [recarregar]
  );

  const duplicar = useCallback(
    async (caminho: string): Promise<string> => {
      const copia = await Api.duplicateEntry(caminho);
      await recarregar();
      return copia.path;
    },
    [recarregar]
  );

  const excluir = useCallback(
    async (caminho: string): Promise<void> => {
      await Api.deleteEntry(caminho);
      await recarregar();
    },
    [recarregar]
  );

  const pasta = retrato.pasta ?? '';
  return {
    raizes: retrato.raizes,
    pasta,
    nome: pasta === '' ? '' : nomeDoCaminho(pasta, retrato.plataforma),
    recentes: retrato.recentes,
    arvore: retrato.arvore,
    plataforma: retrato.plataforma,
    truncada: retrato.truncated,
    projetos,
    erro,
    abrir,
    fechar,
    esquecer,
    recarregar,
    carregarFilhos,
    criarProjeto,
    criarArquivo,
    criarPasta,
    renomear,
    duplicar,
    excluir,
    acrescentar,
    remover,
  };
}
