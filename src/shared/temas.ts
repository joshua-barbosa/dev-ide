// Os temas, como dado.
//
// Mora em `shared` pelo mesmo motivo do esquema de preferências: declarar tema é
// declarar uma tabela, e o compilador consegue provar que nenhuma cor ficou de
// fora — o que um objeto solto no componente não daria.
//
// **As cores do tema escuro são as mesmas de antes**, e isso é de propósito: a
// spec 001 as escolheu para a IDE não parecer Material genérico, e trocá-las
// junto com "agora dá para escolher tema" misturaria duas mudanças.

export interface Paleta {
  /** Fundo da moldura (barras, lateral). */
  readonly bg: string;
  /** Fundo dos painéis. */
  readonly bgPanel: string;
  /** Fundo da área de texto — o mais escuro (ou o mais claro) dos três. */
  readonly bgEditor: string;
  readonly border: string;
  readonly fg: string;
  readonly fgDim: string;
  readonly accent: string;
  readonly run: string;
  readonly error: string;
  /** Realce de sintaxe. Sem `#`: é o formato que o Monaco espera. */
  readonly sintaxe: PaletaDeSintaxe;
  /** Fundo da seleção no editor, e o das outras ocorrências. */
  readonly selecao: string;
  readonly selecaoFraca: string;
  /**
   * Cores ANSI do terminal.
   *
   * Não é enfeite: o shell escolhe as cores dele (o prompt do `git`, o `ls`
   * colorido) supondo um fundo escuro. Sobre branco, o amarelo e o ciano
   * padrão do xterm somem. Sem esta paleta, o tema claro entrega um terminal
   * com metade do texto invisível.
   */
  readonly ansi: PaletaAnsi;
}

export interface PaletaAnsi {
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
}

export interface PaletaDeSintaxe {
  readonly reservada: string;
  readonly tipo: string;
  readonly funcao: string;
  readonly texto: string;
  readonly numero: string;
  readonly comentario: string;
  readonly constante: string;
  readonly operador: string;
}

/**
 * O nome de um tema escolhido.
 *
 * É texto livre desde o T012: além dos embutidos, o `config.json` pode declarar
 * temas do usuário, e o nome deles é dele. Quem valida é `resolverTema`, que
 * cai no `escuro` para qualquer coisa que não exista.
 */
export type NomeDoTema = string;

/**
 * Um tema declarado pelo usuário no `config.json`.
 *
 * **Herda de um embutido e sobrescreve só o que quiser.** Exigir as vinte e
 * cinco cores para trocar o realce de comentário garantiria que ninguém
 * escrevesse um. As chaves são as mesmas da paleta — quem quiser ver a lista
 * abre o seletor de tema e copia a de um embutido.
 */
