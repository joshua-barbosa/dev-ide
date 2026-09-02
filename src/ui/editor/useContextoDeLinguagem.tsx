// O que os provedores de linguagem do Monaco precisam saber (lote E).
//
// Existe por um motivo específico, e não por organização: os provedores são
// registrados UMA VEZ no Monaco, que é global, e a closure deles fica viva para
// sempre. Passar valores direto do render faria eles lerem o estado de quando a
// IDE abriu — a pasta certa até ele abrir outra, e a errada dali em diante.
//
// A `ref` resolve isso, e o `useMemo` garante que o objeto entregue ao
// registro seja sempre o mesmo.
import { useMemo, useRef } from 'react';
import { caminhoDaUri } from '../../shared/abas-gemeas';
import { Breadcrumb } from './Breadcrumb';
import type { ContextoDeLinguagem } from './provedores';
import type { SimboloDaTrilha } from '../../shared/breadcrumb';

export function useContextoDeLinguagem(pasta: string): ContextoDeLinguagem {
  const pastaAgora = useRef(pasta);
  pastaAgora.current = pasta;

  return useMemo(
    () => ({
      pastaAtual: () => pastaAgora.current,
      // O caminho sai da PRÓPRIA URI do modelo: os provedores rodam dentro do
      // Monaco e não enxergam o estado do React.
      caminhoDoModelo: caminhoDaUri,
    }),
    []
  );
}

/**
 * A trilha do arquivo em foco (T075), pronta para entrar no grupo de editor.
 *
 * Junto do contexto porque é o mesmo assunto — **o que a IDE sabe sobre o
 * código que está na tela** — e porque manter a montagem no `App` custava as
 * mesmas dez linhas que ele não tem, pelo Artigo IV.
 */
export function montarBreadcrumb(o: {
  readonly caminho: string | null;
  readonly raiz: string;
  readonly simbolos: readonly SimboloDaTrilha[];
  readonly linha: number;
  irParaLinha(linha: number): void;
}): React.ReactNode {
  return (
    <Breadcrumb
      caminho={o.caminho}
      raiz={o.raiz}
      simbolos={o.simbolos}
      linha={o.linha}
      onIrParaLinha={o.irParaLinha}
    />
  );
}
