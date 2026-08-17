// Abre a entrada rápida e espera a resposta.
//
// Existe pelo mesmo motivo do diálogo de senha da spec 004: `window.prompt()`
// devolvia o valor na hora, e um componente não. Quem chama precisa poder
// escrever `const nome = await qi.pedirTexto(...)` e seguir — senão o fluxo de
// salvar teria que ser partido em callbacks espalhados.
//
// Erro do servidor (nome repetido, por exemplo) não é tratado aqui: quem chama
// reabre o pedido com `erro` e `valorInicial`, preservando o que foi digitado.
// A alternativa — manter a caixa aberta esperando o chamador fechá-la — deixaria
// a interface travada se alguém esquecesse de fechar.
import { useCallback, useRef, useState } from 'react';
import type { OpcaoRapida } from './QuickInput';

export interface PedidoRapido {
  readonly titulo?: string;
  readonly placeholder: string;
  /** Ausente = modo texto livre. Presente = escolha de lista. */
  readonly opcoes?: readonly OpcaoRapida[];
  readonly valorInicial?: string;
  readonly erro?: string;
}

export interface QuickInputController {
  readonly pedido: PedidoRapido | null;
  /** Resolve com o valor escolhido ou digitado, ou `null` se cancelado. */
  pedir(pedido: PedidoRapido): Promise<string | null>;
  confirmar(valor: string): void;
  cancelar(): void;
}

export function useQuickInput(): QuickInputController {
  const [pedido, setPedido] = useState<PedidoRapido | null>(null);
  const resposta = useRef<((valor: string | null) => void) | null>(null);

  const pedir = useCallback((novo: PedidoRapido): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      // Um pedido por vez: o anterior é cancelado, não empilhado.
      resposta.current?.(null);
      resposta.current = resolve;
      setPedido(novo);
    });
  }, []);

  const responder = useCallback((valor: string | null) => {
    setPedido(null);
    resposta.current?.(valor);
    resposta.current = null;
  }, []);

  return {
    pedido,
    pedir,
    confirmar: (valor: string) => responder(valor),
    cancelar: () => responder(null),
  };
}

/**
 * Pede um texto e tenta gravá-lo, reabrindo com a mensagem se o servidor recusar.
 *
 * É o laço que faz nome repetido não custar redigitar: o que foi escrito volta
 * como valor inicial, com o erro acima do campo.
 */
export async function pedirComRetentativa<T>(
  qi: QuickInputController,
  pedido: PedidoRapido,
  gravar: (valor: string) => Promise<T>
): Promise<T | null> {
  let valorInicial = pedido.valorInicial;
  let erro: string | undefined;

  for (;;) {
    const valor = await qi.pedir({ ...pedido, valorInicial, erro });
    if (valor === null) return null;
    try {
      return await gravar(valor);
    } catch (e) {
      erro = (e as Error).message;
      valorInicial = valor;
    }
  }
}
