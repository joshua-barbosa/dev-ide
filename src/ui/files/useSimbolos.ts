// Os símbolos do projeto, buscados SÓ quando alguém olha (D222).
//
// Antes eles vinham no retrato do espaço, e o retrato é pedido na subida, em
// toda troca de raiz e depois de cada criar, renomear, duplicar e excluir. Ler
// e analisar o projeto inteiro custava 588 ms de event loop travado num
// repositório de 584 arquivos — por vez. Era o congelamento que ele descreveu,
// e a razão pela qual ele propôs tirar a aba.
//
// A aba fica; o custo é que sai do caminho de todo mundo. Quem não a abre não
// paga nada.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Api, type SymbolInfo } from '../api';

export interface Simbolos {
  readonly lista: readonly SymbolInfo[];
  /** A primeira busca ainda está em voo — o painel diz "procurando". */
  readonly carregando: boolean;
  readonly erro: string | null;
  recarregar(): Promise<void>;
}

/**
 * @param ativo quando falso, nada é pedido. É a aba estar aberta.
 * @param chave muda quando o espaço muda (pasta aberta, arquivo criado): é o
 *   que faz a lista se refazer sem voltar a custar em quem não está olhando.
 */
export function useSimbolos(ativo: boolean, chave: string): Simbolos {
  const [lista, setLista] = useState<readonly SymbolInfo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** O que já foi buscado — reabrir a aba sem nada ter mudado não repete. */
  const buscada = useRef<string | null>(null);

  const buscar = useCallback(async (): Promise<void> => {
    setCarregando(true);
    setErro(null);
    try {
      const { simbolos } = await Api.workspaceSymbols();
      setLista(simbolos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  const recarregar = useCallback(async (): Promise<void> => {
    buscada.current = chave;
    await buscar();
  }, [buscar, chave]);

  useEffect(() => {
    if (!ativo || buscada.current === chave) return;
    buscada.current = chave;
    void buscar();
  }, [ativo, chave, buscar]);

  return { lista, carregando, erro, recarregar };
}

/**
 * Os símbolos de UM arquivo — a trilha acima do editor.
 *
 * A trilha sempre usou só os do arquivo em foco, e mesmo assim recebia a lista
 * do projeto inteiro (D222). Um arquivo é uma leitura; a diferença entre isto e
 * a lista do projeto é o projeto.
 */
export function useSimbolosDoArquivo(caminho: string | null): readonly SymbolInfo[] {
  const [lista, setLista] = useState<readonly SymbolInfo[]>([]);

  useEffect(() => {
    if (caminho === null || caminho === '') {
      setLista([]);
      return;
    }
    let vivo = true;
    Api.fileSymbols(caminho)
      .then(({ simbolos }) => {
        // Trocar de aba rápido não pode deixar a trilha do arquivo anterior.
        if (vivo) setLista(simbolos);
      })
      .catch(() => {
        // Uma trilha sem símbolo é melhor que um erro por causa da barra de
        // navegação: o degrau de pasta e arquivo continua lá.
        if (vivo) setLista([]);
      });
    return () => { vivo = false; };
  }, [caminho]);

  return lista;
}
