// Snippets em disco: `snippets.json`.
//
// Mesma forma do store de comandos salvos — e pelo mesmo motivo de estar fora do
// cofre: não são segredos, e cifrá-los obrigaria a destrancar o cofre para
// digitar código.
import { randomUUID } from 'crypto';
import { normalizarSnippets, type Snippet } from '../shared/snippets';
import { gravarJsonAtomico, lerJsonTolerante } from './arquivo-json';
import { arquivoDeDados } from './paths';

const CHAVE = 'snippets';

export class SnippetsStore {
  constructor(private readonly caminho: string) {}

  static defaultPath(): string {
    return arquivoDeDados('snippets.json');
  }

  ler(): readonly Snippet[] {
    return normalizarSnippets(lerJsonTolerante(this.caminho)[CHAVE]);
  }

  criar(dados: Omit<Snippet, 'id'>): Snippet {
    const novo: Snippet = { id: randomUUID(), ...dados };
    this.gravar([...this.ler(), novo]);
    return novo;
  }

  remover(id: string): boolean {
    const antes = this.ler();
    const depois = antes.filter((s) => s.id !== id);
    if (depois.length === antes.length) return false;
    this.gravar(depois);
    return true;
  }

  private gravar(lista: readonly Snippet[]): void {
    gravarJsonAtomico(this.caminho, { ...lerJsonTolerante(this.caminho), [CHAVE]: lista });
  }
}
