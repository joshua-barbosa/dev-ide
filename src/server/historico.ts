// O histórico local em disco: `~/.dev-ide/historico/` (T010, T035).
//
// **Uma pasta por arquivo, um arquivo por versão**, e um `indice.json` ao lado.
// A alternativa — tudo num JSON só — foi descartada: o conteúdo das versões vira
// megabytes, e reescrever o arquivo inteiro a cada save custaria o dobro do
// próprio save. Assim, gravar uma versão é escrever UM arquivo novo.
//
// O índice existe para a tela listar sem abrir cinquenta arquivos. Ele pode
// discordar do disco se alguém apagar coisas à mão — e por isso a leitura
// tolera versão faltando em vez de quebrar.
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  chaveDoArquivo, podar, POLITICA_PADRAO, valeGuardar,
  type OrigemDaVersao, type PoliticaDeHistorico, type VersaoComTexto, type VersaoLocal,
} from '../shared/historico-local';
import { gravarJsonAtomico, lerJsonTolerante } from './arquivo-json';
import { arquivoDeDados } from './paths';

interface Indice {
  /** O caminho original, para a tela mostrar de quem é este histórico. */
  readonly caminho: string;
  readonly versoes: readonly VersaoLocal[];
}

export class HistoricoStore {
  /** `~/.dev-ide/historico/` — uma pasta por arquivo lá dentro. */
  static defaultPath(): string {
    return arquivoDeDados('historico');
  }

  constructor(
    private readonly raiz: string,
    private readonly politica: PoliticaDeHistorico = POLITICA_PADRAO,
    private readonly agora: () => number = Date.now
  ) {}

  private pastaDe(caminho: string): string {
    return path.join(this.raiz, chaveDoArquivo(caminho));
  }

  private indiceDe(caminho: string): Indice {
    const bruto = lerJsonTolerante(path.join(this.pastaDe(caminho), 'indice.json'));
    if (bruto === null || typeof bruto !== 'object') return { caminho, versoes: [] };
    const r = bruto as Record<string, unknown>;
    const versoes = Array.isArray(r.versoes) ? r.versoes : [];
    return {
      caminho: typeof r.caminho === 'string' ? r.caminho : caminho,
      // Uma entrada estragada some, e as outras ficam: um índice meio escrito
      // não pode custar o histórico inteiro de um arquivo.
      versoes: versoes.filter((v): v is VersaoLocal => ehVersao(v)),
    };
  }

  /** As versões de um arquivo, da mais nova para a mais velha. */
  listar(caminho: string): readonly VersaoLocal[] {
    return [...this.indiceDe(caminho).versoes].sort((a, b) => b.quando - a.quando);
  }

  /** O texto de uma versão, ou `null` se ela não está mais lá. */
  ler(caminho: string, id: string): VersaoComTexto | null {
    const versao = this.indiceDe(caminho).versoes.find((v) => v.id === id);
    if (versao === undefined) return null;
    try {
      const conteudo = fs.readFileSync(path.join(this.pastaDe(caminho), `${id}.txt`), 'utf8');
      return { ...versao, conteudo };
    } catch {
      // O índice diz que existe e o arquivo sumiu — alguém limpou à mão. A tela
      // trata como "não achei", que é a verdade.
      return null;
    }
  }

  /**
   * Guarda uma versão, se valer a pena.
   *
   * Devolve a versão criada, ou `null` quando ela não valia — conteúdo idêntico
   * ao da última, ou grande demais. `null` **não é erro**: é o caso comum de
   * salvar duas vezes sem mudar nada.
   */
  guardar(caminho: string, conteudo: string, origem: OrigemDaVersao): VersaoLocal | null {
    const indice = this.indiceDe(caminho);
    const ultima = indice.versoes
      .filter((v) => v.origem === 'salvo')
      .sort((a, b) => b.quando - a.quando)[0];
    const textoDaUltima =
      ultima === undefined ? null : this.ler(caminho, ultima.id);

    if (!valeGuardar(conteudo, textoDaUltima, origem, this.politica)) return null;

    const versao: VersaoLocal = {
      id: randomUUID(),
      quando: this.agora(),
      origem,
      bytes: Buffer.byteLength(conteudo, 'utf8'),
    };

    const pasta = this.pastaDe(caminho);
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(pasta, `${versao.id}.txt`), conteudo, 'utf8');

