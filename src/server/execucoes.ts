// Quem está rodando agora, para poder ser parado.
//
// É um módulo, e não um `Map` solto no `index.ts`, por causa de três regras que
// erram na prática:
//
// 1. **substituir** a entrada quando a mesma execução troca de processo — no C,
//    `gcc` e o binário são dois processos sob o mesmo id, e parar durante a
//    compilação tem que ser o mesmo botão;
// 2. **remover no fim**, senão o id vaza memória e, pior, uma parada atrasada
//    mataria a execução seguinte;
// 3. **responder "não havia" sem erro** — clicar em parar duas vezes, ou parar
//    o que já terminou, é comportamento normal, não falha.
//
// Como módulo isso é teste; inline seria confiança.

export type Encerrador = () => void;

export class RegistroDeExecucoes {
  private readonly ativos = new Map<string, Encerrador>();

  /** Registra (ou substitui) o processo atual daquela execução. */
  registrar(id: string, encerrar: Encerrador): void {
    this.ativos.set(id, encerrar);
  }

  /** Tira do registro. Chamar ao terminar, seja como for que terminou. */
  concluir(id: string): void {
    this.ativos.delete(id);
  }

  /** Devolve `false` quando não havia o que parar — e isso não é erro. */
  parar(id: string): boolean {
    const encerrar = this.ativos.get(id);
    if (encerrar === undefined) return false;
    this.ativos.delete(id);
    encerrar();
    return true;
  }

  get quantidade(): number {
    return this.ativos.size;
  }

  /** Encerra tudo — usado no desligamento do servidor. */
  pararTudo(): void {
    for (const id of [...this.ativos.keys()]) this.parar(id);
  }
}
