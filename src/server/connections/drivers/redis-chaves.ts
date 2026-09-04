// Ler, gravar e apagar uma chave do Redis; e o estado do servidor.
//
// Mora fora de `redis.ts` porque aquele arquivo já estava perto do teto de 800
// linhas do Artigo IV — e porque isto é uma coisa só: o que acontece DEPOIS de
// a árvore levar até uma chave.
//
// A regra que atravessa o arquivo: o que o servidor não souber dizer fica de
// fora, em vez de virar zero. `MEMORY USAGE` é recusado por servidor
// gerenciado, e "0 bytes" seria uma afirmação falsa sobre a chave dele.
import type Redis from 'ioredis';
import {
  colunasDe, comandoDeContagem, comandoDeCriacao, comandoDeLeitura,
  estatisticasDeBancos, lerInfo, linhasDoValor, LIMITE_DE_ELEMENTOS,
  type EscritaDeChave, type InfoDoServidor, type TipoDeChave, type ValorDeChave,
} from '../../../shared/sql/redis-chave';

/** O `TYPE` do Redis, corrigido para o tipo do módulo JSON. */
async function tipoDa(cliente: Redis, chave: string): Promise<TipoDeChave> {
  const bruto = String(await cliente.type(chave));
  // `TYPE` numa chave do RedisJSON responde `ReJSON-RL`, que não está na lista
  // dos tipos nativos — e é exatamente o que a ferramenta de referência mostra.
  if (bruto === 'ReJSON-RL') return 'ReJSON-RL';
  if (bruto === 'none') throw new Error(`A chave "${chave}" não existe.`);
  return bruto as TipoDeChave;
}

/** Bytes da chave, quando o servidor deixa perguntar. */
async function bytesDa(cliente: Redis, chave: string): Promise<number | undefined> {
  try {
    const n = Number(await cliente.call('MEMORY', 'USAGE', chave));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  } catch {
    // Servidor gerenciado costuma recusar `MEMORY`. Sem tamanho é melhor que
    // com tamanho errado.
    return undefined;
  }
}

export async function lerChave(cliente: Redis, chave: string): Promise<ValorDeChave> {
  const tipo = await tipoDa(cliente, chave);
  const [ttl, bytes] = await Promise.all([cliente.ttl(chave), bytesDa(cliente, chave)]);

  const leitura = comandoDeLeitura(tipo, chave);
  const resposta = await cliente.call(leitura.nome, ...(leitura.argumentos as string[]));

  const contagem = comandoDeContagem(tipo, chave);
  const total = contagem === null
    ? undefined
    : Number(await cliente.call(contagem.nome, ...(contagem.argumentos as string[])));

  const base = {
    chave, tipo, ttl,
    ...(bytes === undefined ? {} : { bytes }),
    ...(total === undefined || !Number.isFinite(total) ? {} : { total }),
  };

  if (leitura.forma === 'texto') {
    return {
      ...base,
      forma: 'texto' as const,
      texto: resposta === null || resposta === undefined ? '' : String(resposta),
      cortado: false,
    };
  }

  const linhas = linhasDoValor(tipo, resposta);
  return {
    ...base,
    forma: 'grade' as const,
    colunas: colunasDe(tipo),
    linhas,
    // "Cortado" é sobre o que o servidor TEM contra o que veio — e só se pode
    // afirmar quando houve o que contar.
    cortado: total !== undefined && Number.isFinite(total) && total > linhas.length,
  };
}

/**
 * Grava valor e/ou prazo.
 *
 * Trocar o valor de uma COLEÇÃO significa substituí-la: o `DEL` antes do
 * comando de criação é o que faz "salvar" querer dizer o que a tela mostra, em
 * vez de acrescentar aos elementos que já estavam lá. Não vale para `string` e
 * `ReJSON-RL`, cujos comandos já sobrescrevem.
 */
export async function gravarChave(cliente: Redis, pedido: EscritaDeChave): Promise<void> {
  const { chave, tipo, valor, ttl } = pedido;

  if (valor !== undefined) {
    if (tipo !== 'string' && tipo !== 'ReJSON-RL') await cliente.del(chave);
    const comando = comandoDeCriacao(tipo, chave, valor);
    if (comando.argumentos.length <= 1) {
      throw new Error(`Nada para gravar em "${chave}": o valor ficou vazio.`);
    }
    await cliente.call(comando.nome, ...(comando.argumentos as string[]));
  }

  if (ttl !== undefined) {
    if (ttl < 0) await cliente.persist(chave);
    else await cliente.expire(chave, ttl);
  }
}

/**
 * Apaga uma chave, ou todas as de um prefixo.
 *
 * O prefixo varre com `SCAN` e apaga em lotes — nunca `KEYS`, pela mesma razão
 * de sempre: `KEYS` trava o servidor inteiro enquanto roda.
 */
export async function apagarChave(
  cliente: Redis,
  pedido: { chave?: string; prefixo?: string }
): Promise<number> {
  if (typeof pedido.chave === 'string' && pedido.chave !== '') {
    return cliente.del(pedido.chave);
  }
  const prefixo = pedido.prefixo ?? '';
  if (prefixo === '') throw new Error('Diga qual chave ou qual prefixo apagar.');

  let cursor = '0';
  let apagadas = 0;
  do {
    const [proximo, achadas] = await cliente.scan(
      cursor, 'MATCH', `${prefixo}*`, 'COUNT', String(LIMITE_DE_ELEMENTOS)
    );
    cursor = proximo;
    if (achadas.length > 0) apagadas += await cliente.del(...achadas);
  } while (cursor !== '0');
  return apagadas;
}

export async function estadoDoServidor(cliente: Redis): Promise<InfoDoServidor> {
  const bruto = String(await cliente.info());
  return { ...lerInfo(bruto), bancos: estatisticasDeBancos(bruto), bruto };
}
