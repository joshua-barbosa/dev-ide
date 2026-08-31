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

/** Uma entre N opções declaradas. O tipo do valor sai das próprias opções. */
export interface RegraOpcao {
  readonly padrao: string;
  readonly tipo: 'opcao';
  readonly opcoes: readonly string[];
}

/**
 * Texto livre.
 *
 * Existe desde o T012: o nome do tema deixou de ser "um entre N" quando o
 * `config.json` passou a poder declarar temas próprios. Quem confere se o nome
 * existe é quem resolve a paleta, e nome errado cai no tema padrão em vez de
 * derrubar a tela.
 */
export interface RegraTexto {
  readonly padrao: string;
  readonly tipo: 'texto';
}

export type Regra = RegraNumero | RegraBooleano | RegraOpcao | RegraTexto;

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
  // Salvar sozinho. `onFocusChange` grava ao trocar de aba ou perder a janela.
  'editor.autoSave': {
    padrao: 'off', tipo: 'opcao', opcoes: ['off', 'afterDelay', 'onFocusChange'],
  },
  'editor.autoSaveDelay': { padrao: 1_000, tipo: 'inteiro', min: 200, max: 60_000 },
  'terminal.fontSize': { padrao: 13, tipo: 'inteiro', min: 8, max: 40 },
  'workbench.theme': { padrao: 'escuro', tipo: 'texto' },
  // T013: seguir o sistema é escolher entre DOIS temas declarados, e não um
  // interruptor claro/escuro — quem gosta de Nord no escuro não quer o `claro`
  // genérico quando o sistema clareia.
  'workbench.followSystem': { padrao: false, tipo: 'booleano' },
  'workbench.themeLight': { padrao: 'claro', tipo: 'texto' },
  'workbench.themeDark': { padrao: 'escuro', tipo: 'texto' },
  'vault.rememberDays': { padrao: 15, tipo: 'inteiro', min: 1, max: 365 },
} as const satisfies Record<string, Regra>;

export type ChaveDePreferencia = keyof typeof ESQUEMA;

/** O tipo de cada preferência sai do próprio padrão declarado no esquema. */
export type Preferencias = {
  readonly [K in ChaveDePreferencia]: (typeof ESQUEMA)[K]['padrao'] extends boolean
    ? boolean
    : (typeof ESQUEMA)[K]['padrao'] extends string
      ? (typeof ESQUEMA)[K] extends { readonly opcoes: readonly (infer O)[] }
        ? O
        : string
      : number;
};

export type PatchDePreferencias = Partial<Preferencias>;

export const CHAVES = Object.keys(ESQUEMA) as readonly ChaveDePreferencia[];

export function ehChave(nome: string): nome is ChaveDePreferencia {
  return Object.prototype.hasOwnProperty.call(ESQUEMA, nome);
}

/** Os padrões, como objeto pronto. Novo a cada chamada, para ninguém mutar. */
export function padroes(): Preferencias {
  const saida: Record<string, number | boolean | string> = {};
  for (const chave of CHAVES) saida[chave] = ESQUEMA[chave].padrao;
  return saida as Preferencias;
}

/** Descrição do que a chave aceita — vira a mensagem de erro e a documentação. */
export function descreverRegra(chave: ChaveDePreferencia): string {
  const regra: Regra = ESQUEMA[chave];
  if (regra.tipo === 'booleano') return 'true ou false';
  if (regra.tipo === 'opcao') return `um de: ${regra.opcoes.join(', ')}`;
  if (regra.tipo === 'texto') return 'texto';
  return `número inteiro entre ${regra.min} e ${regra.max}`;
}

