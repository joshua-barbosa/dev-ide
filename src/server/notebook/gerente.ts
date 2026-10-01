// Um kernel por notebook aberto (spec 112, etapa 2).
//
// A chave é o CAMINHO do `.brnb`: trocar de aba e voltar reencontra o mesmo
// kernel, com as variáveis. Fechar o notebook o encerra; o motor, ao sair,
// encerra todos — um Python órfão segurando um DataFrame de 2 GB não é algo que
// se deixa para trás.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ambientePhp, candidatosDePython, lerEscolhaDePasta, lerPastaDePacotes, resolverInterpretador, type Interpretador,
} from './ambiente';
import { candidatosDeNode, pastasDePacotes, pastasDeVendor, type PastaDePacotes } from './ambiente-node';
import { Cascata, familiaDe, type Familia } from './cascata';
import { iniciarKernelJs, iniciarKernelPhp, iniciarKernelPython } from './kernel-python';
import { prepararCelulaJs } from './celula-js';
import type { Kernel } from './kernel';
import type { Kernel as LinguagemDoKernel } from '../../shared/notebook/modelo';
import type { Plataforma } from '../../shared/plataforma';

export interface SessaoDeKernel {
  readonly kernel: Kernel;
  /** Um processo por família (spec 113): JS e TS dividem o Node. */
  readonly familia: Familia;
  /** A linguagem com que o kernel subiu (no Node, JS ou TS). */
  readonly linguagem: LinguagemDoKernel;
  readonly interpretador: Interpretador;
  readonly candidatos: readonly Interpretador[];
  readonly raiz: string | null;
  /** O que a célula vira antes de ir ao kernel (JS/TS: ver `celula-js.ts`). */
  readonly preparar: (codigo: string, linguagem: LinguagemDoKernel) => string;
  /** PHP: há um Laravel no projeto? E ele foi ligado neste kernel? */
  readonly laravelDisponivel: boolean;
  readonly laravel: boolean;
  /** JS/TS: de onde vêm os `node_modules`, e as outras pastas que dá para escolher. */
  readonly pacotes: PastaDePacotes | null;
  readonly candidatosDePacotes: readonly PastaDePacotes[];
}

/** O que dá para escolher ANTES de subir: a barra pergunta sem subir um kernel. */
export interface AmbienteDoKernel {
  readonly candidatos: readonly Interpretador[];
  readonly candidatosDePacotes: readonly PastaDePacotes[];
}

/** O disco e o sistema, por fora — para testar sem eles. */
export interface SistemaDoKernel {
  readonly subpastas: (caminho: string) => readonly string[];
  readonly casa: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  /** É uma pasta? ("Outro…" apontando uma pasta, relato de 01/10.) */
  readonly ehPasta: (caminho: string) => boolean;
}

