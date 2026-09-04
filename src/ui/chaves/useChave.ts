// O estado de uma aba de chave: o que veio do servidor e o que ele digitou.
//
// Separado da tela porque é a parte que se testa sem navegador: quando há
// rascunho, o que se grava, e o que "sem prazo" quer dizer no campo.
import { useCallback, useEffect, useState } from 'react';
import { Api } from '../api';
import { talvezJson, type TipoDeChave, type ValorDeChave } from '../../shared/sql/redis-chave';

export interface EstadoDaChave {
  readonly valor: ValorDeChave | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  /** O texto do editor. Só existe em chave de forma `texto`. */
  readonly rascunho: string;
  /** O prazo digitado, em segundos. Vazio = sem prazo. */
  readonly prazo: string;
  readonly sujo: boolean;
  definirRascunho(texto: string): void;
  definirPrazo(texto: string): void;
  recarregar(): Promise<void>;
  salvar(): Promise<void>;
}

/**
 * O prazo do campo vira o que a rota espera.
 *
 * Vazio é "sem prazo", e vira `null` — que a rota entende como TIRAR o prazo.
 * Não é a mesma coisa que não mandar o campo, que é "não mexer".
 */
export function prazoParaGravar(texto: string): number | null {
  const limpo = texto.trim();
  if (limpo === '') return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** O que o campo mostra a partir do que o servidor disse. */
export function prazoNoCampo(ttl: number): string {
  return ttl > 0 ? String(ttl) : '';
}

export function useChave(conexaoId: string, chave: string): EstadoDaChave {
  const [valor, setValor] = useState<ValorDeChave | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [prazo, setPrazo] = useState('');
  const [sujo, setSujo] = useState(false);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const v = await Api.lerChave(conexaoId, chave);
      setValor(v);
      // JSON entra formatado — é o que se lê. O que não for JSON volta
      // intocado, porque reformatar texto puro seria corrompê-lo.
      setRascunho(v.forma === 'texto' ? talvezJson(v.texto ?? '') : '');
      setPrazo(prazoNoCampo(v.ttl));
      setSujo(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setValor(null);
    } finally {
      setCarregando(false);
    }
  }, [conexaoId, chave]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  const salvar = useCallback(async () => {
    if (valor === null) return;
    setErro(null);
    try {
      await Api.gravarChave(conexaoId, {
        chave,
        tipo: valor.tipo as TipoDeChave,
        // Só manda o valor quando ele é editável aqui: numa grade, salvar
        // mandaria texto vazio e apagaria a coleção.
        ...(valor.forma === 'texto' ? { valor: rascunho } : {}),
        ttl: prazoParaGravar(prazo),
      });
      await buscar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [buscar, chave, conexaoId, prazo, rascunho, valor]);

  return {
    valor, carregando, erro, rascunho, prazo, sujo,
    definirRascunho: (t) => { setRascunho(t); setSujo(true); },
    definirPrazo: (t) => { setPrazo(t); setSujo(true); },
    recarregar: buscar,
    salvar,
  };
}
