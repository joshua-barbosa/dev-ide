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
import { Api, type FileNode, type Projeto, type RetratoDoEspaco, type SymbolInfo } from '../api';

const VAZIO: RetratoDoEspaco = {
  pasta: null, recentes: [], arvore: [], simbolos: [], truncated: false,
};

export interface PastaAberta {
  /** Caminho absoluto, ou `''` quando nenhuma pasta está aberta. */
  readonly pasta: string;
  /** Só o nome, para o cabeçalho do painel. */
  readonly nome: string;
  readonly recentes: readonly string[];
  readonly arvore: readonly FileNode[];
  readonly simbolos: readonly SymbolInfo[];
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
}

/**
 * Devolve a árvore com os filhos de `alvo` preenchidos.
 *
 * Imutável de ponta a ponta: só o ramo que muda é recriado, e o resto é
 * reaproveitado — é o que evita o React redesenhar a árvore inteira a cada
 * pasta aberta.
 */
function enxertar(
  nos: readonly FileNode[],
  alvo: string,
  filhos: readonly FileNode[]
): readonly FileNode[] {
  return nos.map((no) => {
    if (no.path === alvo) return { ...no, children: filhos };
    // Só desce pelo ramo que contém o alvo.
    if (no.type !== 'dir' || no.children === undefined) return no;
    if (!alvo.startsWith(`${no.path}/`)) return no;
    return { ...no, children: enxertar(no.children, alvo, filhos) };
  });
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
    setRetrato((atual) => ({ ...atual, arvore: enxertar(atual.arvore, caminho, nodes) }));
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

  const pasta = retrato.pasta ?? '';
  return {
    pasta,
    nome: pasta === '' ? '' : (pasta.split('/').filter((p) => p !== '').pop() ?? pasta),
    recentes: retrato.recentes,
    arvore: retrato.arvore,
    simbolos: retrato.simbolos,
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
  };
}
