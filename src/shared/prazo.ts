// Um prazo para o que pode não voltar nunca.
//
// Nasceu de um travamento que ele relatou em 03/09/2026 e cuja causa ele mesmo
// identificou: *"o problema que travou foi que o banco perdeu conexão"*.
//
// **Conexão perdida raramente vira erro.** Quando o outro lado some — VPN que
// cai, servidor reiniciado, notebook que dormiu —, o socket fica MEIO-ABERTO: o
// sistema operacional não sabe que o par morreu e continua esperando uma
// resposta que não vem. Sem prazo, a promessa nunca resolve, e a tela fica
// carregando para sempre. O botão `Parar` não salva: ele também depende da
// mesma conexão morta.

export class PrazoEsgotado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'PrazoEsgotado';
  }
}

/**
 * Corre a promessa contra o relógio.
 *
 * **Rejeita** quando o tempo acaba — ao contrário do auxiliar do pool, que
 * resolve e segue em frente. Ali o objetivo é não travar o desligamento; aqui é
 * dizer a quem espera que não vem resposta.
 *
 * O relógio é limpo nos DOIS desfechos: um `setTimeout` esquecido segura o
 * processo Node vivo por até o prazo inteiro depois de tudo pronto.
 *
 * A promessa original **continua correndo** — não há como cancelá-la de fora, e
 * fingir que há seria pior. Quem chama decide o que fazer com a conexão suspeita;
 * no caso da IDE, ela é descartada para a próxima consulta reconectar.
 */
export function comPrazo<T>(
  promessa: Promise<T>,
  ms: number,
  mensagem: string
): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const relogio = setTimeout(() => rejeitar(new PrazoEsgotado(mensagem)), ms);
    promessa.then(
      (valor) => {
        clearTimeout(relogio);
        resolver(valor);
      },
      (erro: unknown) => {
        clearTimeout(relogio);
        rejeitar(erro instanceof Error ? erro : new Error(String(erro)));
      }
    );
  });
}

/** O prazo padrão de uma consulta, em milissegundos. */
export const PRAZO_DE_CONSULTA_MS = 60_000;

/**
 * A mensagem que a pessoa lê quando o prazo estoura.
 *
 * Diz o que aconteceu, o que NÃO aconteceu, e o que fazer — nessa ordem. "Tempo
 * esgotado" sozinho faz pensar que a consulta era pesada, quando na maioria das
 * vezes a conexão é que morreu.
 */
export function mensagemDePrazo(segundos: number): string {
  return (
    `O servidor não respondeu em ${segundos}s. Isso costuma ser conexão perdida — ` +
    'rede, VPN ou o servidor reiniciado — e não consulta pesada: uma consulta lenta ' +
    'devolveria erro do próprio banco. A consulta pode continuar rodando lá. ' +
    'A conexão foi descartada; a próxima tentativa reconecta.'
  );
}

/**
 * Quanto o prazo da rota fica ACIMA do prazo que o pedido mandou ao driver.
 *
 * Existe para o erro do driver chegar primeiro quando ele funciona: a mensagem
 * dele diz o que o banco respondeu, e a nossa só diz que desistimos de esperar.
 */
export const FOLGA_SOBRE_O_DRIVER_MS = 5_000;
