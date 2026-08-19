// Estado que sobrevive a recarregar a página, guardado no navegador.
//
// Generaliza o que a largura da lateral já fazia inline. As duas regras que
// importam vieram de lá: **ler tolerante** (valor estragado vale como ausente) e
// **gravar sem quebrar** (modo privativo derruba `localStorage`, e não poder
// lembrar a altura de um painel não é motivo para a IDE falhar).
//
// Por que aqui e não no `config.json` do servidor: isto é escolha de tela, muda
// a cada clique, e um ida-e-volta ao servidor por alternância seria
// desproporcional. É o mesmo critério que já valia para a largura da lateral.
import { useCallback, useState } from 'react';

const PREFIXO = 'dev-ide.';

function ler<T>(chave: string, padrao: T, normalizar?: (bruto: unknown) => T): T {
  try {
    const bruto = localStorage.getItem(PREFIXO + chave);
    if (bruto === null) return padrao;
    const valor: unknown = JSON.parse(bruto);
    // Para objeto, `typeof` não diz nada: um `{}` guardado por uma versão
    // anterior passaria e chegaria incompleto a quem consome. Quem tem forma
    // passa um normalizador.
    if (normalizar !== undefined) return normalizar(valor);
    return typeof valor === typeof padrao ? (valor as T) : padrao;
  } catch {
    return padrao;
  }
}

function gravar(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(PREFIXO + chave, JSON.stringify(valor));
  } catch {
    // Sem storage o valor só não persiste; não é motivo para falhar.
  }
}

/** Como `useState`, mas persistido. Aceita atualizador, como o original. */
export function usePersistido<T>(
  chave: string,
  padrao: T,
  normalizar?: (bruto: unknown) => T
): [T, (valor: T | ((atual: T) => T)) => void] {
  const [valor, setValor] = useState<T>(() => ler(chave, padrao, normalizar));

  const definir = useCallback(
    (proximo: T | ((atual: T) => T)) => {
      setValor((atual) => {
        const novo = typeof proximo === 'function' ? (proximo as (a: T) => T)(atual) : proximo;
        gravar(chave, novo);
        return novo;
      });
    },
    [chave]
  );

  return [valor, definir];
}
