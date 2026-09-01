// Onde as preferências ficam em disco.
//
// A regra que dá o formato deste arquivo: **o que sobrou é I/O**. Faixa, tipo,
// mesclagem e chave desconhecida vivem em `shared/prefs.ts`, testados sem tocar
// no disco; aqui fica ler, escrever e sobreviver a um arquivo estragado.
import * as fs from 'fs';
import * as path from 'path';
import {
  ARQUIVO_DO_PROJETO, CHAVE_DO_EMMET, CHAVE_DOS_TEMAS, chavesDoProjeto, comOProjeto, mesclar,
  normalizar,
  PASTA_DO_PROJETO, padroes,
  type PatchDePreferencias, type Preferencias,
} from '../shared/prefs';
import { normalizarTemasDoUsuario, type TemaDoUsuario } from '../shared/temas';
import { lerConfiguracaoDoEmmet, type ConfiguracaoDoEmmet } from '../shared/emmet';
import { arquivoDeDados } from './paths';
import { gravarJsonAtomico, lerJsonTolerante } from './arquivo-json';

/** O mínimo que quem só lê precisa — evita depender da classe inteira. */
export interface LeitorDePreferencias {
  ler(): Preferencias;
}

export class PreferencesStore implements LeitorDePreferencias {
  /**
   * `raizDoProjeto` é uma FUNÇÃO, e não um caminho.
   *
   * O projeto aberto muda em tempo de execução, e um valor congelado na
   * construção faria as preferências do projeto anterior valerem para sempre.
   */
  constructor(
    private readonly caminho: string,
    private readonly raizDoProjeto: () => string | null = () => null
  ) {}

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
    return comOProjeto(normalizar(this.lerCru()), this.lerCruDoProjeto());
  }

  /** Só o do usuário, sem o projeto por cima. A tela usa para mostrar os dois. */
  lerDoUsuario(): Preferencias {
    return normalizar(this.lerCru());
  }

  /** O caminho do `.vscode/settings.json` do projeto, ou `null` sem projeto. */
  caminhoDoProjeto(): string | null {
    const raiz = this.raizDoProjeto();
    return raiz === null ? null : path.join(raiz, PASTA_DO_PROJETO, ARQUIVO_DO_PROJETO);
  }

  private lerCruDoProjeto(): Record<string, unknown> {
    const caminho = this.caminhoDoProjeto();
    return caminho === null ? {} : lerJsonTolerante(caminho);
  }

  /** Quais chaves o projeto sobrescreve — a tela avisa quando há alguma (T002). */
  chavesSobrescritas(): readonly string[] {
    return chavesDoProjeto(this.lerCruDoProjeto());
  }

  /** Cria o `.vscode/settings.json` se preciso e devolve o caminho. */
  garantirArquivoDoProjeto(): string {
    const caminho = this.caminhoDoProjeto();
    if (caminho === null) throw new Error('Abra uma pasta antes.');
    if (!fs.existsSync(caminho)) {
      fs.mkdirSync(path.dirname(caminho), { recursive: true });
      // Nasce VAZIO, e não com os padrões: um arquivo de projeto cheio de
      // valores iguais aos do usuário sobrescreveria tudo sem ninguém pedir, e
      // o primeiro `git commit` levaria isso para os outros.
      gravarJsonAtomico(caminho, {});
    }
    return caminho;
  }

  /**
   * Os temas declarados pelo usuário (T012).
   *
   * Sai por fora de `ler()` porque não é escalar — ver a nota em
   * `CHAVE_DOS_TEMAS`. Mesma leitura tolerante: tema torto some, os outros
   * ficam, e a IDE sobe.
   */
  lerTemas(): Record<string, TemaDoUsuario> {
    return normalizarTemasDoUsuario(this.lerCru()[CHAVE_DOS_TEMAS]);
  }

  /**
   * A configuração do Emmet (T022).
   *
   * Do usuário com a do PROJETO por cima, como as preferências escalares: um
   * repositório de Laravel pode querer o Emmet em `blade` sem que isso valha
   * para os outros projetos dele.
   */
  lerEmmet(): ConfiguracaoDoEmmet {
    const doProjeto = this.lerCruDoProjeto()[CHAVE_DO_EMMET];
    return lerConfiguracaoDoEmmet(doProjeto ?? this.lerCru()[CHAVE_DO_EMMET]);
  }

  /** Aplica um patch já validado e devolve o conjunto completo resultante. */
  /**
   * Grava no arquivo DO USUÁRIO, sempre.
   *
   * Nunca no do projeto: ele é versionado, e a tela mudando um valor ali
   * mandaria a preferência de um para todo mundo que clonou. Quem quer mexer
   * nele abre o arquivo — e a tela oferece o botão.
   */
  gravar(patch: PatchDePreferencias): Preferencias {
    const cru = this.lerCru();
    const completo = mesclar(normalizar(cru), patch);
    // Mescla sobre o CRU, e não sobre o normalizado: chave que não está no
    // esquema atravessa intacta. Gravar só o que conhecemos apagaria, na
    // primeira escrita, a configuração de uma versão mais nova.
    this.escrever({ ...cru, ...completo });
    // Devolve o EFETIVO: quem chamou quer saber o que passou a valer, e com um
    // projeto sobrescrevendo a chave o valor gravado não é o que vale.
    return comOProjeto(completo, this.lerCruDoProjeto());
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