/** Verdadeiro quando o valor serve para a chave, sem conversão nem clamp. */
function valorValido(chave: ChaveDePreferencia, valor: unknown): boolean {
  const regra: Regra = ESQUEMA[chave];
  if (regra.tipo === 'booleano') return typeof valor === 'boolean';
  if (regra.tipo === 'opcao') return typeof valor === 'string' && regra.opcoes.includes(valor);
  // Texto vazio não: seria um nome de tema que não é de ninguém, e o efeito
  // seria o mesmo de não ter escolhido — só que sem dizer.
  if (regra.tipo === 'texto') return typeof valor === 'string' && valor.trim() !== '';
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
  const saida: Record<string, number | boolean | string> = { ...base };
  for (const chave of CHAVES) {
    const valor = lido[chave];
    if (valor !== undefined && valorValido(chave, valor)) {
      saida[chave] = valor as number | boolean | string;
    }
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
  const saida: Record<string, number | boolean | string> = {};

  for (const [chave, valor] of Object.entries(lido)) {
    if (!ehChave(chave)) {
      throw new Error(`Preferência desconhecida: "${chave}".`);
    }
    if (!valorValido(chave, valor)) {
      throw new Error(`Valor inválido para "${chave}": esperado ${descreverRegra(chave)}.`);
    }
    saida[chave] = valor as number | boolean | string;
  }
  return saida as PatchDePreferencias;
}

/** Mescla imutável: chave ausente no patch fica como estava (Artigo IV). */
export function mesclar(atual: Preferencias, patch: PatchDePreferencias): Preferencias {
  return { ...atual, ...patch };
}

// ---------------------------------------------------------------------------
// A seção que NÃO é escalar
// ---------------------------------------------------------------------------

/**
 * Onde moram os temas do usuário no `config.json` (T012).
 *
 * Fora do `ESQUEMA` de propósito: ele é uma tabela de valores ESCALARES — um
 * número, um sim/não, um texto —, e a validação inteira é um laço sobre ela.
 * Um mapa de paletas não cabe nesse laço sem transformar o esquema em outra
 * coisa. Quem lê e valida esta seção é `normalizarTemasDoUsuario`, em
 * `shared/temas.ts`, que é onde o assunto mora.
 *
 * O gravador de preferências já preserva as chaves que não conhece — foi o que
 * permitiu esta seção existir sem nenhuma mudança nele.
 */
export const CHAVE_DOS_TEMAS = 'workbench.themes';

// ---------------------------------------------------------------------------
// Preferências POR PROJETO (T002)
// ---------------------------------------------------------------------------

/**
 * Onde ficam as preferências de um projeto.
 *
 * O caminho do VS Code, de propósito: quem já tem um `.vscode/settings.json` no
 * repositório não precisa criar outro arquivo para esta IDE, e o que estiver lá
 * e nós não conhecermos é simplesmente ignorado — como o VS Code ignora o que
 * não é dele.
 */
export const PASTA_DO_PROJETO = '.vscode';
export const ARQUIVO_DO_PROJETO = 'settings.json';

/**
 * As chaves que o projeto realmente sobrescreve.
 *
 * Só as que existem no esquema E têm valor válido: uma chave desconhecida no
 * `.vscode/settings.json` (as do VS Code, por exemplo) não sobrescreve nada, e
 * dizer que sobrescreve faria a tela mostrar um aviso que não corresponde a
 * nada.
 */
export function chavesDoProjeto(bruto: unknown): readonly ChaveDePreferencia[] {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return [];
  const lido = bruto as Record<string, unknown>;
  return CHAVES.filter((chave) => lido[chave] !== undefined && valorValido(chave, lido[chave]));
}

/**
 * O conjunto efetivo: o do usuário, com o do projeto por cima.
 *
 * **O projeto vence**, e é o que todo mundo espera: `editor.tabSize` de dois
 * neste repositório não pode depender de quem clonou. O que o projeto não diz
 * continua vindo do usuário.
 */
export function comOProjeto(doUsuario: Preferencias, bruto: unknown): Preferencias {
  const chaves = chavesDoProjeto(bruto);
  if (chaves.length === 0) return doUsuario;
  const lido = bruto as Record<string, unknown>;
  const saida: Record<string, number | boolean | string> = { ...doUsuario };
  for (const chave of chaves) saida[chave] = lido[chave] as number | boolean | string;
  return saida as Preferencias;
}
