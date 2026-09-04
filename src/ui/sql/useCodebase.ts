// Busca e guarda o catálogo do banco da aba ativa (T053, spec 071).
//
// Uma ida ao servidor por `conexão + banco`, e não por tecla. O servidor também
// guarda o dele na sessão — os dois caches existem por razões diferentes: o de
// lá evita reler o catálogo, o daqui evita a viagem.
import { useEffect, useRef } from 'react';
import { Api } from '../api';
// O provedor de autocomplete VIVE no Monaco, e por isso mora atrás de um
// `import()` (P7, spec 101): a IDE inteira esperava por ele no primeiro
// desenho, e ele só serve depois que existe um editor de SQL na tela.
const completar = (): Promise<typeof import('../editor/completarSql')> =>
  import('../editor/completarSql');
import type { Codebase } from '../../shared/sql/codebase';
import type { Vinculo } from '../../shared/sql/vinculo';

/**
 * Recebe o VÍNCULO inteiro, e não id e banco soltos.
 *
 * É a mesma fonte que o `▷ Run` usa para saber contra quem a aba roda.
 * Perguntar por outro caminho daria uma segunda verdade, e ela divergiria
 * justamente quando ele trocasse a conexão da aba.
 */
export function useCodebase(vinculo: Vinculo | null): void {
  const connectionId = vinculo?.connectionId ?? null;
  const database = vinculo?.database ?? null;
  const guardados = useRef(new Map<string, Codebase>());

  useEffect(() => {
    void completar().then((m) => m.registrarCompletarSql());
  }, []);

  useEffect(() => {
    // `definirCodebase` passa por `import()`, então é assíncrono; a ordem entre
    // as chamadas continua a mesma porque o módulo é UM só e a promessa dele já
    // está resolvida a partir da segunda vez.
    const definir = (c: Codebase | null): void => {
      void completar().then((m) => m.definirCodebase(c));
    };

    if (connectionId === null) {
      definir(null);
      return;
    }
    const chave = `${connectionId} ${database ?? ''}`;
    const guardado = guardados.current.get(chave);
    if (guardado !== undefined) {
      definir(guardado);
      return;
    }

    let vigente = true;
    // Enquanto não chega, o autocomplete fica SEM catálogo — e não com o do
    // banco anterior, que sugeriria tabela que não existe aqui.
    definir(null);
    Api.codebase(connectionId, database ?? '')
      .then((catalogo) => {
        if (!vigente) return;
        guardados.current.set(chave, catalogo);
        definir(catalogo);
      })
      .catch(() => {
        // Conexão sem catálogo, ou fora do ar: o editor segue completando as
        // palavras da linguagem. Nunca um erro na cara de quem só digita.
      });
    return () => {
      vigente = false;
    };
  }, [connectionId, database]);
}
