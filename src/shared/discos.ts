// Qual partição o Monitor mostra (T082).
//
// Mora em `shared` porque quem escolhe é a TELA, e a regra precisa ser a mesma
// dos dois lados: o servidor manda todas as partições e a interface decide. Uma
// função de cinco linhas justifica o arquivo porque a regra dela não é óbvia —
// ver o comentário de `escolherDisco`.

/** O mínimo que a escolha precisa saber. */
export interface DiscoEscolhivel {
  readonly ponto: string;
  readonly totalBytes: number;
}

/**
 * A partição escolhida, ou a MAIOR quando ninguém escolheu.
 *
 * A maior, e não a primeira: sem escolha, o disco que interessa é onde os dados
 * estão, e `/` costuma ser a partição pequena do sistema. Abrir o Monitor num
 * servidor de arquivos e ver "12% usado" da raiz, com o `/mnt` em 97%, é pior
 * que não mostrar nada.
 *
 * Ponto que sumiu — disco desmontado entre duas amostras — cai na maior em vez
 * de deixar o cartão vazio.
 */
export function escolherDisco<T extends DiscoEscolhivel>(
  discos: readonly T[],
  ponto: string | null
): T | null {
  if (ponto !== null) {
    const achado = discos.find((d) => d.ponto === ponto);
    if (achado !== undefined) return achado;
  }
  return [...discos].sort((a, b) => b.totalBytes - a.totalBytes)[0] ?? null;
}
