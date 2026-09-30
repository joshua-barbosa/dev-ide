// Um kernel vivo do notebook — o processo e a conversa com ele (spec 112).
//
// Genérico de propósito: Python, JS/TS e PHP falam o MESMO protocolo
// (`shared/notebook/protocolo.ts`), e só o programa de dentro muda. Quem sabe
// montar o comando de cada linguagem é o gerente.
//
// Execuções são uma FILA: o kernel roda uma célula por vez, como o Jupyter.
// O texto que sai no `stdout`/`stderr` é da célula da frente da fila.
import { spawn, type ChildProcess } from 'child_process';
import { separar } from '../../shared/notebook/protocolo';
import type { Saida } from '../../shared/notebook/modelo';
import type { Plataforma } from '../../shared/plataforma';

/** Texto demais numa célula (um `print` num laço infinito) para de crescer aqui. */
export const MAX_TEXTO_POR_CELULA = 1_000_000;
/** Linhas por mensagem ao entregar um resultado de SQL ao kernel. */
const LINHAS_POR_LOTE = 5_000;
const PRAZO_DE_PARTIDA_MS = 20_000;
/**
 * Quanto a célula tem para parar depois do pedido. Passou disso, o kernel é
 * ENCERRADO: é a rede de segurança de quem não sabe ser interrompido (PHP no
 * Windows, laço síncrono de JS no Windows, uma chamada C do Python).
 */
export const PRAZO_PARA_PARAR_MS = 3_000;

export interface Execucao {
  readonly id: number;
  readonly saidas: Saida[];
  terminou: boolean;
  ok: boolean;
  textoAcumulado: number;
}

export interface InfoDoKernel {
  readonly versao: string;
  readonly executavel: string;
  /** Só Python: o `pandas` existe neste ambiente? */
  readonly pandas: boolean;
}

export interface OpcoesDoKernel {
  readonly comando: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly plataforma: Plataforma;
  /**
   * `sinal`: SIGINT de verdade (acorda até um `sleep`). `mensagem`: um pedido
   * pelo canal, para quem não recebe sinal (Windows) — o driver faz o que der.
   */
  readonly interromperPor: 'sinal' | 'mensagem';
}

type Mensagem = { readonly tipo?: string; readonly [k: string]: unknown };

export class Kernel {
  private readonly execucoes = new Map<number, Execucao>();
  /** A fila: a da frente é a que está rodando. */
  private readonly fila: Execucao[] = [];
  private proximo = 1;
  private buffer = '';
  private morreu: string | null = null;
  private esperandoDefinicao: ((m: Mensagem) => void) | null = null;

  private constructor(
    private readonly processo: ChildProcess,
    private readonly interromperPor: 'sinal' | 'mensagem',
    readonly info: InfoDoKernel
  ) {}

