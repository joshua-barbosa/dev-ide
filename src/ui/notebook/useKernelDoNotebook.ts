// Os kernels de UM notebook, vistos pela tela (spec 112; vários na spec 113).
//
// Um kernel por FAMÍLIA — Python, Node (JavaScript e TypeScript) e PHP —, cada
// um subindo na primeira célula da sua linguagem. O que passa de um para outro
// é com o motor (a cascata); aqui só se sabe de qual se fala.
//
// Três regras de vida, para cada um:
// - sobe na PRIMEIRA execução, não ao abrir: abrir um notebook para ler não
//   deveria subir um Python;
// - reabrir a tela (F5, trocar de aba) REENCONTRA os kernels que já rodam no
//   motor, com as variáveis — é o que o Jupyter faz;
// - fechar a aba do notebook ENCERRA todos.
//
// A execução é por consulta (ver `routes/notebook.ts`): a célula entra na fila
// e a tela pergunta o que saiu, repintando a saída enquanto a célula roda.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiDoNotebook, type AmbienteDoKernel, type EstadoDoKernel } from '../api-notebook';
import type { Kernel, Saida } from '../../shared/notebook/modelo';
import type { Vinculo } from '../../shared/sql/vinculo';

/** De quanto em quanto tempo a tela pergunta o que a célula escreveu. */
const INTERVALO_MS = 150;

export type Familia = EstadoDoKernel['familia'];

export function familiaDe(linguagem: Kernel): Familia {
  return linguagem === 'javascript' || linguagem === 'typescript' ? 'node' : linguagem;
}

