// Vigia a pasta aberta e avisa quando o disco muda por fora da IDE.
//
// O buraco que isto fecha não é conforto: é **perda de trabalho**. Com um
// arquivo aberto na IDE e alterado por fora (um `git checkout`, um script, o
// outro editor), salvar a aba sobrescrevia o que veio de fora sem uma palavra.
//
// **Por que um vigia por pasta, e não o `recursive: true` do Node.** O modo
// recursivo do `fs.watch` observa TODO subdiretório, inclusive `node_modules` e
// `.venv` — que é exatamente onde mora o problema do `inotify`: o sistema tem
// um limite de observadores por usuário, e uma `.venv` come milhares deles.
// Andando nós mesmos, aplicamos as mesmas regras da varredura e observamos só
// o que interessa.
import * as fs from 'fs';
import * as path from 'path';
import { ignorado, lerRegras, REGRAS_PADRAO, type Regra } from '../shared/gitignore';
import { MAX_PROFUNDIDADE } from './pastas';

export type TipoDeMudanca = 'criado' | 'alterado' | 'removido';

export interface Mudanca {
  readonly caminho: string;
  readonly tipo: TipoDeMudanca;
  /** A pasta que contém o item — é o que a árvore precisa recarregar. */
  readonly pasta: string;
}

/**
 * Teto de pastas observadas.
 *
 * O `inotify` do Linux tem limite por usuário (`max_user_watches`, 8192 por
 * padrão em muitas distribuições) e ele é COMPARTILHADO com todo o resto que
 * observa arquivos na máquina. Estourar não dá erro claro: o `fs.watch` começa
 * a falhar em silêncio. Um teto nosso, com aviso, é melhor que descobrir isso
 * pelo sintoma.
 */
export const MAX_VIGIADAS = 2_000;

/**
 * Espera antes de avisar.
 *
 * Um `git checkout` gera centenas de eventos em milissegundos, e cada um
 * viraria um pedido à árvore. Agrupar é o que transforma isso em um aviso só.
 */
export const ATRASO_MS = 120;

export interface OpcoesDoVigia {
  readonly aoMudar: (mudancas: readonly Mudanca[]) => void;
  /** Avisa que o teto foi batido — a IDE deixa de ver parte da pasta. */
  readonly aoLotar?: () => void;
}

export class Vigia {
  private readonly observadores = new Map<string, fs.FSWatcher>();
  private readonly pendentes = new Map<string, Mudanca>();
  private temporizador: NodeJS.Timeout | null = null;
  private parado = false;
  private avisouQueLotou = false;

  constructor(
    private readonly raiz: string,
    private readonly opcoes: OpcoesDoVigia
  ) {
    this.observar(raiz, 0, REGRAS_PADRAO);
  }

  /** Quantas pastas estão sendo observadas agora. */
  get tamanho(): number {
    return this.observadores.size;
  }

  parar(): void {
    this.parado = true;
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    for (const observador of this.observadores.values()) observador.close();
    this.observadores.clear();
  }

  private regrasDe(dir: string, herdadas: readonly Regra[]): readonly Regra[] {
    const proprio = path.join(dir, '.gitignore');
    try {
      if (fs.existsSync(proprio)) {
        return [...herdadas, ...lerRegras(fs.readFileSync(proprio, 'utf8'))];
      }
    } catch {
      // Ilegível: segue com as herdadas.
    }
    return herdadas;
  }

  private ehIgnorado(caminho: string, ehPasta: boolean, regras: readonly Regra[]): boolean {
    const relativo = path.relative(this.raiz, caminho).split(path.sep).join('/');
    if (relativo === '' || relativo.startsWith('..')) return false;
    return ignorado(relativo, ehPasta, regras);
  }

  private observar(dir: string, profundidade: number, herdadas: readonly Regra[]): void {
    if (this.parado || profundidade > MAX_PROFUNDIDADE) return;
    if (this.observadores.has(dir)) return;
    if (this.observadores.size >= MAX_VIGIADAS) {
      if (!this.avisouQueLotou) {
        this.avisouQueLotou = true;
        this.opcoes.aoLotar?.();
      }
      return;
    }

    const regras = this.regrasDe(dir, herdadas);

    let observador: fs.FSWatcher;
    try {
      observador = fs.watch(dir, (_evento, nome) => {
        if (nome === null) return;
        this.registrar(dir, String(nome), regras, profundidade);
      });
    } catch {
      // Pasta sem permissão, ou já removida: não observar não é erro.
      return;
    }
    // Pasta apagada derruba o observador dela; o da pasta-mãe avisa a remoção.
    observador.on('error', () => this.esquecer(dir));
    this.observadores.set(dir, observador);

    let entradas: fs.Dirent[];
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      if (!entrada.isDirectory()) continue;
      const filha = path.join(dir, entrada.name);
      if (this.ehIgnorado(filha, true, regras)) continue;
      this.observar(filha, profundidade + 1, regras);
    }
  }

  private esquecer(dir: string): void {
    this.observadores.get(dir)?.close();
    this.observadores.delete(dir);
    // As de baixo morrem junto: a pasta-mãe sumiu.
    for (const caminho of [...this.observadores.keys()]) {
      if (caminho.startsWith(dir + path.sep)) {
        this.observadores.get(caminho)?.close();
        this.observadores.delete(caminho);
      }
    }
  }

  private registrar(
    dir: string,
    nome: string,
    regras: readonly Regra[],
    profundidade: number
  ): void {
    if (this.parado) return;
    const caminho = path.join(dir, nome);

    let existe = false;
    let ehPasta = false;
    try {
      const st = fs.statSync(caminho);
      existe = true;
      ehPasta = st.isDirectory();
    } catch {
      existe = false;
    }

    // O que a varredura ignora, o vigia ignora: senão um `npm install` viraria
    // uma tempestade de avisos sobre arquivos que a IDE nem indexa.
    if (this.ehIgnorado(caminho, ehPasta, regras)) return;

    if (existe && ehPasta) this.observar(caminho, profundidade + 1, regras);
    if (!existe) this.esquecer(caminho);

    this.pendentes.set(caminho, {
      caminho,
      pasta: dir,
      // Sem guardar o estado anterior de cada arquivo, "criado" e "alterado"
      // não se distinguem com honestidade. Quem recebe trata os dois igual —
      // relê o que precisa —, então a distinção seria custo sem uso.
      tipo: existe ? 'alterado' : 'removido',
    });

    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      const lote = [...this.pendentes.values()];
      this.pendentes.clear();
      if (lote.length > 0) this.opcoes.aoMudar(lote);
    }, ATRASO_MS);
  }
}
