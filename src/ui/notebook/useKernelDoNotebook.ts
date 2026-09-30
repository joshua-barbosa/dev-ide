// O kernel de UM notebook, visto pela tela (spec 112, etapa 2).
//
// Três regras de vida:
// - sobe na PRIMEIRA execução, não ao abrir: abrir um notebook para ler não
//   deveria subir um Python;
// - reabrir a tela (F5, trocar de aba) REENCONTRA o kernel que já roda no
//   motor, com as variáveis — é o que o Jupyter faz;
// - fechar a aba do notebook o ENCERRA.
//
// A execução é por consulta (ver `routes/notebook.ts`): a célula entra na fila
// e a tela pergunta o que saiu, repintando a saída enquanto a célula roda.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiDoNotebook, type EstadoDoKernel } from '../api-notebook';
import type { Kernel, Saida } from '../../shared/notebook/modelo';

/** De quanto em quanto tempo a tela pergunta o que a célula escreveu. */
const INTERVALO_MS = 150;

export interface ControleDoKernel {
  readonly estado: EstadoDoKernel | null;
  readonly subindo: boolean;
  /** Por que o kernel não subiu, da última vez que se tentou. */
  readonly erro: string | null;
  /** Sobe o kernel se preciso. `null` = de pé; texto = por que não subiu. */
  garantir(): Promise<string | null>;
  executar(
    codigo: string,
    aoParcial: (saidas: readonly Saida[]) => void
  ): Promise<{ readonly saidas: readonly Saida[]; readonly ok: boolean }>;
  interromper(): Promise<void>;
  reiniciar(): Promise<void>;
  trocarInterpretador(caminho: string): Promise<void>;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useKernelDoNotebook(
  caminho: string | null,
  linguagem: Kernel,
  raiz: string | null
): ControleDoKernel {
  const [estado, setEstado] = useState<EstadoDoKernel | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vivo = useRef<EstadoDoKernel | null>(null);
  vivo.current = estado;

  // Reencontra o kernel que já roda no motor (F5 não perde as variáveis).
  useEffect(() => {
    if (caminho === null) return;
    let valendo = true;
    void ApiDoNotebook.kernel(caminho)
      .then((e) => {
        if (valendo) setEstado(e);
      })
      .catch(() => undefined);
    return () => {
      valendo = false;
    };
  }, [caminho]);

  // Fechar a aba encerra o kernel. A aba escondida continua MONTADA (ver o
  // `EditorGroup`), então desmontar aqui é fechar — não trocar de aba.
  useEffect(() => {
    if (caminho === null) return;
    return () => {
      void ApiDoNotebook.encerrar(caminho).catch(() => undefined);
    };
  }, [caminho]);

  /** Devolve o MOTIVO quando falha — o estado `erro` só chega no próximo render. */
  const subir = useCallback(
    async (interpretador?: string): Promise<string | null> => {
      if (caminho === null) {
        const motivo = 'Salve o notebook antes de rodar: o kernel é dele, pelo caminho.';
        setErro(motivo);
        return motivo;
      }
      setSubindo(true);
      try {
        const e = await ApiDoNotebook.iniciar({ caminho, linguagem, raiz, interpretador });
        setEstado(e);
        setErro(null);
        return null;
      } catch (e) {
        setErro(mensagemDe(e));
        return mensagemDe(e);
      } finally {
        setSubindo(false);
      }
    },
    [caminho, linguagem, raiz]
  );

  const garantir = useCallback(
    async (): Promise<string | null> => (vivo.current !== null ? null : subir()),
    [subir]
  );

  const executar = useCallback(
    async (codigo: string, aoParcial: (saidas: readonly Saida[]) => void) => {
      const motivo = caminho === null ? 'O notebook não tem caminho.' : await garantir();
      if (caminho === null || motivo !== null) {
        return { saidas: [{ tipo: 'erro' as const, mensagem: `O kernel não subiu: ${motivo}` }], ok: false };
      }
      let exec: number;
      try {
        exec = (await ApiDoNotebook.executar(caminho, codigo)).exec;
      } catch (e) {
        // O kernel pode ter morrido desde a última vez: esquece e avisa.
        setEstado(null);
        return { saidas: [{ tipo: 'erro' as const, mensagem: mensagemDe(e) }], ok: false };
      }
      let saidas: Saida[] = [];
      for (;;) {
        const q = await ApiDoNotebook.execucao(caminho, exec, saidas.length);
        saidas = [...saidas.slice(0, q.inicio), ...q.saidas];
        aoParcial(saidas);
        if (q.terminou) return { saidas, ok: q.ok };
        await esperar(INTERVALO_MS);
      }
    },
    [caminho, garantir]
  );

  const interromper = useCallback(async () => {
    if (caminho !== null) await ApiDoNotebook.interromper(caminho);
  }, [caminho]);

  const reiniciar = useCallback(async () => {
    if (caminho === null || vivo.current === null) return;
    setSubindo(true);
    try {
      setEstado(await ApiDoNotebook.reiniciar(caminho));
    } finally {
      setSubindo(false);
    }
  }, [caminho]);

  const trocarInterpretador = useCallback(
    async (interpretador: string) => {
      await subir(interpretador);
    },
    [subir]
  );

  return { estado, subindo, erro, garantir, executar, interromper, reiniciar, trocarInterpretador };
}
