// Um kernel por notebook aberto (spec 112, etapa 2).
//
// A chave é o CAMINHO do `.brnb`: trocar de aba e voltar reencontra o mesmo
// kernel, com as variáveis. Fechar o notebook o encerra; o motor, ao sair,
// encerra todos — um Python órfão segurando um DataFrame de 2 GB não é algo que
// se deixa para trás.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ambientePhp, candidatosDePython, type Interpretador } from './ambiente';
import { candidatosDeNode, pastasDePacotes, type PastaDePacotes } from './ambiente-node';
import { iniciarKernelJs, iniciarKernelPhp, iniciarKernelPython } from './kernel-python';
import { prepararCelulaJs } from './celula-js';
import type { Kernel } from './kernel';
import type { Kernel as LinguagemDoKernel } from '../../shared/notebook/modelo';
import type { Plataforma } from '../../shared/plataforma';

export interface SessaoDeKernel {
  readonly kernel: Kernel;
  readonly linguagem: LinguagemDoKernel;
  readonly interpretador: Interpretador;
  readonly candidatos: readonly Interpretador[];
  readonly raiz: string | null;
  /** O que a célula vira antes de ir ao kernel (JS/TS: ver `celula-js.ts`). */
  readonly preparar: (codigo: string) => string;
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
}

function subpastasDoDisco(caminho: string): readonly string[] {
  try {
    return fs.readdirSync(caminho, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

const SISTEMA_REAL: SistemaDoKernel = {
  subpastas: subpastasDoDisco, casa: os.homedir(), env: process.env, execPath: process.execPath,
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

export class GerenteDeKernels {
  private readonly sessoes = new Map<string, SessaoDeKernel>();
  /** Duas abas pedindo o mesmo kernel ao mesmo tempo sobem UM. */
  private readonly subindo = new Map<string, Promise<SessaoDeKernel>>();

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
      return { candidatos: [{ caminho: 'php', origem: 'sistema', rotulo: 'php do sistema (PATH)' }], candidatosDePacotes: [] };
    }
    return {
      candidatos: candidatosDeNode(
        this.plataforma, this.sistema.execPath, this.sistema.casa, this.sistema.env, this.existe, this.sistema.subpastas
      ),
      candidatosDePacotes: pastasDePacotes(pasta, pedido.raiz, this.plataforma, this.existe, this.sistema.subpastas),
    };
  }

  sessao(caminho: string): SessaoDeKernel | undefined {
    const s = this.sessoes.get(caminho);
    return s !== undefined && s.kernel.vivo ? s : undefined;
  }

  /** O kernel do notebook, subindo se preciso — ou trocando, se mudou o interpretador. */
  async garantir(pedido: PedidoDeKernel): Promise<SessaoDeKernel> {
    const atual = this.sessao(pedido.caminho);
    const mesmoInterpretador =
      pedido.interpretador === undefined || atual?.interpretador.caminho === pedido.interpretador;
    const mesmoLaravel = pedido.laravel === undefined || atual?.laravel === pedido.laravel;
    const mesmosPacotes = pedido.pacotes === undefined || atual?.pacotes?.caminho === pedido.pacotes;
    if (
      atual !== undefined && atual.linguagem === pedido.linguagem &&
      mesmoInterpretador && mesmoLaravel && mesmosPacotes
    ) {
      return atual;
    }
    if (atual !== undefined) this.encerrar(pedido.caminho);

    const emCurso = this.subindo.get(pedido.caminho);
    if (emCurso !== undefined) return emCurso;
    const subida = this.subir(pedido).finally(() => this.subindo.delete(pedido.caminho));
    this.subindo.set(pedido.caminho, subida);
    return subida;
  }

  /** Zera o estado: encerra e sobe outro com o MESMO interpretador. */
  async reiniciar(caminho: string): Promise<SessaoDeKernel | undefined> {
    const s = this.sessoes.get(caminho);
    if (s === undefined) return undefined;
    this.encerrar(caminho);
    return this.garantir({
      caminho,
      linguagem: s.linguagem,
      raiz: s.raiz,
      interpretador: s.interpretador.caminho,
      laravel: s.laravel,
      ...(s.pacotes === null ? {} : { pacotes: s.pacotes.caminho }),
    });
  }

  encerrar(caminho: string): void {
    this.sessoes.get(caminho)?.kernel.encerrar();
    this.sessoes.delete(caminho);
  }

  encerrarTodos(): void {
    for (const caminho of [...this.sessoes.keys()]) this.encerrar(caminho);
  }

  private async subir(pedido: PedidoDeKernel): Promise<SessaoDeKernel> {
    const pasta = path.dirname(pedido.caminho);
    const base = {
      linguagem: pedido.linguagem, raiz: pedido.raiz, laravelDisponivel: false, laravel: false,
      pacotes: null, candidatosDePacotes: [],
    };
    const escolhido = (caminho: string): Interpretador => ({ caminho, origem: 'escolhido', rotulo: caminho });

    let sessao: SessaoDeKernel;
    if (pedido.linguagem === 'python') {
      const candidatos = candidatosDePython(pasta, pedido.raiz, this.plataforma, this.existe);
      const interpretador = pedido.interpretador === undefined
        ? candidatos[0]
        : candidatos.find((c) => c.caminho === pedido.interpretador) ?? escolhido(pedido.interpretador);
      const kernel = await this.iniciar.python(interpretador.caminho, pasta, this.plataforma);
      sessao = { ...base, kernel, interpretador, candidatos, preparar: (c) => c };
    } else if (pedido.linguagem === 'php') {
      const ambiente = ambientePhp(pasta, pedido.raiz, this.plataforma, this.existe);
      const padrao: Interpretador = {
        caminho: 'php',
        origem: 'sistema',
        rotulo: ambiente.autoload === null ? 'sem vendor' : 'vendor do projeto',
      };
      const interpretador = pedido.interpretador === undefined ? padrao : escolhido(pedido.interpretador);
      const laravel = pedido.laravel === true && ambiente.laravel !== null;
      const kernel = await this.iniciar.php(
        interpretador.caminho, pasta, this.plataforma, ambiente.autoload, laravel ? ambiente.laravel : null
      );
      sessao = {
        ...base, kernel, interpretador, candidatos: [padrao], preparar: (c) => c,
        laravelDisponivel: ambiente.laravel !== null, laravel,
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
        preparar: (c) => prepararCelulaJs(c, linguagem),
      };
    }
    this.sessoes.set(pedido.caminho, sessao);
    return sessao;
  }
}
