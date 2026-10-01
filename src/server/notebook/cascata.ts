// A cascata entre linguagens de um notebook (spec 113, etapa 3).
//
// O pedido: *"se em outra célula eu edito o valor daquele resultado… o quarto
// em diante precisa receber o 'pedidos' alterado, assim como funciona o
// Jupyter"* — e com Node, Python, Node, SQL, Python intercalados.
//
// Python, Node e PHP não dividem memória. Então cada kernel sabe dizer o que
// MUDOU nele (o driver compara a impressão digital de cada variável), e esta
// classe guarda a última versão de cada nome e quem a fez. Antes de uma célula
// rodar na linguagem L:
//   1. as OUTRAS linguagens que rodaram desde a última vez exportam o que
//      mudaram (preguiçoso: três células Python seguidas não copiam nada);
//   2. L recebe tudo o que mudou e ela ainda não viu.
// O mesmo nome mudado em duas linguagens: vale o mais recente, pela ordem em
// que as células RODARAM — como no Jupyter.
import type { Kernel as Linguagem } from '../../shared/notebook/modelo';

/** Um processo por família: JavaScript e TypeScript dividem o Node. */
export type Familia = 'python' | 'node' | 'php';

export function familiaDe(linguagem: Linguagem): Familia {
  return linguagem === 'javascript' || linguagem === 'typescript' ? 'node' : linguagem;
}

/** O que a cascata precisa de um kernel. */
export interface KernelDeDados {
  readonly vivo: boolean;
  exportar(): Promise<Readonly<Record<string, unknown>>>;
  importar(valores: Readonly<Record<string, unknown>>): Promise<void>;
}

type Kernels = (familia: Familia) => KernelDeDados | undefined;

interface Versao {
  readonly valor: unknown;
  readonly versao: number;
  readonly origem: Familia;
}

export class Cascata {
  private readonly ultimas = new Map<string, Versao>();
  private versao = 0;
  /** Até que versão cada família já recebeu. */
  private readonly vistoAte = new Map<Familia, number>();
  /** Famílias que rodaram célula desde a última exportação. */
  private readonly sujas = new Set<Familia>();
  private ultimaQueRodou: Familia | null = null;

  /** A família da última célula que rodou — o dono provável de um nome. */
  get ultima(): Familia | null {
    return this.ultimaQueRodou;
  }

  /** Quem mudou este nome por último (depois de `sincronizar`). */
  origemDe(nome: string): Familia | undefined {
    return this.ultimas.get(nome)?.origem;
  }

  /** Recolhe o que as famílias sujas mudaram (menos `exceto`). */
  async sincronizar(kernels: Kernels, exceto: Familia | null = null): Promise<void> {
    for (const familia of [...this.sujas]) {
      if (familia === exceto) continue;
      const kernel = kernels(familia);
      this.sujas.delete(familia);
      if (kernel === undefined || !kernel.vivo) continue;
      const mudou = await kernel.exportar();
      for (const [nome, valor] of Object.entries(mudou)) {
        this.versao += 1;
        this.ultimas.set(nome, { valor, versao: this.versao, origem: familia });
      }
      // O que ela mesma mudou ela já tem.
      this.vistoAte.set(familia, Math.max(this.vistoAte.get(familia) ?? 0, this.versao));
    }
  }

  /** Antes de uma célula da família: recolhe das outras e entrega a ela. */
  async antesDeRodar(familia: Familia, kernels: Kernels): Promise<void> {
    await this.sincronizar(kernels, familia);
    const visto = this.vistoAte.get(familia) ?? 0;
    const novas: Record<string, unknown> = {};
    for (const [nome, v] of this.ultimas) {
      if (v.versao > visto && v.origem !== familia) novas[nome] = v.valor;
    }
    const kernel = kernels(familia);
    if (Object.keys(novas).length > 0 && kernel !== undefined && kernel.vivo) await kernel.importar(novas);
    this.vistoAte.set(familia, this.versao);
    this.sujas.add(familia);
    this.ultimaQueRodou = familia;
  }

  /**
   * Um SQL entregou `nome` a todas as linguagens: ele é o valor mais novo, e a
   * versão velha da cascata não pode passar por cima dele depois.
   */
  aoDefinir(nome: string): void {
    this.ultimas.delete(nome);
  }

  /** O kernel reiniciou vazio: o que ele tinha antes não volta. */
  aoReiniciar(familia: Familia): void {
    this.sujas.delete(familia);
    this.vistoAte.set(familia, this.versao);
    for (const [nome, v] of [...this.ultimas]) {
      if (v.origem === familia) this.ultimas.delete(nome);
    }
  }
}
