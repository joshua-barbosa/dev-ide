// Vigia a pasta aberta e avisa quando o disco muda por fora da IDE.
//
// O buraco que isto fecha não é conforto: é **perda de trabalho**. Com um
// arquivo aberto na IDE e alterado por fora (um `git checkout`, um script, o
// outro editor), salvar a aba sobrescrevia o que veio de fora sem uma palavra.
//
// **Dois modos, e quem escolhe é a plataforma (D224).**
//
// No **Linux** é um observador por pasta, andando a árvore nós mesmos. O
// `recursive: true` observaria TODO subdiretório, inclusive `node_modules` e
// `.venv` — que é exatamente onde mora o problema do `inotify`: o sistema tem
// um limite de observadores por usuário, e uma `.venv` come milhares deles.
//
// No **Windows e no macOS** esse limite não existe: `fs.watch` recursivo é UM
// handle (`ReadDirectoryChangesW`, FSEvents) que já entrega a subárvore
// inteira. Aplicar ali a regra do Linux abria dois mil handles onde um bastava,
// batia no teto e ainda andava a árvore toda de forma síncrona na subida — foi
// o que ele viu como "subpastas demais para vigiar por inteiro" e como parte da
// demora para abrir a IDE.
//
// O `.gitignore` vale nos dois: no modo recursivo ele é conferido no aviso, em
// vez de na escolha de o que observar. O que a varredura ignora, o vigia
// ignora.
import * as fs from 'fs';
import * as path from 'path';
import { ignorado, lerRegras, REGRAS_PADRAO, type Regra } from '../shared/gitignore';
import { plataformaAtual, type Plataforma } from '../shared/plataforma';
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

/**
 * Esta plataforma observa uma subárvore inteira com um handle só?
 *
 * Pura, e é o ponto todo: a decisão do Windows fica conferível numa máquina
 * Linux, em vez de só na dele.
 */
export function usaVigiaRecursivo(plataforma: Plataforma): boolean {
  return plataforma === 'win32' || plataforma === 'darwin';
}

export interface OpcoesDoVigia {
  readonly aoMudar: (mudancas: readonly Mudanca[]) => void;
  /** Avisa que o teto foi batido — a IDE deixa de ver parte da pasta. */
  readonly aoLotar?: () => void;
  /** Argumento, e não leitura do sistema: é o que torna o Windows testável. */
  readonly plataforma?: Plataforma;
}

export class Vigia {
  private readonly observadores = new Map<string, fs.FSWatcher>();
  private readonly pendentes = new Map<string, Mudanca>();
  private temporizador: NodeJS.Timeout | null = null;
  private parado = false;
  private avisouQueLotou = false;
  /** Regras de `.gitignore` já lidas, por pasta — usado no modo recursivo. */
  private readonly regrasPorPasta = new Map<string, readonly Regra[]>();
  private readonly recursivo: boolean;

  constructor(
    private readonly raiz: string,
    private readonly opcoes: OpcoesDoVigia
  ) {
    this.recursivo = usaVigiaRecursivo(opcoes.plataforma ?? plataformaAtual());
    if (this.recursivo) this.observarTudo(raiz);
    else this.observar(raiz, 0, REGRAS_PADRAO);
  }

  /**
   * Um observador só, para a subárvore inteira.
   *
   * O `nome` do evento vem RELATIVO à raiz (`src/ui/a.ts`), e não como nome
   * solto — é o que permite descobrir a pasta de verdade do arquivo. Dizer a
   * raiz faria a interface recarregar o nível errado, e a pasta aberta ficaria
   * com o conteúdo velho.
   */
  private observarTudo(raiz: string): void {
    let observador: fs.FSWatcher;
    try {
      observador = fs.watch(raiz, { recursive: true }, (_evento, nome) => {
        if (nome === null) return;
        const caminho = path.resolve(raiz, String(nome));
        this.registrar(path.dirname(caminho), path.basename(caminho), null, 0);
      });
    } catch {
      // Sem permissão ou pasta removida: não observar não é erro.
      return;
    }
    observador.on('error', () => this.esquecer(raiz));
    this.observadores.set(raiz, observador);
  }

  /**
   * As regras que valem para uma pasta, somando os `.gitignore` do caminho.
   *
   * No modo por-pasta as regras descem junto com a andada. No recursivo não há
   * andada, então elas são montadas quando o primeiro evento daquela pasta
   * chega — e ficam guardadas, porque um `git checkout` traz centenas deles.
   */
  private regrasAcumuladas(dir: string): readonly Regra[] {
    const guardadas = this.regrasPorPasta.get(dir);
    if (guardadas !== undefined) return guardadas;

    const relativo = path.relative(this.raiz, dir);
    const regras = relativo === '' || relativo.startsWith('..')
      ? this.regrasDe(this.raiz, REGRAS_PADRAO)
      : this.regrasDe(dir, this.regrasAcumuladas(path.dirname(dir)));

    this.regrasPorPasta.set(dir, regras);
    return regras;
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
    /** `null` no modo recursivo: as regras são montadas aqui, sob demanda. */
    herdadas: readonly Regra[] | null,
    profundidade: number
  ): void {
    if (this.parado) return;
    const caminho = path.join(dir, nome);
    const regras = herdadas ?? this.regrasAcumuladas(dir);

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

    if (!this.recursivo) {
      if (existe && ehPasta) this.observar(caminho, profundidade + 1, regras);
      if (!existe) this.esquecer(caminho);
    } else if (!existe) {
      // O handle é um só e continua de pé; o que se descarta é o `.gitignore`
      // guardado da pasta que sumiu, para uma pasta recriada não herdar regras
      // de uma vida anterior.
      this.regrasPorPasta.delete(caminho);
    }

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
