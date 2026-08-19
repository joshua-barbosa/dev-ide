// Comandos salvos em disco: `commands.json`.
//
// **Fora do cofre, de propósito.** Não são segredos, e cifrá-los obrigaria a
// destrancar o cofre para rodar `npm test`. O que se deve ao usuário é o aviso
// de que um comando com senha dentro fica em texto puro — e ele está na
// interface, no momento de salvar.
import { randomUUID } from 'crypto';
import { acrescentar, normalizarLista, remover, type ComandoSalvo } from '../shared/comandos-salvos';
import { gravarJsonAtomico, lerJsonTolerante } from './arquivo-json';
import { arquivoDeDados } from './paths';

/** A chave do objeto no arquivo. Um objeto na raiz deixa espaço para crescer. */
const CHAVE = 'comandos';

export class ComandosStore {
  constructor(private readonly caminho: string) {}

  static defaultPath(): string {
    return arquivoDeDados('commands.json');
  }

  ler(): readonly ComandoSalvo[] {
    return normalizarLista(lerJsonTolerante(this.caminho)[CHAVE]);
  }

  criar(dados: Omit<ComandoSalvo, 'id'>): ComandoSalvo {
    const novo: ComandoSalvo = { id: randomUUID(), ...dados };
    this.gravar(acrescentar(this.ler(), novo));
    return novo;
  }

  /** Devolve `false` quando não havia o que remover — clicar duas vezes é normal. */
  remover(id: string): boolean {
    const antes = this.ler();
    const depois = remover(antes, id);
    if (depois.length === antes.length) return false;
    this.gravar(depois);
    return true;
  }

  private gravar(lista: readonly ComandoSalvo[]): void {
    // Mescla sobre o cru, como o store de preferências: chave desconhecida de
    // uma versão mais nova atravessa intacta.
    gravarJsonAtomico(this.caminho, { ...lerJsonTolerante(this.caminho), [CHAVE]: lista });
  }
}