    // Salvar em disco APAGA o rascunho daquele arquivo: ele deixou de ser
    // trabalho perdido e virou história. Manter os dois faria a IDE oferecer
    // para sempre um rascunho que já foi salvo.
    const semRascunhoVelho =
      origem === 'salvo' ? indice.versoes.filter((v) => v.origem !== 'rascunho') : indice.versoes;

    const podadas = podar([versao, ...semRascunhoVelho], this.agora(), this.politica);
    this.gravarIndice(caminho, { caminho, versoes: podadas });
    this.limparOrfaos(pasta, podadas);
    return versao;
  }

  /** O rascunho não salvo deste arquivo, se houver (T035). */
  rascunhoDe(caminho: string): VersaoComTexto | null {
    const rascunho = this.listar(caminho).find((v) => v.origem === 'rascunho');
    return rascunho === undefined ? null : this.ler(caminho, rascunho.id);
  }

  /** Todos os arquivos com rascunho pendente — é o que a IDE pergunta ao abrir. */
  arquivosComRascunho(): readonly { readonly caminho: string; readonly quando: number }[] {
    let pastas: string[];
    try {
      pastas = fs.readdirSync(this.raiz);
    } catch {
      return [];
    }
    const saida: { caminho: string; quando: number }[] = [];
    for (const pasta of pastas) {
      const bruto = lerJsonTolerante(path.join(this.raiz, pasta, 'indice.json'));
      if (bruto === null || typeof bruto !== 'object') continue;
      const r = bruto as Record<string, unknown>;
      if (typeof r.caminho !== 'string' || !Array.isArray(r.versoes)) continue;
      const rascunho = r.versoes
        .filter((v): v is VersaoLocal => ehVersao(v) && v.origem === 'rascunho')
        .sort((a, b) => b.quando - a.quando)[0];
      if (rascunho !== undefined) saida.push({ caminho: r.caminho, quando: rascunho.quando });
    }
    return saida.sort((a, b) => b.quando - a.quando);
  }

  /**
   * Esquece o rascunho de um arquivo.
   *
   * Chamado quando ele decide o que fazer com ele — restaurar ou descartar. Sem
   * isto a IDE perguntaria de novo na próxima abertura, para sempre.
   */
  descartarRascunho(caminho: string): void {
    const indice = this.indiceDe(caminho);
    const ficam = indice.versoes.filter((v) => v.origem !== 'rascunho');
    if (ficam.length === indice.versoes.length) return;
    this.gravarIndice(caminho, { caminho, versoes: ficam });
    this.limparOrfaos(this.pastaDe(caminho), ficam);
  }

  private gravarIndice(caminho: string, indice: Indice): void {
    const pasta = this.pastaDe(caminho);
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    gravarJsonAtomico(path.join(pasta, 'indice.json'), { ...indice });
  }

  /**
   * Apaga os `.txt` que a poda deixou sem dono.
   *
   * Sem isto o disco cresceria para sempre: a poda tira do índice, e o conteúdo
   * é o que pesa.
   */
  private limparOrfaos(pasta: string, ficam: readonly VersaoLocal[]): void {
    const vivos = new Set(ficam.map((v) => `${v.id}.txt`));
    let arquivos: string[];
    try {
      arquivos = fs.readdirSync(pasta);
    } catch {
      return;
    }
    for (const arquivo of arquivos) {
      if (arquivo === 'indice.json' || vivos.has(arquivo)) continue;
      try {
        fs.unlinkSync(path.join(pasta, arquivo));
      } catch {
        // Não conseguiu apagar: fica para a próxima poda. Um órfão a mais não
        // justifica derrubar o save que estava em curso.
      }
    }
  }
}

function ehVersao(v: unknown): v is VersaoLocal {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.quando === 'number' &&
    (r.origem === 'salvo' || r.origem === 'rascunho') &&
    typeof r.bytes === 'number'
  );
}
