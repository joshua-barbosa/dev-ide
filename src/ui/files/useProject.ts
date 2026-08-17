// Projeto ativo: lista, árvore de arquivos e símbolos.
//
// O estado ficava dentro do painel de arquivos, mas três lugares precisam dele —
// a árvore, os símbolos e o botão de criar arquivo da barra. Consolidado aqui,
// não há como um recarregar e os outros mostrarem o estado anterior.
import { useCallback, useEffect, useState } from 'react';
import { Api, type FileNode, type SymbolInfo } from '../api';

export interface Project {
  readonly projetos: readonly string[];
  readonly projeto: string;
  readonly arvore: readonly FileNode[];
  readonly simbolos: readonly SymbolInfo[];
  readonly erro: string | null;
  selecionar(nome: string): void;
  recarregar(): Promise<void>;
  criarProjeto(nome: string): Promise<void>;
  /** Devolve o caminho do arquivo criado, ou null se o usuário desistiu. */
  criarArquivo(nome: string, conteudo: string): Promise<string>;
}

export function useProject(): Project {
  const [projetos, setProjetos] = useState<readonly string[]>([]);
  const [projeto, setProjeto] = useState('');
  const [arvore, setArvore] = useState<readonly FileNode[]>([]);
  const [simbolos, setSimbolos] = useState<readonly SymbolInfo[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregarLista = useCallback(async (preferido?: string) => {
    const lista = await Api.listProjects();
    setProjetos(lista);
    setProjeto((atual) => preferido ?? (atual === '' ? (lista[0] ?? '') : atual));
  }, []);

  useEffect(() => {
    carregarLista().catch((e: Error) => setErro(e.message));
  }, [carregarLista]);

  const recarregar = useCallback(async () => {
    if (projeto === '') return;
    // Árvore e símbolos juntos: são a mesma verdade vista de dois ângulos.
    const [novaArvore, novosSimbolos] = await Promise.all([
      Api.fileTree(projeto),
      Api.projectSymbols(projeto),
    ]);
    setArvore(novaArvore);
    setSimbolos(novosSimbolos);
  }, [projeto]);

  useEffect(() => {
    recarregar().catch((e: Error) => setErro(e.message));
  }, [recarregar]);

  /** Cria com o nome já escolhido; quem pergunta é a entrada rápida, no App. */
  const criarProjeto = useCallback(
    async (nome: string) => {
      await Api.createProject(nome.trim());
      await carregarLista(nome.trim());
    },
    [carregarLista]
  );

  /**
   * Grava um arquivo novo no projeto e devolve o caminho.
   *
   * Deixa o erro subir: a entrada rápida reabre com a mensagem e o nome
   * digitado, para "já existe" não custar redigitar.
   */
  const criarArquivo = useCallback(
    async (nome: string, conteudo: string): Promise<string> => {
      if (projeto === '') {
        throw new Error('Crie ou selecione um projeto primeiro.');
      }
      const criado = await Api.createFile(projeto, nome.trim(), conteudo);
      await recarregar();
      return criado.path;
    },
    [projeto, recarregar]
  );

  return {
    projetos,
    projeto,
    arvore,
    simbolos,
    erro,
    selecionar: setProjeto,
    recarregar,
    criarProjeto,
    criarArquivo,
  };
}
