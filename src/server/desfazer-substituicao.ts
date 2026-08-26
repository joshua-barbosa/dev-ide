// Desfazer a substituição em massa (T032 · spec 027).
//
// Na spec 027 eu escrevi que "o caminho hoje é o git, e é honesto". Era honesto
// e insuficiente: em pasta sem git não há volta nenhuma, e trocar em quarenta
// arquivos é fácil de fazer por engano.
//
// Ele pediu com uma ressalva: *"pode fazer, mas eu acho que colocar um limite de
// undo"*. O teto é essencial e não é detalhe — o que se guarda é o CONTEÚDO
// ANTERIOR de cada arquivo tocado, e sem limite uma substituição em duzentos
// arquivos de meio mega prende cem megabytes na memória do servidor até a IDE
// fechar.
//
// Mora em memória de propósito: gravar isto em disco seria criar um segundo
// histórico de versões, e o T010 (`Timeline`) é a feature que faz isso direito.

/** O que uma substituição desfaz. */
export interface SubstituicaoDesfazivel {
  readonly id: string;
  readonly termo: string;
  readonly substituto: string;
  readonly quando: string;
  /** Caminho absoluto → conteúdo ANTES. */
  readonly antes: ReadonlyMap<string, string>;
}

/**
 * Quantas substituições ficam guardadas.
 *
 * Cinco cobre "errei e percebi na hora", que é o caso real. Guardar cem seria
 * carregar megabytes por um cenário que não acontece.
 */
export const MAX_DESFAZER = 5;

/**
 * Teto de bytes guardados no total.
 *
 * A segunda parede, e a que importa: cinco substituições pequenas não pesam
 * nada, mas UMA em duzentos arquivos grandes pesa. Quando estoura, as mais
 * antigas saem — e quem chamou fica sabendo.
 */
export const MAX_BYTES_GUARDADOS = 32 * 1024 * 1024;

export class HistoricoDeSubstituicoes {
  private pilha: SubstituicaoDesfazivel[] = [];

  /** Guarda o "antes". Devolve quantas foram descartadas para caber. */
  guardar(item: SubstituicaoDesfazivel): number {
    this.pilha.push(item);
    let descartadas = 0;
    while (this.pilha.length > MAX_DESFAZER) {
      this.pilha.shift();
      descartadas += 1;
    }
    while (this.pilha.length > 1 && this.bytes() > MAX_BYTES_GUARDADOS) {
      this.pilha.shift();
      descartadas += 1;
    }
    return descartadas;
  }

  /** A mais recente, sem tirar da pilha. É o que a interface mostra. */
  ultima(): SubstituicaoDesfazivel | null {
    return this.pilha[this.pilha.length - 1] ?? null;
  }

  /** Tira a mais recente para desfazer. */
  retirar(id: string): SubstituicaoDesfazivel | null {
    const i = this.pilha.findIndex((s) => s.id === id);
    if (i === -1) return null;
    const [item] = this.pilha.splice(i, 1);
    return item ?? null;
  }

  lista(): readonly SubstituicaoDesfazivel[] {
    return [...this.pilha].reverse();
  }

  bytes(): number {
    let total = 0;
    for (const s of this.pilha) for (const conteudo of s.antes.values()) total += conteudo.length;
    return total;
  }

  limpar(): void {
    this.pilha = [];
  }
}
