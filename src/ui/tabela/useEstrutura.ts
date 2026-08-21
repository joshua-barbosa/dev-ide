// A estrutura da tabela, buscada sob demanda (spec 045).
//
// Só vai ao servidor quando a sub-aba `Estrutura` é aberta pela primeira vez:
// ninguém paga por uma aba que não abriu. Depois disso o dado fica, e trocar de
// sub-aba não custa outra ida — mesma regra do editor e do terminal.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../api';
import type { TableStructure } from '../../shared/contracts';

export interface EstadoDaEstrutura {
  readonly estrutura: TableStructure | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  recarregar(): void;
}

export function useEstrutura(
  connectionId: string,
  nodePath: readonly string[],
  ativa: boolean
): EstadoDaEstrutura {
  const [estrutura, setEstrutura] = useState<TableStructure | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const geracao = useRef(0);

  // Separador NUL pelo mesmo motivo de `useTabela`: nome de tabela e de schema
  // podem ter espaço, e um separador que aparece dentro dos pedaços não separa.
  const SEPARADOR = '\u0000';
  const caminho = nodePath.join(SEPARADOR);

  useEffect(() => {
    // `ativa` é a chave da preguiça: sem ela, abrir uma tabela pagaria por uma
    // aba que talvez nunca seja olhada.
    if (!ativa) return;
    const minha = (geracao.current += 1);
    setCarregando(true);
    Api.tableStructure(connectionId, caminho.split(SEPARADOR))
      .then((dados) => {
        if (geracao.current !== minha) return;
        setEstrutura(dados);
        setErro(null);
      })
      .catch((e: Error) => {
        if (geracao.current !== minha) return;
        setErro(e.message);
      })
      .finally(() => {
        if (geracao.current === minha) setCarregando(false);
      });
  }, [ativa, connectionId, caminho, versao]);

  return {
    estrutura,
    carregando,
    erro,
    recarregar: useCallback(() => setVersao((v) => v + 1), []),
  };
}