function subpastasDoDisco(caminho: string): readonly string[] {
  try {
    return fs.readdirSync(caminho, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

function ehPastaNoDisco(caminho: string): boolean {
  try {
    return fs.statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

const SISTEMA_REAL: SistemaDoKernel = {
  subpastas: subpastasDoDisco, casa: os.homedir(), env: process.env, execPath: process.execPath,
  ehPasta: ehPastaNoDisco,
};

export interface PedidoDeKernel {
  readonly caminho: string;
  readonly linguagem: LinguagemDoKernel;
  /** A raiz do projeto que contém o notebook — o limite da busca por `.venv`. */
  readonly raiz: string | null;
  /** Um interpretador escolhido à mão; ausente = o primeiro candidato. */
  readonly interpretador?: string;
  /**
   * PHP: subir a aplicação Laravel (como o `tinker`). DESLIGADO por padrão —
   * subida, ela fala com o banco do `.env` por conta própria, fora da trava de
   * somente-leitura das conexões da IDE. Decisão dele (spec 112).
   */
  readonly laravel?: boolean;
  /** JS/TS: a pasta dos `node_modules`; ausente = a mais próxima do notebook. */
  readonly pacotes?: string;
}

export interface IniciadoresDeKernel {
  readonly python: typeof iniciarKernelPython;
  readonly js: typeof iniciarKernelJs;
  readonly php: typeof iniciarKernelPhp;
}

/** A chave de um kernel: o notebook E a família — um notebook tem vários (spec 113). */
const chave = (caminho: string, familia: Familia): string => `${caminho}\u0000${familia}`;

export class GerenteDeKernels {
  private readonly sessoes = new Map<string, SessaoDeKernel>();
  /** Duas abas pedindo o mesmo kernel ao mesmo tempo sobem UM. */
  private readonly subindo = new Map<string, Promise<SessaoDeKernel>>();
  /** A cascata de cada notebook: o que passa de uma linguagem para outra. */
  private readonly cascatas = new Map<string, Cascata>();

  constructor(
    private readonly plataforma: Plataforma,
    private readonly existe: (caminho: string) => boolean = fs.existsSync,
    private readonly iniciar: IniciadoresDeKernel = {
      python: iniciarKernelPython, js: iniciarKernelJs, php: iniciarKernelPhp,
    },
    private readonly sistema: SistemaDoKernel = SISTEMA_REAL
  ) {}

  /** Os interpretadores e as pastas de pacotes, sem subir nada. */
  ambiente(pedido: Pick<PedidoDeKernel, 'caminho' | 'linguagem' | 'raiz'>): AmbienteDoKernel {
    const pasta = path.dirname(pedido.caminho);
    if (pedido.linguagem === 'python') {
      return { candidatos: candidatosDePython(pasta, pedido.raiz, this.plataforma, this.existe), candidatosDePacotes: [] };
    }
    if (pedido.linguagem === 'php') {
      return {
        candidatos: [{ caminho: 'php', origem: 'sistema', rotulo: 'php do sistema (PATH)' }],
        // De onde vem o vendor (relato de 01/10: um backend/ abaixo do notebook).
        candidatosDePacotes: pastasDeVendor(pasta, pedido.raiz, this.plataforma, this.existe, this.sistema.subpastas),
      };
    }
    return {
      candidatos: candidatosDeNode(
        this.plataforma, this.sistema.execPath, this.sistema.casa, this.sistema.env, this.existe, this.sistema.subpastas
      ),
      candidatosDePacotes: pastasDePacotes(pasta, pedido.raiz, this.plataforma, this.existe, this.sistema.subpastas),
    };
  }

  sessao(caminho: string, linguagem: LinguagemDoKernel): SessaoDeKernel | undefined {
    const s = this.sessoes.get(chave(caminho, familiaDe(linguagem)));
    return s !== undefined && s.kernel.vivo ? s : undefined;
  }

  /** Os kernels vivos de um notebook, um por família. */
  sessoesDe(caminho: string): SessaoDeKernel[] {
    return [...this.sessoes.values()].filter((s) => s.kernel.vivo && this.sessoes.get(chave(caminho, s.familia)) === s);
  }

  cascata(caminho: string): Cascata {
    let c = this.cascatas.get(caminho);
    if (c === undefined) {
      c = new Cascata();
      this.cascatas.set(caminho, c);
    }
    return c;
  }

  /** O kernel de cada família, para a cascata. */
  kernelsDe(caminho: string): (familia: Familia) => Kernel | undefined {
    return (familia) => {
      const s = this.sessoes.get(chave(caminho, familia));
      return s !== undefined && s.kernel.vivo ? s.kernel : undefined;
    };
  }

  /**
   * O que veio digitado: "Outro…" é o PROGRAMA (a pasta onde ele está também
   * vale); "Outra pasta de vendor/pacotes…" é a pasta do projeto ou a própria
   * vendor/ — ambos relativos à pasta do notebook, ou com ~/.
   */
  private normalizar(pedido: PedidoDeKernel): PedidoDeKernel {
    const pasta = path.dirname(pedido.caminho);
    const resolver = (v: string) => resolverInterpretador(v, pasta, this.sistema.casa, this.plataforma);
    let saida = pedido;
    if (pedido.interpretador !== undefined) {
      const escolha = lerEscolhaDePasta(
        resolver(pedido.interpretador), pedido.linguagem, this.plataforma, this.existe, this.sistema.ehPasta
      );
      if ('erro' in escolha) throw new Error(escolha.erro);
      saida = { ...saida, interpretador: escolha.interpretador };
    }
    if (pedido.pacotes !== undefined) {
      // Um caminho relativo vira absoluto a partir da pasta do notebook.
      const bruto = /[\\/~]/.test(pedido.pacotes) ? resolver(pedido.pacotes) : path.resolve(pasta, pedido.pacotes);
      const escolha = lerPastaDePacotes(bruto, pedido.linguagem, this.plataforma, this.existe, this.sistema.ehPasta);
      if ('erro' in escolha) throw new Error(escolha.erro);
      saida = { ...saida, pacotes: escolha.pacotes };
    }
    return saida;
  }

  /** O kernel da linguagem, subindo se preciso — ou trocando, se mudou o ambiente. */
  async garantir(pedidoOriginal: PedidoDeKernel): Promise<SessaoDeKernel> {
    const pedido = this.normalizar(pedidoOriginal);
    const familia = familiaDe(pedido.linguagem);
    const k = chave(pedido.caminho, familia);
    const atual = this.sessao(pedido.caminho, pedido.linguagem);
    const mesmoInterpretador =
      pedido.interpretador === undefined ||
      atual?.interpretador.caminho ===
        resolverInterpretador(pedido.interpretador, path.dirname(pedido.caminho), this.sistema.casa, this.plataforma);
    const mesmoLaravel = pedido.laravel === undefined || atual?.laravel === pedido.laravel;
    const mesmosPacotes = pedido.pacotes === undefined || atual?.pacotes?.caminho === pedido.pacotes;
    if (atual !== undefined && mesmoInterpretador && mesmoLaravel && mesmosPacotes) return atual;
    if (atual !== undefined) this.encerrar(pedido.caminho, pedido.linguagem);

    const emCurso = this.subindo.get(k);
    if (emCurso !== undefined) return emCurso;
    const subida = this.subir(pedido).finally(() => this.subindo.delete(k));
    this.subindo.set(k, subida);
    return subida;
  }

  /** Zera UM kernel: encerra e sobe outro com o MESMO ambiente. */
  async reiniciar(caminho: string, linguagem: LinguagemDoKernel): Promise<SessaoDeKernel | undefined> {
    const s = this.sessoes.get(chave(caminho, familiaDe(linguagem)));
    if (s === undefined) return undefined;
    this.encerrar(caminho, linguagem);
    return this.garantir({
      caminho,
      linguagem: s.linguagem,
      raiz: s.raiz,
      interpretador: s.interpretador.caminho,
      laravel: s.laravel,
      ...(s.pacotes === null ? {} : { pacotes: s.pacotes.caminho }),
    });
  }

  /** Zera TODOS os kernels do notebook, e a cascata com eles. */
  async reiniciarTodos(caminho: string): Promise<SessaoDeKernel[]> {
    const antes = this.sessoesDe(caminho);
    this.encerrar(caminho);
    const novas: SessaoDeKernel[] = [];
    for (const s of antes) {
      const nova = await this.garantir({
        caminho, linguagem: s.linguagem, raiz: s.raiz, interpretador: s.interpretador.caminho, laravel: s.laravel,
        ...(s.pacotes === null ? {} : { pacotes: s.pacotes.caminho }),
      });
      novas.push(nova);
    }
    return novas;
  }

  /** Um kernel (com `linguagem`) ou todos os do notebook (sem). */
  encerrar(caminho: string, linguagem?: LinguagemDoKernel): void {
    if (linguagem !== undefined) {
      const familia = familiaDe(linguagem);
      this.sessoes.get(chave(caminho, familia))?.kernel.encerrar();
      this.sessoes.delete(chave(caminho, familia));
      this.cascatas.get(caminho)?.aoReiniciar(familia);
      return;
    }
    for (const familia of ['python', 'node', 'php'] as const) {
      this.sessoes.get(chave(caminho, familia))?.kernel.encerrar();
      this.sessoes.delete(chave(caminho, familia));
    }
    this.cascatas.delete(caminho);
  }

  encerrarTodos(): void {
    for (const s of [...this.sessoes.values()]) s.kernel.encerrar();
    this.sessoes.clear();
    this.cascatas.clear();
  }

  private async subir(pedido: PedidoDeKernel): Promise<SessaoDeKernel> {
    const pasta = path.dirname(pedido.caminho);
    const base = {
      linguagem: pedido.linguagem, familia: familiaDe(pedido.linguagem), raiz: pedido.raiz,
      laravelDisponivel: false, laravel: false, pacotes: null, candidatosDePacotes: [],
    };
    const escolhido = (valor: string): Interpretador => {
      const caminho = resolverInterpretador(valor, pasta, this.sistema.casa, this.plataforma);
      return { caminho, origem: 'escolhido', rotulo: caminho };
    };

    let sessao: SessaoDeKernel;
    if (pedido.linguagem === 'python') {
      const candidatos = candidatosDePython(pasta, pedido.raiz, this.plataforma, this.existe);
      const interpretador = pedido.interpretador === undefined
        ? candidatos[0]
        : candidatos.find((c) => c.caminho === pedido.interpretador) ?? escolhido(pedido.interpretador);
      const kernel = await this.iniciar.python(interpretador.caminho, pasta, this.plataforma);
      sessao = { ...base, kernel, interpretador, candidatos, preparar: (c) => c };
    } else if (pedido.linguagem === 'php') {
      // A pasta do vendor: a escolhida, ou a mais próxima do notebook. O
      // Laravel e a pasta de trabalho do kernel vêm DELA.
      const { candidatosDePacotes } = this.ambiente(pedido);
      const pacotes = pedido.pacotes === undefined
        ? candidatosDePacotes[0]
        : candidatosDePacotes.find((c) => c.caminho === pedido.pacotes) ?? { caminho: pedido.pacotes, rotulo: pedido.pacotes };
      const ambiente = ambientePhp(pacotes.caminho, pedido.raiz, this.plataforma, this.existe);
      const padrao: Interpretador = {
        caminho: 'php',
        origem: 'sistema',
        rotulo: ambiente.autoload === null ? 'sem vendor' : 'php',
      };
      const interpretador = pedido.interpretador === undefined ? padrao : escolhido(pedido.interpretador);
      const laravel = pedido.laravel === true && ambiente.laravel !== null;
      const kernel = await this.iniciar.php(
        interpretador.caminho, pacotes.caminho, this.plataforma, ambiente.autoload, laravel ? ambiente.laravel : null
      );
      sessao = {
        ...base, kernel, interpretador, candidatos: [padrao], preparar: (c: string) => c,
        laravelDisponivel: ambiente.laravel !== null, laravel,
        // Sem vendor em lugar nenhum, não há o que mostrar como "pacotes".
        pacotes: ambiente.autoload === null ? null : pacotes, candidatosDePacotes,
      };
    } else {
      const linguagem = pedido.linguagem;
      const { candidatos, candidatosDePacotes } = this.ambiente(pedido);
      const interpretador = pedido.interpretador === undefined
        ? candidatos[0]
        : candidatos.find((c) => c.caminho === pedido.interpretador) ?? escolhido(pedido.interpretador);
      const pacotes = pedido.pacotes === undefined
        ? candidatosDePacotes[0]
        : candidatosDePacotes.find((c) => c.caminho === pedido.pacotes) ?? { caminho: pedido.pacotes, rotulo: pedido.pacotes };
      const kernel = await this.iniciar.js(
        pacotes.caminho, this.plataforma, interpretador.origem === 'embutido' ? null : interpretador.caminho
      );
      sessao = {
        ...base, kernel, interpretador, candidatos, pacotes, candidatosDePacotes,
        // JS e TS no MESMO Node: cada célula é transformada pela linguagem DELA.
        preparar: (c: string, daCelula: LinguagemDoKernel) =>
          prepararCelulaJs(c, daCelula === 'typescript' || daCelula === 'javascript' ? daCelula : linguagem),
      };
    }
    this.sessoes.set(chave(pedido.caminho, familiaDe(pedido.linguagem)), sessao);
    return sessao;
  }
}
