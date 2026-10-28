// O que o arquivo guardou, contado ao motor (relato de 28/10).
//
// A tela é quem sabe o que o `.brnb` tem AGORA — o disco pode estar atrás
// (gravar é no Ctrl+S). Toda vez que a saída de uma célula SQL ou HTTP com nome
// muda, o motor fica sabendo; cada kernel que nascer recebe essas variáveis.
//
// E o contrário: o que NÃO voltou (o arquivo não tem inteiro) vira um aviso
// embaixo da célula, até ela rodar de novo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiDoNotebook, type EstadoDoKernel } from '../api-notebook';
import { guardadosDoNotebook } from '../../shared/notebook/guardados';
import type { Notebook } from '../../shared/notebook/modelo';

/** Um número por lista de saídas: a lista muda (imutável) quando a célula roda. */
const idDas = new WeakMap<object, number>();
let proximoId = 1;
function idDe(o: object): number {
  let id = idDas.get(o);
  if (id === undefined) {
    id = proximoId++;
    idDas.set(o, id);
  }
  return id;
}

/** O que importa para o motor — digitar no SQL não muda nada disto. */
function assinatura(nb: Notebook | null): string {
  if (nb === null) return '';
  return nb.celulas
    .filter((c) => (c.tipo === 'http' || c.tipo === 'sql') && c.nome !== null)
    .map((c) => `${c.id}:${c.tipo}:${c.nome}:${c.paraCada ?? ''}:${idDe(c.saidas)}`)
    .join('|');
}

export interface GuardadosDoNotebook {
  /** Espera o motor saber do último estado — antes de rodar uma célula. */
  sincronizado(): Promise<void>;
  /** Por célula: por que a variável dela não voltou com o kernel novo. */
  readonly avisos: ReadonlyMap<string, string>;
}

export function useGuardadosDoNotebook(
  caminho: string | null,
  nb: Notebook | null,
  estados: Readonly<Partial<Record<string, EstadoDoKernel>>>
): GuardadosDoNotebook {
  const atual = useRef(nb);
  atual.current = nb;
  const envio = useRef<Promise<void>>(Promise.resolve());
  /** O último envio falhou: o próximo `sincronizado` manda de novo. */
  const falhou = useRef(false);
  const chave = useMemo(() => assinatura(nb), [nb]);

  const enviar = useCallback(() => {
    if (caminho === null || atual.current === null) return;
    const guardados = guardadosDoNotebook(atual.current);
    // Em fila: um envio velho não chega depois do novo.
    envio.current = envio.current
      .then(() => ApiDoNotebook.guardados(caminho, guardados))
      .then(() => { falhou.current = false; })
      .catch(() => { falhou.current = true; });
  }, [caminho]);

  useEffect(enviar, [enviar, chave]);

  const [avisos, setAvisos] = useState<ReadonlyMap<string, string>>(new Map());
  // Os kernels mudaram (subiu, reiniciou, a célula entregou o nome): relê.
  useEffect(() => {
    if (caminho === null || Object.keys(estados).length === 0) {
      setAvisos(new Map());
      return;
    }
    let vale = true;
    ApiDoNotebook.naoRestaurados(caminho)
      .then((lista) => {
        if (!vale) return;
        setAvisos(new Map(lista.map((f) => [
          f.celula, `${f.nome} não voltou com o kernel novo: ${f.motivo}. Rode esta célula de novo.`,
        ])));
      })
      .catch(() => undefined);
    return () => {
      vale = false;
    };
  }, [caminho, estados]);

  const sincronizado = useCallback(async () => {
    await envio.current;
    if (falhou.current) {
      enviar();
      await envio.current;
    }
  }, [enviar]);
  return { sincronizado, avisos };
}
