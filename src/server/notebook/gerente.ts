// Um kernel por notebook aberto (spec 112, etapa 2).
//
// A chave é o CAMINHO do `.brnb`: trocar de aba e voltar reencontra o mesmo
// kernel, com as variáveis. Fechar o notebook o encerra; o motor, ao sair,
// encerra todos — um Python órfão segurando um DataFrame de 2 GB não é algo que
// se deixa para trás.
import * as fs from 'fs';
import * as path from 'path';
import { candidatosDePython, type Interpretador } from './ambiente';
import { iniciarKernelPython } from './kernel-python';
import type { Kernel } from './kernel';
import type { Kernel as LinguagemDoKernel } from '../../shared/notebook/modelo';
import type { Plataforma } from '../../shared/plataforma';

export interface SessaoDeKernel {
  readonly kernel: Kernel;
  readonly linguagem: LinguagemDoKernel;
  readonly interpretador: Interpretador;
  readonly candidatos: readonly Interpretador[];
  readonly raiz: string | null;
}

export interface PedidoDeKernel {
  readonly caminho: string;
  readonly linguagem: LinguagemDoKernel;
  /** A raiz do projeto que contém o notebook — o limite da busca por `.venv`. */
  readonly raiz: string | null;
  /** Um interpretador escolhido à mão; ausente = o primeiro candidato. */
  readonly interpretador?: string;
}

export class GerenteDeKernels {
  private readonly sessoes = new Map<string, SessaoDeKernel>();
  /** Duas abas pedindo o mesmo kernel ao mesmo tempo sobem UM. */
  private readonly subindo = new Map<string, Promise<SessaoDeKernel>>();

  constructor(
    private readonly plataforma: Plataforma,
    private readonly existe: (caminho: string) => boolean = fs.existsSync,
    private readonly subirPython: typeof iniciarKernelPython = iniciarKernelPython
  ) {}

  sessao(caminho: string): SessaoDeKernel | undefined {
    const s = this.sessoes.get(caminho);
    return s !== undefined && s.kernel.vivo ? s : undefined;
  }

  /** O kernel do notebook, subindo se preciso — ou trocando, se mudou o interpretador. */
  async garantir(pedido: PedidoDeKernel): Promise<SessaoDeKernel> {
    const atual = this.sessao(pedido.caminho);
    const mesmoInterpretador =
      pedido.interpretador === undefined || atual?.interpretador.caminho === pedido.interpretador;
    if (atual !== undefined && atual.linguagem === pedido.linguagem && mesmoInterpretador) return atual;
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
    if (pedido.linguagem !== 'python') {
      throw new Error(`O kernel ${pedido.linguagem} chega na etapa 3 do notebook; por ora, só Python.`);
    }
    const pasta = path.dirname(pedido.caminho);
    const candidatos = candidatosDePython(pasta, pedido.raiz, this.plataforma, this.existe);
    const interpretador: Interpretador =
      pedido.interpretador === undefined
        ? candidatos[0]
        : candidatos.find((c) => c.caminho === pedido.interpretador) ?? {
            caminho: pedido.interpretador,
            origem: 'escolhido',
            rotulo: pedido.interpretador,
          };
    const kernel = await this.subirPython(interpretador.caminho, pasta, this.plataforma);
    const sessao: SessaoDeKernel = {
      kernel, linguagem: pedido.linguagem, interpretador, candidatos, raiz: pedido.raiz,
    };
    this.sessoes.set(pedido.caminho, sessao);
    return sessao;
  }
}