export interface TemaDoUsuario {
  /** O embutido de onde as cores ausentes vêm. Padrão: `escuro`. */
  readonly base?: string;
  readonly cores?: Readonly<Record<string, unknown>>;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** As cores de sintaxe vão para o Monaco SEM `#` — é o formato que ele espera. */
const HEX_SEM_CERQUILHA = /^[0-9a-fA-F]{6}$/;

function cor(valor: unknown, padrao: string, comCerquilha: boolean): string {
  if (typeof valor !== 'string') return padrao;
  const limpo = valor.trim();
  if (comCerquilha) return HEX.test(limpo) ? limpo.toLowerCase() : padrao;
  // Tolerante ao `#` na sintaxe: é o erro que todo mundo comete ao copiar uma
  // cor de outro lugar, e recusar por causa dele seria pedantismo.
  const sem = limpo.startsWith('#') ? limpo.slice(1) : limpo;
  return HEX_SEM_CERQUILHA.test(sem) ? sem.toLowerCase() : padrao;
}

/**
 * Junta o tema do usuário sobre o embutido que ele escolheu como base.
 *
 * **Cor inválida vale como ausente**, e não como erro: um dígito trocado num
 * `config.json` editado à mão não pode deixar a IDE sem tema. O que sobra é a
 * cor da base, que é sempre completa.
 *
 * Devolve `null` quando o nome não é de ninguém — quem chama decide o padrão.
 */
export function resolverTema(
  nome: NomeDoTema,
  embutidos: Readonly<Record<string, Paleta>>,
  doUsuario: Readonly<Record<string, TemaDoUsuario>> = {}
): Paleta | null {
  const embutido = embutidos[nome];
  if (embutido !== undefined) return embutido;

  const meu = doUsuario[nome];
  if (meu === undefined) return null;

  const base = embutidos[meu.base ?? ''] ?? embutidos.escuro;
  if (base === undefined) return null;
  const c = meu.cores ?? {};

  return {
    bg: cor(c.bg, base.bg, true),
    bgPanel: cor(c.bgPanel, base.bgPanel, true),
    bgEditor: cor(c.bgEditor, base.bgEditor, true),
    border: cor(c.border, base.border, true),
    fg: cor(c.fg, base.fg, true),
    fgDim: cor(c.fgDim, base.fgDim, true),
    accent: cor(c.accent, base.accent, true),
    run: cor(c.run, base.run, true),
    error: cor(c.error, base.error, true),
    selecao: cor(c.selecao, base.selecao, true),
    selecaoFraca: cor(c.selecaoFraca, base.selecaoFraca, true),
    sintaxe: juntarSintaxe(c.sintaxe, base.sintaxe),
    ansi: juntarAnsi(c.ansi, base.ansi),
  };
}

function juntarSintaxe(bruto: unknown, base: PaletaDeSintaxe): PaletaDeSintaxe {
  const c = (bruto ?? {}) as Record<string, unknown>;
  const saida = {} as Record<keyof PaletaDeSintaxe, string>;
  for (const chave of Object.keys(base) as Array<keyof PaletaDeSintaxe>) {
    saida[chave] = cor(c[chave], base[chave], false);
  }
  return saida;
}

function juntarAnsi(bruto: unknown, base: PaletaAnsi): PaletaAnsi {
  const c = (bruto ?? {}) as Record<string, unknown>;
  const saida = {} as Record<keyof PaletaAnsi, string>;
  for (const chave of Object.keys(base) as Array<keyof PaletaAnsi>) {
    saida[chave] = cor(c[chave], base[chave], true);
  }
  return saida;
}

/**
 * Lê os temas do usuário como vierem do `config.json`.
 *
 * Tolerante em cada nível: o que não for objeto some, e o resto entra. Um tema
 * torto não pode levar os outros junto.
 */
export function normalizarTemasDoUsuario(bruto: unknown): Record<string, TemaDoUsuario> {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
  const saida: Record<string, TemaDoUsuario> = {};
  for (const [nome, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (nome === '' || valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
      continue;
    }
    const v = valor as Record<string, unknown>;
    const base = typeof v.base === 'string' ? v.base : undefined;
    const cores =
      v.cores !== null && typeof v.cores === 'object' && !Array.isArray(v.cores)
        ? (v.cores as Record<string, unknown>)
        : {};
    saida[nome] = { ...(base === undefined ? {} : { base }), cores };
  }
  return saida;
}

// ---------------------------------------------------------------------------
// O catálogo vivo
// ---------------------------------------------------------------------------
//
// Os embutidos são constantes; os do usuário chegam com o `config.json`, que é
// lido depois que a tela já existe. O catálogo mora aqui, num `let`, e não numa
// prop atravessando dez componentes — é o mesmo caminho do CodeLens e do
// autocomplete: quem sabe registra, quem precisa pergunta.

import { TEMAS, type TemaEmbutido } from './temas-embutidos';

let temasDoUsuario: Readonly<Record<string, TemaDoUsuario>> = {};

export function definirTemasDoUsuario(mapa: Readonly<Record<string, TemaDoUsuario>>): void {
  temasDoUsuario = mapa;
}

/** Os nomes que o seletor oferece: embutidos primeiro, os dele depois. */
export function nomesDeTema(): readonly string[] {
  return [...Object.keys(TEMAS), ...Object.keys(temasDoUsuario)];
}

export function ehTema(valor: string): boolean {
  return Object.prototype.hasOwnProperty.call(TEMAS, valor) || valor in temasDoUsuario;
}

/**
 * A paleta de um tema, seja embutido ou dele.
 *
 * **Nunca devolve nada pela metade.** Nome que não existe cai no `escuro`: a
 * alternativa seria a tela sem cor nenhuma, e um `config.json` com um nome
 * digitado errado não pode fazer isso.
 */
export function paletaDe(nome: NomeDoTema): Paleta {
  return resolverTema(nome, TEMAS, temasDoUsuario) ?? TEMAS.escuro;
}

export type { TemaEmbutido };
