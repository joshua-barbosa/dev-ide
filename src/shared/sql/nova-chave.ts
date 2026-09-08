// Criar uma chave de Redis: o formulário, sem tela.
//
// Ele, em 08/09/2026: *"Ou adicionar uma nova chave"*. Não existia em lugar
// nenhum — nem na IDE. Entre um comando pronto para editar e um formulário, ele
// escolheu o **formulário**: nome, tipo, valor e TTL.
//
// A validação mora aqui porque as DUAS telas (o painel da IDE e a árvore
// nativa) a usam, e porque o que ela recusa é o que chegaria ao servidor como
// mensagem de sintaxe — que fala do comando, não do campo que ele preencheu.
import { TIPOS_DE_CHAVE, type TipoDeChave } from './redis-chave';

export interface FormularioDeChave {
  readonly nome: string;
  readonly tipo: TipoDeChave;
  readonly valor: string;
  /** Segundos, como TEXTO: o campo vazio é "sem prazo". */
  readonly ttl: string;
  /** O banco (`db3`), quando "todos os bancos" está ligado. */
  readonly banco?: string;
}

export interface PedidoDeChave {
  readonly chave: string;
  readonly tipo: TipoDeChave;
  readonly valor: string;
  readonly ttl?: number;
  readonly banco?: string;
}

export type Validacao =
  | { readonly ok: true; readonly pedido: PedidoDeChave }
  | { readonly ok: false; readonly motivo: string };

/**
 * O que cada tipo espera no campo de valor.
 *
 * O campo nasce com o exemplo do tipo escolhido: `hash` e `zset` pedem um
 * formato que ninguém adivinha, e um campo vazio com uma recusa depois é pior
 * que um exemplo na frente.
 */
export const EXEMPLO_DE_VALOR: Readonly<Record<TipoDeChave, string>> = {
  string: 'valor',
  list: 'primeiro\nsegundo',
  set: 'um\noutro',
  zset: 'membro=10',
  hash: 'campo=valor',
  stream: 'campo=valor',
  'ReJSON-RL': '{"exemplo": 1}',
};

/** O rótulo de cada tipo na tela. */
export const NOME_DO_TIPO: Readonly<Record<TipoDeChave, string>> = {
  string: 'String',
  list: 'Lista',
  set: 'Set',
  zset: 'Sorted set',
  hash: 'Hash',
  stream: 'Stream',
  'ReJSON-RL': 'JSON',
};

/** As linhas não vazias do valor. É como `comandoDeCriacao` também as lê. */
function linhasDe(valor: string): string[] {
  return valor.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

/** O motivo pelo qual este valor não serve para este tipo, ou `null`. */
function motivoDoValor(tipo: TipoDeChave, valor: string): string | null {
  if (valor.trim() === '') return 'Escreva o valor da chave.';

  if (tipo === 'ReJSON-RL') {
    try {
      JSON.parse(valor);
    } catch {
      return 'O valor não é um JSON válido. Confira aspas e vírgulas.';
    }
    return null;
  }

  const linhas = linhasDe(valor);
  if (tipo === 'hash' || tipo === 'stream') {
    return linhas.some((l) => l.includes('=')) ? null
      : 'Escreva um `campo=valor` por linha.';
  }
  if (tipo === 'zset') {
    // `membro=nota`, e a nota é número: `ZADD` com nota que não é número é
    // recusado pelo servidor, e a mensagem de lá não diz qual linha errou.
    for (const linha of linhas) {
      const corte = linha.lastIndexOf('=');
      if (corte === -1) return 'Escreva um `membro=nota` por linha.';
      if (!Number.isFinite(Number(linha.slice(corte + 1)))) {
        return `A nota de "${linha.slice(0, corte)}" precisa ser um número.`;
      }
    }
    return linhas.length === 0 ? 'Escreva um `membro=nota` por linha.' : null;
  }
  return null;
}

/**
 * O formulário vira o pedido da rota, ou o motivo de não virar.
 *
 * **O nome não pode ter espaço.** O Redis aceita — a chave é um binário —, mas
 * a árvore de prefixos e o `SCAN MATCH` partem do nome, e uma chave com espaço
 * é gravada e depois some da tela. Recusar na frente é mais honesto do que
 * gravar e esconder.
 */
export function validarNovaChave(f: FormularioDeChave): Validacao {
  const chave = f.nome.trim();
  if (chave === '') return { ok: false, motivo: 'Dê um nome à chave.' };
  if (/\s/.test(chave)) {
    return { ok: false, motivo: 'O nome da chave não pode ter espaços.' };
  }
  if (!TIPOS_DE_CHAVE.includes(f.tipo)) {
    return { ok: false, motivo: `Tipo desconhecido: "${String(f.tipo)}".` };
  }

  const motivo = motivoDoValor(f.tipo, f.valor);
  if (motivo !== null) return { ok: false, motivo };

  const temPrazo = f.ttl.trim() !== '';
  const ttl = Number(f.ttl);
  if (temPrazo && (!Number.isFinite(ttl) || ttl <= 0)) {
    // Zero e negativo não são "sem prazo": `EXPIRE 0` APAGA a chave na hora.
    return { ok: false, motivo: 'O prazo é um número de segundos maior que zero.' };
  }

  return {
    ok: true,
    pedido: {
      chave,
      tipo: f.tipo,
      valor: f.valor,
      ...(temPrazo ? { ttl: Math.floor(ttl) } : {}),
      ...(f.banco === undefined || f.banco === '' ? {} : { banco: f.banco }),
    },
  };
}
