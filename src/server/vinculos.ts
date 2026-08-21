// A lembrança de contra quem cada `.sql` roda.
//
// Decisão D11, e ela é do usuário: "ele pode escolher quando quer rodar seria
// uma boa ideia, mas não precisa necessariamente amarrar para sempre". A
// ferramenta de referência grava um `-- Active: …` DENTRO do arquivo; nós não,
// porque isso sujaria arquivo que ele versiona no git, e um comentário de
// máquina no topo de um `.sql` sobrevive ao motivo que o pôs lá.
//
// Arquivo próprio, e não `config.json` nem `state.json`: preferência é escolha
// do usuário sobre a IDE, estado é histórico, e isto é ASSOCIAÇÃO. A spec 011
// separou os três de propósito, e juntar de novo é como eles divergem.
//
// Arquivo sob a raiz de queries NÃO entra aqui: o caminho já diz o vínculo, e
// guardar duas verdades sobre a mesma coisa é como uma delas fica velha.
import { lerJsonTolerante, gravarJsonAtomico } from './arquivo-json';
import { arquivoDeDados } from './paths';
import type { Vinculo } from '../shared/sql/vinculo';

const ARQUIVO = 'queries.json';

/**
 * Teto de caminhos lembrados.
 *
 * Sem ele, o arquivo cresceria para sempre — cada `.sql` que o usuário roda uma
 * vez na vida ficaria lá. Ao bater, o mais antigo sai.
 */
export const MAX_LEMBRADOS = 500;

interface Registro {
  readonly connectionId: string;
  readonly database: string;
  /** Quando foi usado por último, em ISO. É o que decide quem sai no teto. */
  readonly usadoEm: string;
}

function ehRegistro(bruto: unknown): bruto is Registro {
  const r = (bruto ?? {}) as Record<string, unknown>;
  return typeof r.connectionId === 'string' && r.connectionId !== ''
    && typeof r.database === 'string' && r.database !== '';
}

export class VinculosStore {
  constructor(private readonly caminho: string = arquivoDeDados(ARQUIVO)) {}

  private ler(): Record<string, Registro> {
    const bruto = lerJsonTolerante(this.caminho);
    const limpo: Record<string, Registro> = {};
    for (const [caminho, valor] of Object.entries(bruto)) {
      // Tolerante na leitura, como todo arquivo do usuário: entrada estragada é
      // descartada em silêncio, e não impede a IDE de subir.
      if (ehRegistro(valor)) {
        limpo[caminho] = {
          connectionId: valor.connectionId,
          database: valor.database,
          usadoEm: typeof valor.usadoEm === 'string' ? valor.usadoEm : '',
        };
      }
    }
    return limpo;
  }

  /** O vínculo lembrado para um arquivo, ou `null`. */
  obter(caminho: string): Vinculo | null {
    const r = this.ler()[caminho];
    return r === undefined ? null : { connectionId: r.connectionId, database: r.database };
  }

  todos(): Readonly<Record<string, Vinculo>> {
    const saida: Record<string, Vinculo> = {};
    for (const [caminho, r] of Object.entries(this.ler())) {
      saida[caminho] = { connectionId: r.connectionId, database: r.database };
    }
    return saida;
  }

  lembrar(caminho: string, vinculo: Vinculo, agora = new Date()): void {
    if (caminho.trim() === '') throw new Error('Caminho obrigatório.');
    if (vinculo.connectionId === '' || vinculo.database === '') {
      throw new Error('O vínculo precisa de conexão e database.');
    }
    const atual = this.ler();
    atual[caminho] = { ...vinculo, usadoEm: agora.toISOString() };

    // Teto por uso, e não por ordem de inserção: quem você usa continua lá.
    const chaves = Object.keys(atual);
    if (chaves.length > MAX_LEMBRADOS) {
      const porIdade = chaves.sort(
        (a, b) => (atual[a]?.usadoEm ?? '').localeCompare(atual[b]?.usadoEm ?? '')
      );
      for (const velha of porIdade.slice(0, chaves.length - MAX_LEMBRADOS)) delete atual[velha];
    }
    gravarJsonAtomico(this.caminho, atual as unknown as Record<string, unknown>);
  }

  esquecer(caminho: string): void {
    const atual = this.ler();
    if (!(caminho in atual)) return;
    delete atual[caminho];
    gravarJsonAtomico(this.caminho, atual as unknown as Record<string, unknown>);
  }

  /**
   * Tira da lembrança tudo que aponta para conexões que não existem mais.
   *
   * Chamado quando a interface pede a lista: uma conexão apagada não pode deixar
   * arquivos amarrados a um id fantasma (AC-11).
   */
  limparConexoesSumidas(idsVivos: readonly string[]): void {
    const vivos = new Set(idsVivos);
    const atual = this.ler();
    let mexeu = false;
    for (const [caminho, r] of Object.entries(atual)) {
      if (!vivos.has(r.connectionId)) {
        delete atual[caminho];
        mexeu = true;
      }
    }
    if (mexeu) gravarJsonAtomico(this.caminho, atual as unknown as Record<string, unknown>);
  }
}
