// Os segredos da aba Authorization a caminho do cofre (spec 120, etapa 2).
//
// Cada tecla num campo de segredo manda o valor ao cofre. O ▷ logo depois da
// última tecla não pode sair antes de o cofre ter o valor novo — senão a
// requisição vai com o token de antes. Por isso o rodar ESPERA isto aqui.
//
// Em fila por referência: duas teclas seguidas não podem chegar trocadas.
import { ApiDoNotebook } from '../../api-notebook';

const filas = new Map<string, Promise<void>>();
/** A última falha de cada referência — o rodar a mostra, em vez de um "não está no cofre" enganoso. */
const falhas = new Map<string, string>();

export function guardarNoCofre(ref: string, valor: string): void {
  const anterior = filas.get(ref) ?? Promise.resolve();
  const proxima = anterior.then(async () => {
    try {
      await ApiDoNotebook.guardarSegredo(ref, valor);
      falhas.delete(ref);
    } catch (e) {
      falhas.set(ref, e instanceof Error ? e.message : String(e));
    }
  });
  filas.set(ref, proxima);
  void proxima.then(() => {
    if (filas.get(ref) === proxima) filas.delete(ref);
  });
}

/**
 * Espera o que está a caminho; devolve as falhas das referências que ESTA
 * requisição usa — a de um campo já abandonado não é problema dela.
 */
export async function aguardarSegredos(referencias: readonly string[]): Promise<string[]> {
  await Promise.all([...filas.values()]);
  return referencias.flatMap((ref) => {
    const falha = falhas.get(ref);
    return falha === undefined ? [] : [falha];
  });
}

/**
 * Uma referência nova: aleatória, para nada no `.brnb` dizer de quem é o
 * segredo. `getRandomValues`, e não `randomUUID`: este só existe em contexto
 * seguro, e a IDE aberta por um IP da rede não é.
 */
export function novaReferencia(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `http-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
