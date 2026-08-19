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
  criarProjeto(nome: string): Promise<void>;
  /** Devolve o caminho do arquivo criado; deixa o erro subir para a retentativa. */
  criarArquivo(nome: string, conteudo: string): Promise<string>;
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
    criarProjeto,
    criarArquivo,
  };
}
