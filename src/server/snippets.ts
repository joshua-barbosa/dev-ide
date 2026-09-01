// Snippets em disco: `snippets.json`.
//
// Mesma forma do store de comandos salvos — e pelo mesmo motivo de estar fora do
// cofre: não são segredos, e cifrá-los obrigaria a destrancar o cofre para
// digitar código.
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { normalizarSnippets, type Snippet } from '../shared/snippets';
import {
  lerSnippetsDoVsCode, linguagemDoArquivo, semOsRepetidos, type SnippetImportado,
} from '../shared/snippets-vscode';
import { gravarJsonAtomico, lerJsonTolerante } from './arquivo-json';
import { arquivoDeDados } from './paths';

const CHAVE = 'snippets';

/** Um snippet lido de fora ganha id na hora — a lista pede um. */
const comId = (s: SnippetImportado): Snippet => ({ id: randomUUID(), ...s });

export class SnippetsStore {
  /**
   * `raizDoProjeto` é uma FUNÇÃO, como no store de preferências: o projeto
   * aberto muda em execução, e os snippets dele (T018) têm de acompanhar.
   */
  constructor(
    private readonly caminho: string,
    private readonly raizDoProjeto: () => string | null = () => null
  ) {}

  static defaultPath(): string {
    return arquivoDeDados('snippets.json');
  }

  /** Só os globais — os que este store grava. */
  lerGlobais(): readonly Snippet[] {
    return normalizarSnippets(lerJsonTolerante(this.caminho)[CHAVE]);
  }

  /**
   * Globais mais os do PROJETO (T018).
   *
   * *"Somam aos globais, e podem ser versionados com o projeto"* — a nota dele.
   * Os do projeto vêm depois e **não substituem** os globais com o mesmo
   * prefixo: substituir faria um repositório qualquer trocar, em silêncio, um
   * snippet que ele usa em todo lugar.
   */
  ler(): readonly Snippet[] {
    const globais = this.lerGlobais();
    return [...globais, ...semOsRepetidos(this.lerDoProjeto(), globais).map(comId)];
  }

  /** A pasta onde os snippets do projeto moram — a mesma do VS Code. */
  pastaDoProjeto(): string | null {
    const raiz = this.raizDoProjeto();
    return raiz === null ? null : path.join(raiz, '.vscode');
  }

  /**
   * Os snippets versionados com o projeto.
   *
   * Todo `*.code-snippets` da pasta `.vscode`, que é onde o VS Code os põe —
   * quem já tem não precisa mover nada.
   */
  lerDoProjeto(): readonly SnippetImportado[] {
    const pasta = this.pastaDoProjeto();
    if (pasta === null || !fs.existsSync(pasta)) return [];
    const saida: SnippetImportado[] = [];
    for (const nome of fs.readdirSync(pasta).sort()) {
      if (!nome.endsWith('.code-snippets')) continue;
      saida.push(...lerSnippetsDoVsCode(lerJsonTolerante(path.join(pasta, nome))));
    }
    return saida;
  }

  /**
   * Importa de um arquivo ou de uma PASTA de snippets do VS Code (T017).
   *
   * Devolve quantos entraram e quantos já existiam: importar em silêncio
   * deixaria quem importou sem saber se funcionou.
   */
  importar(alvo: string): { importados: number; repetidos: number } {
    const arquivos = fs.statSync(alvo).isDirectory()
      ? fs
          .readdirSync(alvo)
          .filter((n) => n.endsWith('.json') || n.endsWith('.code-snippets'))
          .sort()
          .map((n) => path.join(alvo, n))
      : [alvo];

    const lidos: SnippetImportado[] = [];
    for (const arquivo of arquivos) {
      lidos.push(
        ...lerSnippetsDoVsCode(lerJsonTolerante(arquivo), linguagemDoArquivo(arquivo))
      );
    }

    const globais = this.lerGlobais();
    const novos = semOsRepetidos(lidos, globais);
    if (novos.length > 0) this.gravar([...globais, ...novos.map(comId)]);
    return { importados: novos.length, repetidos: lidos.length - novos.length };
  }

  criar(dados: Omit<Snippet, 'id'>): Snippet {
    const novo: Snippet = { id: randomUUID(), ...dados };
    // Sobre os GLOBAIS: gravar a lista com os do projeto dentro os copiaria
    // para o arquivo do usuário, e eles deixariam de vir do repositório.
    this.gravar([...this.lerGlobais(), novo]);
    return novo;
  }

  /**
   * Remove um snippet GLOBAL.
   *
   * O do projeto não se remove por aqui: ele vem do repositório, e apagá-lo
   * pela IDE ou não faria efeito (voltaria na próxima leitura) ou mexeria num
   * arquivo versionado sem ninguém pedir. Quem quer tirá-lo edita o arquivo.
   */
  remover(id: string): boolean {
    const antes = this.lerGlobais();
    const depois = antes.filter((s) => s.id !== id);
    if (depois.length === antes.length) return false;
    this.gravar(depois);
    return true;
  }

  private gravar(lista: readonly Snippet[]): void {
    gravarJsonAtomico(this.caminho, { ...lerJsonTolerante(this.caminho), [CHAVE]: lista });
  }
}
