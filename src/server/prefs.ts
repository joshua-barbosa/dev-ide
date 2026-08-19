// Onde as preferências ficam em disco.
//
// A regra que dá o formato deste arquivo: **o que sobrou é I/O**. Faixa, tipo,
// mesclagem e chave desconhecida vivem em `shared/prefs.ts`, testados sem tocar
// no disco; aqui fica ler, escrever e sobreviver a um arquivo estragado.
import * as fs from 'fs';
import {
  mesclar, normalizar, padroes,
  type PatchDePreferencias, type Preferencias,
} from '../shared/prefs';
import { arquivoDeDados } from './paths';
import { gravarJsonAtomico, lerJsonTolerante } from './arquivo-json';

/** O mínimo que quem só lê precisa — evita depender da classe inteira. */
export interface LeitorDePreferencias {
  ler(): Preferencias;
}

export class PreferencesStore implements LeitorDePreferencias {
  constructor(private readonly caminho: string) {}

  static defaultPath(): string {
    return arquivoDeDados('config.json');
  }

  get path(): string {
    return this.caminho;
  }

  /**
   * O objeto cru do arquivo, ou `{}` quando não há um legível.
   *
   * Devolver o cru importa: é ele que preserva as chaves que ainda não
   * conhecemos quando chega a hora de gravar.
   */
  private lerCru(): Record<string, unknown> {
    return lerJsonTolerante(this.caminho);
  }

  /**
   * Lê do disco a cada chamada, de propósito.
   *
   * O `config.json` é editável pelo próprio editor da IDE — um cache em memória
   * faria salvar o arquivo não surtir efeito, que é justamente o fluxo que a
   * spec promete.
   */
  ler(): Preferencias {
    return normalizar(this.lerCru());
  }

  /** Aplica um patch já validado e devolve o conjunto completo resultante. */
  gravar(patch: PatchDePreferencias): Preferencias {
    const cru = this.lerCru();
    const completo = mesclar(normalizar(cru), patch);
    // Mescla sobre o CRU, e não sobre o normalizado: chave que não está no
    // esquema atravessa intacta. Gravar só o que conhecemos apagaria, na
    // primeira escrita, a configuração de uma versão mais nova.
    this.escrever({ ...cru, ...completo });
    return completo;
  }

  /** Cria o arquivo com os padrões se ainda não existir. Devolve o caminho. */
  garantirArquivo(): string {
    if (!fs.existsSync(this.caminho)) this.escrever(padroes() as unknown as Record<string, unknown>);
    return this.caminho;
  }

  private escrever(conteudo: Record<string, unknown>): void {
    gravarJsonAtomico(this.caminho, conteudo);
  }
}
