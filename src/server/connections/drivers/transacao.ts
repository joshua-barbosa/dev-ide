// Executar o plano de escrita da grade, em uma transação (spec 044).
//
// A montagem do SQL está em `escrita.ts` e é pura. Aqui mora a parte que
// depende do banco: abrir a transação, rodar os comandos, conferir quantas
// linhas cada um afetou, e desfazer tudo ao primeiro sinal de que a linha mudou
// por baixo.
//
// Escrito uma vez e usado pelos três drivers, porque a REGRA é a mesma nos três
// e só os verbos mudam. Duplicá-la seria pedir que ela divergisse — e a versão
// que divergisse seria a que deixa passar.
import type { TableWriteRequest, TableWriteResult } from '../../../shared/contracts';
import { montarEscrita, normalizarEscrita, type AlvoDeEscrita } from './escrita';

/**
 * O que cada driver precisa emprestar.
 *
 * `rodar` devolve quantas linhas o comando afetou — é o número que revela a
 * alteração concorrente.
 */
export interface MotorDeTransacao {
  comecar(): Promise<void>;
  confirmar(): Promise<void>;
  desfazer(): Promise<void>;
  rodar(sql: string, params: readonly unknown[]): Promise<number>;
}

export async function escreverNaTabela(
  alvo: AlvoDeEscrita,
  request: TableWriteRequest,
  motor: MotorDeTransacao
): Promise<TableWriteResult> {
  const plano = montarEscrita(alvo, normalizarEscrita(request, alvo.colunas));
  const comandos = plano.comandos.map((c) => ({ sql: c.sql, params: c.params }));

  // Simulação: o MESMO plano, sem executar. É o que a confirmação mostra, e é
  // por isso que ela não pode mentir — não há um segundo caminho de montagem.
  if (request.simular === true) {
    return { comandos, executado: false, linhasAfetadas: 0 };
  }
  if (plano.comandos.length === 0) {
    return { comandos, executado: true, linhasAfetadas: 0 };
  }

  await motor.comecar();
  try {
    let afetadas = 0;
    for (const comando of plano.comandos) {
      const n = await motor.rodar(comando.sql, comando.params);
      if (comando.exigeUmaLinha && n === 0) {
        // Zero linhas com a chave certa significa que o valor antigo não casa
        // mais: alguém mexeu na linha entre a leitura e a gravação. Desfaz
        // TUDO — gravar metade seria pior que não gravar.
        throw new Error(
          'Uma das linhas mudou no banco depois que esta página foi carregada. ' +
            'Nada foi gravado. Recarregue a tabela e refaça a alteração.'
        );
      }
      afetadas += n;
    }
    await motor.confirmar();
    return { comandos, executado: true, linhasAfetadas: afetadas };
  } catch (erro) {
    // `desfazer` não pode esconder o erro original: se ele também falhar, o que
    // interessa saber é o primeiro.
    await motor.desfazer().catch(() => {});
    throw erro;
  }
}