  /** Sobe o processo e espera o "pronto" do driver. */
  static iniciar(opcoes: OpcoesDoKernel): Promise<Kernel> {
    return new Promise((resolver, recusar) => {
      let processo: ChildProcess;
      try {
        processo = spawn(opcoes.comando, [...opcoes.args], {
          cwd: opcoes.cwd,
          env: { ...process.env, ...opcoes.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (e) {
        recusar(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      let kernel: Kernel | null = null;
      let stderrDaPartida = '';
      /** O "pronto" pode chegar partido em dois pedaços do canal. */
      let bufferDaPartida = '';
      const prazo = setTimeout(() => {
        processo.kill();
        recusar(new Error(`O kernel não respondeu em ${PRAZO_DE_PARTIDA_MS / 1000} s.${detalhe()}`));
      }, PRAZO_DE_PARTIDA_MS);
      const detalhe = (): string => (stderrDaPartida.trim() === '' ? '' : `\n${stderrDaPartida.trim()}`);

      processo.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(prazo);
        recusar(new Error(
          e.code === 'ENOENT'
            ? `Não encontrei o programa "${opcoes.comando}". Ele está instalado e no PATH?`
            : e.message
        ));
      });

      processo.stderr?.setEncoding('utf8');
      processo.stderr?.on('data', (texto: string) => {
        if (kernel === null) stderrDaPartida += texto;
        else kernel.aoTexto(texto, 'erro');
      });

      processo.stdout?.setEncoding('utf8');
      processo.stdout?.on('data', (texto: string) => {
        if (kernel !== null) {
          kernel.aoStdout(texto);
          return;
        }
        // Antes do "pronto" só pode vir o próprio "pronto" (ou lixo de partida).
        const { itens, resto } = separar(bufferDaPartida + texto);
        bufferDaPartida = resto;
        for (const item of itens) {
          if (!('mensagem' in item)) continue;
          const m = item.mensagem as Mensagem;
          if (m.tipo !== 'pronto') continue;
          clearTimeout(prazo);
          kernel = new Kernel(processo, opcoes.interromperPor, {
            versao: String(m.versao ?? ''),
            executavel: String(m.executavel ?? opcoes.comando),
            pandas: m.pandas === true,
          });
          resolver(kernel);
        }
      });

      processo.on('exit', (codigo, sinal) => {
        clearTimeout(prazo);
        if (kernel === null) {
          recusar(new Error(`O kernel saiu antes de ficar pronto (código ${codigo ?? sinal}).${detalhe()}`));
        } else {
          kernel.aoMorrer(`O kernel parou (código ${codigo ?? sinal}).`);
        }
      });
    });
  }

  get vivo(): boolean {
    return this.morreu === null;
  }

  get ocupado(): boolean {
    return this.fila.length > 0;
  }

  /** Põe uma célula na fila. O resultado se acompanha por `execucao(id)`. */
  executar(codigo: string): Execucao {
    const e: Execucao = { id: this.proximo++, saidas: [], terminou: false, ok: false, textoAcumulado: 0 };
    this.execucoes.set(e.id, e);
    if (this.morreu !== null) {
      e.saidas.push({ tipo: 'erro', mensagem: this.morreu });
      e.terminou = true;
      return e;
    }
    this.fila.push(e);
    this.escrever({ tipo: 'executar', exec: e.id, codigo });
    return e;
  }

  execucao(id: number): Execucao | undefined {
    return this.execucoes.get(id);
  }

  /** Entrega um resultado de SQL como variável. Em lotes: pode ser enorme. */
  definir(
    nome: string,
    colunas: readonly string[],
    linhas: readonly (readonly unknown[])[]
  ): Promise<{ readonly linhas: number; readonly forma: string }> {
    if (this.morreu !== null) return Promise.reject(new Error(this.morreu));
    return new Promise((resolver, recusar) => {
      this.esperandoDefinicao = (m) => {
        this.esperandoDefinicao = null;
        if (m.tipo === 'definido') resolver({ linhas: Number(m.linhas), forma: String(m.forma) });
        else recusar(new Error(String(m.mensagem ?? 'O kernel parou antes de receber o resultado.')));
      };
      this.escrever({ tipo: 'definir-inicio', nome, colunas });
      for (let i = 0; i < linhas.length; i += LINHAS_POR_LOTE) {
        this.escrever({ tipo: 'definir-lote', linhas: linhas.slice(i, i + LINHAS_POR_LOTE) });
      }
      this.escrever({ tipo: 'definir-fim' });
    });
  }

  /**
   * Interrompe a célula da frente, SEM perder as variáveis.
   *
   * Linux/Mac: SIGINT de verdade — acorda até um `sleep`. Windows: o Node só
   * sabe matar, então vai a mensagem que o driver transforma em interrupção.
   */
  interromper(): void {
    const alvo = this.fila[0];
    if (alvo === undefined || this.morreu !== null) return;
    if (this.interromperPor === 'sinal') this.processo.kill('SIGINT');
    else this.escrever({ tipo: 'interromper' });
    // A rede de segurança: quem não parou, é encerrado — e diz por quê.
    setTimeout(() => {
      if (!alvo.terminou && this.morreu === null) {
        this.encerrar(
          `A célula não parou em ${PRAZO_PARA_PARAR_MS / 1000} s, e o kernel foi encerrado ` +
            '(as variáveis se perderam). Rodar de novo sobe outro.'
        );
      }
    }, PRAZO_PARA_PARAR_MS).unref();
  }

  encerrar(motivo = 'O kernel foi encerrado.'): void {
    this.aoMorrer(motivo);
    this.processo.stdin?.end();
    this.processo.kill();
  }

  // -------------------------------------------------------------------------

  private escrever(dados: unknown): void {
    this.processo.stdin?.write(`${JSON.stringify(dados)}\n`);
  }

  private aoStdout(pedaco: string): void {
    const { itens, resto } = separar(this.buffer + pedaco);
    this.buffer = resto;
    for (const item of itens) {
      if ('texto' in item) this.aoTexto(item.texto, 'saida');
      else this.aoMensagem(item.mensagem as Mensagem);
    }
  }

  /** Texto solto vai para a célula da frente, emendado no último pedaço. */
  private aoTexto(texto: string, fluxo: 'saida' | 'erro'): void {
    const e = this.fila[0];
    if (e === undefined || texto === '') return;
    if (e.textoAcumulado >= MAX_TEXTO_POR_CELULA) return;
    const cabe = texto.slice(0, MAX_TEXTO_POR_CELULA - e.textoAcumulado);
    e.textoAcumulado += cabe.length;
    const ultima = e.saidas[e.saidas.length - 1];
    if (ultima?.tipo === 'texto' && ultima.fluxo === fluxo) {
      e.saidas[e.saidas.length - 1] = { ...ultima, texto: ultima.texto + cabe };
    } else {
      e.saidas.push({ tipo: 'texto', fluxo, texto: cabe });
    }
    if (e.textoAcumulado >= MAX_TEXTO_POR_CELULA) {
      e.saidas.push({ tipo: 'texto', fluxo: 'erro', texto: '\n… saída cortada: a célula escreveu mais de 1 MB.\n' });
    }
  }

  private aoMensagem(m: Mensagem): void {
    // O stderr da célula, que o driver manda pelo canal para chegar em ordem.
    if (m.tipo === 'texto') {
      this.aoTexto(String(m.texto ?? ''), m.fluxo === 'erro' ? 'erro' : 'saida');
      return;
    }
    if (m.tipo === 'definido') {
      this.esperandoDefinicao?.(m);
      return;
    }
    const e = typeof m.exec === 'number' ? this.execucoes.get(m.exec) : undefined;
    if (e === undefined) return;
    if (m.tipo === 'resultado' && typeof m.saida === 'object' && m.saida !== null) {
      e.saidas.push(m.saida as Saida);
    } else if (m.tipo === 'erro') {
      e.saidas.push({ tipo: 'erro', mensagem: String(m.mensagem ?? '') });
    } else if (m.tipo === 'fim') {
      e.ok = m.ok === true;
      e.terminou = true;
      const i = this.fila.indexOf(e);
      if (i !== -1) this.fila.splice(i, 1);
    }
  }

  private aoMorrer(motivo: string): void {
    if (this.morreu !== null) return;
    this.morreu = motivo;
    for (const e of this.fila.splice(0)) {
      e.saidas.push({ tipo: 'erro', mensagem: motivo });
      e.terminou = true;
    }
    this.esperandoDefinicao?.({ tipo: 'erro', mensagem: motivo });
  }
}
