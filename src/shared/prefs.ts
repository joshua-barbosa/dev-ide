// Preferências do usuário: esquema, padrões e as duas formas de validar.
//
// Mora em `shared` porque é lógica pura (Artigo III): decidir se `13` cabe na
// faixa e o que fazer com uma chave desconhecida não depende de disco, de rede
// nem de React — e é justamente a parte que erra na prática.
//
// **O esquema é DADO, não interface.** Isso dá três coisas que uma `interface`
// não daria: o compilador conhece as chaves, o tipo do valor é derivado do
// próprio padrão (então não podem divergir), e validar é um laço sobre a tabela
// em vez de um `if` por chave. Acrescentar preferência é acrescentar uma linha —
// que é exatamente o que os itens de Auto Save, tema e comandos salvos vão
// fazer.

export interface RegraNumero {
  readonly padrao: number;
  readonly tipo: 'inteiro';
  readonly min: number;
  readonly max: number;
}

export interface RegraBooleano {
  readonly padrao: boolean;
  readonly tipo: 'booleano';
}

export type Regra = RegraNumero | RegraBooleano;

/**
 * As preferências que existem.
 *
 * **Só entra aqui o que já tem efeito.** Preferência declarada e não aplicada é
 * pior que preferência ausente: a ausente o usuário não procura, e a inerte ele
 * mexe e conclui que a IDE está quebrada.
 */
export const ESQUEMA = {
  'editor.fontSize': { padrao: 13, tipo: 'inteiro', min: 8, max: 40 },
  'editor.tabSize': { padrao: 4, tipo: 'inteiro', min: 1, max: 8 },
  'editor.wordWrap': { padrao: false, tipo: 'booleano' },
  'terminal.fontSize': { padrao: 13, tipo: 'inteiro', min: 8, max: 40 },
  'vault.rememberDays': { padrao: 15, tipo: 'inteiro', min: 1, max: 365 },
} as const satisfies Record<string, Regra>;

export type ChaveDePreferencia = keyof typeof ESQUEMA;

/** O tipo de cada preferência sai do próprio padrão declarado no esquema. */
export type Preferencias = {
  readonly [K in ChaveDePreferencia]: (typeof ESQUEMA)[K]['padrao'] extends boolean
    ? boolean
    : number;
};

export type PatchDePreferencias = Partial<Preferencias>;

export const CHAVES = Object.keys(ESQUEMA) as readonly ChaveDePreferencia[];

export function ehChave(nome: string): nome is ChaveDePreferencia {
  return Object.prototype.hasOwnProperty.call(ESQUEMA, nome);
}

/** Os padrões, como objeto pronto. Novo a cada chamada, para ninguém mutar. */
export function padroes(): Preferencias {
  const saida: Record<string, number | boolean> = {};
  for (const chave of CHAVES) saida[chave] = ESQUEMA[chave].padrao;
  return saida as Preferencias;
}

/** Descrição do que a chave aceita — vira a mensagem de erro e a documentação. */
export function descreverRegra(chave: ChaveDePreferencia): string {
  const regra: Regra = ESQUEMA[chave];
  return regra.tipo === 'booleano'
    ? 'true ou false'
    : `número inteiro entre ${regra.min} e ${regra.max}`;
}

/** Verdadeiro quando o valor serve para a chave, sem conversão nem clamp. */
function valorValido(chave: ChaveDePreferencia, valor: unknown): boolean {
  const regra: Regra = ESQUEMA[chave];
  if (regra.tipo === 'booleano') return typeof valor === 'boolean';
  return (
    typeof valor === 'number' &&
    Number.isSafeInteger(valor) &&
    valor >= regra.min &&
    valor <= regra.max
  );
}

/**
 * Lê o que veio do arquivo, **sem nunca lançar**.
 *
 * É a fronteira tolerante: quem escreveu foi uma pessoa editando texto, e o
 * custo de recusar seria a IDE não subir. Valor ruim vira o padrão daquela
 * chave; chave desconhecida é ignorada (mas o gravador a preserva em disco).
 */
export function normalizar(bruto: unknown): Preferencias {
  const base = padroes();
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return base;

  const lido = bruto as Record<string, unknown>;
  const saida: Record<string, number | boolean> = { ...base };
  for (const chave of CHAVES) {
    const valor = lido[chave];
    if (valor !== undefined && valorValido(chave, valor)) saida[chave] = valor as number | boolean;
  }
  return saida as Preferencias;
}

/**
 * Lê o que veio de um `PATCH`, **lançando ao primeiro problema**.
 *
 * É a fronteira rígida: aqui quem escreve é código nosso, e aceitar em silêncio
 * esconderia o defeito em vez de mostrá-lo. Chave desconhecida é erro, não
 * ruído — ao contrário do arquivo.
 */
export function validarPatch(bruto: unknown): PatchDePreferencias {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new Error('O corpo precisa ser um objeto de preferências.');
  }
  const lido = bruto as Record<string, unknown>;
  const saida: Record<string, number | boolean> = {};

  for (const [chave, valor] of Object.entries(lido)) {
    if (!ehChave(chave)) {
      throw new Error(`Preferência desconhecida: "${chave}".`);
    }
    if (!valorValido(chave, valor)) {
      throw new Error(`Valor inválido para "${chave}": esperado ${descreverRegra(chave)}.`);
    }
    saida[chave] = valor as number | boolean;
  }
  return saida as PatchDePreferencias;
}

/** Mescla imutável: chave ausente no patch fica como estava (Artigo IV). */
export function mesclar(atual: Preferencias, patch: PatchDePreferencias): Preferencias {
  return { ...atual, ...patch };
}