export interface ControleDosKernels {
  /** O estado de cada família que está de pé. */
  readonly estados: Readonly<Partial<Record<Familia, EstadoDoKernel>>>;
  /** As famílias subindo agora. */
  readonly subindo: ReadonlySet<Familia>;
  /** Por que um kernel não subiu, da última vez que se tentou. */
  readonly erros: Readonly<Partial<Record<Familia, string>>>;
  /** Sobe o kernel da linguagem se preciso. `null` = de pé; texto = por que não subiu. */
  garantir(linguagem: Kernel): Promise<string | null>;
  executar(
    linguagem: Kernel,
    codigo: string,
    aoParcial: (saidas: readonly Saida[]) => void,
    /** A conexão do notebook: a do sql() de dentro da célula. */
    conexao?: Vinculo | null
  ): Promise<{ readonly saidas: readonly Saida[]; readonly ok: boolean }>;
  interromper(linguagem: Kernel): Promise<void>;
  /** Um kernel, ou (sem linguagem) todos — e a cascata com eles. */
  reiniciar(linguagem?: Kernel): Promise<void>;
  /** O que dá para escolher — do kernel de pé, ou perguntado sem subir nenhum. */
  ambiente(linguagem: Kernel): Promise<AmbienteDoKernel>;
  /** Sobe (ou troca) o kernel com o interpretador e/ou a pasta de pacotes escolhidos. */
  trocarAmbiente(linguagem: Kernel, escolha: { readonly interpretador?: string; readonly pacotes?: string }): Promise<void>;
  /** PHP: liga ou desliga o Laravel — sobe OUTRO kernel, as variáveis se perdem. */
  trocarLaravel(ligado: boolean): Promise<void>;
  /** Relê os kernels vivos do motor (o SQL pode ter subido um). */
  atualizar(): Promise<void>;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

function porFamilia(lista: readonly EstadoDoKernel[]): Partial<Record<Familia, EstadoDoKernel>> {
  return Object.fromEntries(lista.map((e) => [e.familia, e]));
}

export function useKernelsDoNotebook(
  caminho: string | null,
  raiz: string | null,
  laravel: boolean
): ControleDosKernels {
  const [estados, setEstados] = useState<Partial<Record<Familia, EstadoDoKernel>>>({});
  const [subindo, setSubindo] = useState<ReadonlySet<Familia>>(new Set());
  const [erros, setErros] = useState<Partial<Record<Familia, string>>>({});
  const vivos = useRef(estados);
  vivos.current = estados;

  const comEstado = (familia: Familia, e: EstadoDoKernel | null): void =>
    setEstados((x) => {
      const { [familia]: _antigo, ...resto } = x;
      return e === null ? resto : { ...resto, [familia]: e };
    });
  const marcarSubindo = (familia: Familia, sim: boolean): void =>
    setSubindo((x) => {
      const n = new Set(x);
      if (sim) n.add(familia);
      else n.delete(familia);
      return n;
    });
  const comErro = (familia: Familia, erro: string | null): void =>
    setErros((x) => {
      const { [familia]: _antigo, ...resto } = x;
      return erro === null ? resto : { ...resto, [familia]: erro };
    });

  const atualizar = useCallback(async () => {
    if (caminho === null) return;
    try {
      setEstados(porFamilia(await ApiDoNotebook.kernels(caminho)));
    } catch {
      // Motor fora do ar: a próxima execução avisa.
    }
  }, [caminho]);

  // Reencontra os kernels que já rodam no motor (F5 não perde as variáveis).
  useEffect(() => {
    void atualizar();
  }, [atualizar]);

  // Fechar a aba encerra os kernels. A aba escondida continua MONTADA (ver o
  // `EditorGroup`), então desmontar aqui é fechar — não trocar de aba.
  useEffect(() => {
    if (caminho === null) return;
    return () => {
      void ApiDoNotebook.encerrar(caminho).catch(() => undefined);
    };
  }, [caminho]);

  /** Devolve o MOTIVO quando falha — o estado `erros` só chega no próximo render. */
  const subir = useCallback(
    async (
      linguagem: Kernel,
      opcoes: { interpretador?: string; pacotes?: string; laravel?: boolean } = {}
    ): Promise<string | null> => {
      const familia = familiaDe(linguagem);
      if (caminho === null) {
        const motivo = 'Salve o notebook antes de rodar: o kernel é dele, pelo caminho.';
        comErro(familia, motivo);
        return motivo;
      }
      marcarSubindo(familia, true);
      try {
        const e = await ApiDoNotebook.iniciar({
          caminho, linguagem, raiz, interpretador: opcoes.interpretador, pacotes: opcoes.pacotes,
          laravel: familia === 'php' ? (opcoes.laravel ?? laravel) : undefined,
        });
        comEstado(familia, e);
        comErro(familia, null);
        return null;
      } catch (e) {
        comErro(familia, mensagemDe(e));
        return mensagemDe(e);
      } finally {
        marcarSubindo(familia, false);
      }
    },
    [caminho, raiz, laravel]
  );

  const garantir = useCallback(
    async (linguagem: Kernel): Promise<string | null> =>
      (vivos.current[familiaDe(linguagem)] !== undefined ? null : subir(linguagem)),
    [subir]
  );

  const executar = useCallback(
    async (linguagem: Kernel, codigo: string, aoParcial: (saidas: readonly Saida[]) => void, conexao: Vinculo | null = null) => {
      const motivo = caminho === null ? 'O notebook não tem caminho.' : await garantir(linguagem);
      if (caminho === null || motivo !== null) {
        return { saidas: [{ tipo: 'erro' as const, mensagem: `O kernel não subiu: ${motivo}` }], ok: false };
      }
      let exec: number;
      try {
        exec = (await ApiDoNotebook.executar(caminho, linguagem, codigo, conexao)).exec;
      } catch (e) {
        // O kernel pode ter morrido desde a última vez: relê e avisa.
        void atualizar();
        return { saidas: [{ tipo: 'erro' as const, mensagem: mensagemDe(e) }], ok: false };
      }
      let saidas: Saida[] = [];
      for (;;) {
        const q = await ApiDoNotebook.execucao(caminho, linguagem, exec, saidas.length);
        saidas = [...saidas.slice(0, q.inicio), ...q.saidas];
        aoParcial(saidas);
        if (q.terminou) return { saidas, ok: q.ok };
        await esperar(INTERVALO_MS);
      }
    },
    [caminho, garantir, atualizar]
  );

  const interromper = useCallback(
    async (linguagem: Kernel) => {
      if (caminho !== null) await ApiDoNotebook.interromper(caminho, linguagem);
    },
    [caminho]
  );

  const reiniciar = useCallback(
    async (linguagem?: Kernel) => {
      if (caminho === null) return;
      if (linguagem === undefined) {
        setEstados(porFamilia(await ApiDoNotebook.reiniciarTodos(caminho)));
        return;
      }
      const familia = familiaDe(linguagem);
      marcarSubindo(familia, true);
      try {
        comEstado(familia, await ApiDoNotebook.reiniciar(caminho, linguagem));
      } finally {
        marcarSubindo(familia, false);
      }
    },
    [caminho]
  );

  const ambiente = useCallback(
    async (linguagem: Kernel): Promise<AmbienteDoKernel> => {
      const e = vivos.current[familiaDe(linguagem)];
      if (e !== undefined) return { candidatos: e.candidatos, candidatosDePacotes: e.candidatosDePacotes ?? [] };
      if (caminho === null) throw new Error('Salve o notebook antes: o kernel é dele, pelo caminho.');
      return ApiDoNotebook.ambiente(caminho, linguagem, raiz);
    },
    [caminho, raiz]
  );

  const trocarAmbiente = useCallback(
    async (linguagem: Kernel, escolha: { readonly interpretador?: string; readonly pacotes?: string }) => {
      // O que ele não trocou fica como está: trocar a pasta mantém o Node.
      const e = vivos.current[familiaDe(linguagem)];
      await subir(linguagem, {
        interpretador: escolha.interpretador ?? e?.interpretador.caminho,
        pacotes: escolha.pacotes ?? e?.pacotes?.caminho,
      });
    },
    [subir]
  );

  const trocarLaravel = useCallback(
    async (ligado: boolean) => {
      // Só religa se já está de pé: parado, a próxima execução já sobe certo.
      if (vivos.current.php !== undefined) await subir('php', { laravel: ligado });
    },
    [subir]
  );

  return {
    estados, subindo, erros, garantir, executar, interromper, reiniciar, ambiente, trocarAmbiente, trocarLaravel,
    atualizar,
  };
}
