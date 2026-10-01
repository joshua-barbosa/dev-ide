// O notebook `.brnb` — o formato e as operações sobre ele (spec 112).
//
// Ele (30/09) pediu *"uma espécie de sqlbook mas no estilo do Jupyter
// Notebook"*, e decidiu que é uma feature SEPARADA do sqlbook, com um kernel por
// notebook: Python, JavaScript, TypeScript ou PHP. Células SQL e Markdown
// existem em qualquer um; o resultado de uma célula SQL vira variável no kernel
// pelo NOME dela.
//
// PURO de propósito, como `shared/sql/caderno.ts`: IDE e extensão leem e gravam
// pelo mesmo código, e a parte que erra calada — ler um arquivo estranho — se
// testa sem navegador.
//
// Imutável: cada operação devolve um notebook NOVO. A tela compara por
// identidade para saber o que repintar.
import type { CellValue } from '../contracts';
import type { Vinculo } from '../sql/vinculo';

export const FORMATO = 'braytech-notebook';
/**
 * A versão mais nova que esta Braytech Code LÊ. Um notebook de uma linguagem só
 * continua gravando 1 (a 0.1.12 abre); um MISTO grava 2, e uma versão velha o
 * recusa com recado — em vez de rodar a célula JavaScript no kernel Python.
 */
export const VERSAO_DO_NOTEBOOK = 2;

export const KERNELS = ['python', 'javascript', 'typescript', 'php'] as const;
export type Kernel = (typeof KERNELS)[number];

export type TipoDeCelula = 'codigo' | 'sql' | 'markdown';

/**
 * Quantas linhas de uma tabela ficam GUARDADAS no arquivo.
 *
 * O kernel recebe o resultado inteiro (sem teto, decisão dele); o arquivo
 * guarda o que se VÊ — é o que o Jupyter faz com um DataFrame. Sem isto, uma
 * consulta de um milhão de linhas viraria um `.brnb` de centenas de MB.
 */
export const SAIDA_MAX_LINHAS = 500;

export type Saida =
  | { readonly tipo: 'texto'; readonly fluxo: 'saida' | 'erro'; readonly texto: string }
  | {
      readonly tipo: 'tabela';
      readonly colunas: readonly string[];
      readonly linhas: readonly (readonly CellValue[])[];
      /** Quantas linhas o resultado tinha — pode ser mais que as guardadas. */
      readonly total: number;
    }
  | { readonly tipo: 'erro'; readonly mensagem: string }
  | { readonly tipo: 'imagem'; readonly mime: string; readonly dados: string };

export interface Celula {
  readonly id: string;
  readonly tipo: TipoDeCelula;
  /**
   * Só código: em que linguagem a célula roda (spec 113). `null` em SQL e
   * Markdown. Arquivo antigo sem o campo: a do notebook.
   */
  readonly linguagem: Kernel | null;
  readonly conteudo: string;
  /** Só SQL: a variável que o resultado vira no kernel. */
  readonly nome: string | null;
  /** Só SQL: outra conexão que a do notebook, quando a célula escolhe. */
  readonly conexao: Vinculo | null;
  /** O `[3]` do Jupyter: em que ordem a célula rodou. `null` = nunca. */
  readonly contador: number | null;
  readonly saidas: readonly Saida[];
}

export interface Notebook {
  /** A linguagem PADRÃO das células de código novas (spec 113). */
  readonly kernel: Kernel;
  /** A conexão padrão das células SQL. */
  readonly conexao: Vinculo | null;
  /**
   * Só PHP: subir a aplicação Laravel no kernel. DESLIGADO por padrão (spec
   * 112): subida, ela fala com o banco do `.env` fora da trava de
   * somente-leitura da IDE. Gravado para reabrir como ele deixou.
   */
  readonly laravel: boolean;
  readonly celulas: readonly Celula[];
}

// ---------------------------------------------------------------------------
// Nomes
// ---------------------------------------------------------------------------

/**
 * Palavras que não podem ser nome de variável em Python ou JavaScript.
 *
 * No PHP a variável leva `$`, então palavra reservada não atrapalha — mas o
 * nome é UM só para os três kernels, e vale a regra mais estreita.
 */
const RESERVADAS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'def', 'default', 'del', 'delete', 'do', 'elif', 'else', 'enum',
  'except', 'export', 'extends', 'false', 'False', 'finally', 'for', 'from', 'function',
  'global', 'if', 'import', 'in', 'instanceof', 'is', 'lambda', 'let', 'new', 'None',
  'nonlocal', 'not', 'null', 'or', 'pass', 'raise', 'return', 'super', 'switch', 'this',
  'throw', 'true', 'True', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

/** Um nome que Python, JavaScript e PHP aceitam como variável. */
export function nomeValido(nome: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(nome) && !RESERVADAS.has(nome);
}

/** O menor `resultadoN` que nenhuma célula usa. */
export function nomeDeResultadoLivre(nb: Pick<Notebook, 'celulas'>): string {
  const usados = new Set(nb.celulas.map((c) => c.nome));
  for (let n = 1; ; n += 1) {
    if (!usados.has(`resultado${n}`)) return `resultado${n}`;
  }
}

// ---------------------------------------------------------------------------
// Criar e mexer
// ---------------------------------------------------------------------------

function celulaVazia(id: string, tipo: TipoDeCelula, nome: string | null, linguagem: Kernel | null): Celula {
  return { id, tipo, linguagem: tipo === 'codigo' ? linguagem : null, conteudo: '', nome, conexao: null, contador: null, saidas: [] };
}

/** Um notebook novo já traz uma célula de código: é por ela que se começa. */
export function notebookNovo(kernel: Kernel, conexao: Vinculo | null): Notebook {
  return { kernel, conexao, laravel: false, celulas: [celulaVazia('c1', 'codigo', null, kernel)] };
}

/**
 * A linguagem de uma célula de código nova na posição: a da célula de código
 * mais próxima ACIMA; sem nenhuma, a do notebook. Quem escreve Python embaixo
 * de Python não quer ter de escolher de novo.
 */
export function linguagemParaInserir(nb: Notebook, posicao: number): Kernel {
  const acima = nb.celulas.slice(0, Math.max(0, posicao));
  for (let i = acima.length - 1; i >= 0; i -= 1) {
    const l = acima[i].linguagem;
    if (acima[i].tipo === 'codigo' && l !== null) return l;
  }
  return nb.kernel;
}

/** As linguagens das células de código, sem repetir, na ordem em que aparecem. */
export function linguagensDoNotebook(nb: Pick<Notebook, 'celulas'>): Kernel[] {
  const vistas: Kernel[] = [];
  for (const c of nb.celulas) {
    if (c.tipo === 'codigo' && c.linguagem !== null && !vistas.includes(c.linguagem)) vistas.push(c.linguagem);
  }
  return vistas;
}

export function inserirCelula(
  nb: Notebook, tipo: TipoDeCelula, posicao: number, id: string,
  /** Só código: uma linguagem escolhida, em vez da herdada de cima. */
  linguagem?: Kernel
): Notebook {
  const nova = celulaVazia(
    id, tipo, tipo === 'sql' ? nomeDeResultadoLivre(nb) : null, linguagem ?? linguagemParaInserir(nb, posicao)
  );
  const onde = Math.max(0, Math.min(posicao, nb.celulas.length));
  return { ...nb, celulas: [...nb.celulas.slice(0, onde), nova, ...nb.celulas.slice(onde)] };
}

/** O que a tela pode mudar numa célula. Trocar o tipo ajusta o nome junto. */
export type MudancaDeCelula = Partial<Pick<Celula, 'conteudo' | 'nome' | 'conexao' | 'tipo' | 'linguagem'>>;

export function alterarCelula(nb: Notebook, id: string, mudanca: MudancaDeCelula): Notebook {
  return {
    ...nb,
    celulas: nb.celulas.map((c) => {
      if (c.id !== id) return c;
      const tipo = mudanca.tipo ?? c.tipo;
      // Virou SQL sem nome: ganha um. Deixou de ser SQL: nome e conexão somem.
      const nome = tipo !== 'sql' ? null : (mudanca.nome ?? c.nome ?? nomeDeResultadoLivre(nb));
      const conexao = tipo !== 'sql' ? null : (mudanca.conexao !== undefined ? mudanca.conexao : c.conexao);
      // Só código tem linguagem; voltar a ser código sem dizer qual: a do notebook.
      const linguagem = tipo !== 'codigo' ? null : (mudanca.linguagem ?? c.linguagem ?? nb.kernel);
      return { ...c, ...mudanca, tipo, nome, conexao, linguagem };
    }),
  };
}

export function removerCelula(nb: Notebook, id: string): Notebook {
  return { ...nb, celulas: nb.celulas.filter((c) => c.id !== id) };
}

export function moverCelula(nb: Notebook, id: string, destino: number): Notebook {
  const celula = nb.celulas.find((c) => c.id === id);
  if (celula === undefined) return nb;
  const sem = nb.celulas.filter((c) => c.id !== id);
  const onde = Math.max(0, Math.min(destino, sem.length));
  return { ...nb, celulas: [...sem.slice(0, onde), celula, ...sem.slice(onde)] };
}

export function registrarExecucao(
  nb: Notebook, id: string, contador: number, saidas: readonly Saida[]
): Notebook {
  return {
    ...nb,
    celulas: nb.celulas.map((c) => (c.id === id ? { ...c, contador, saidas } : c)),
  };
}

/** "Limpar saídas": de uma célula, ou de todas. O contador volta a `null`. */
export function limparSaidas(nb: Notebook, id?: string): Notebook {
  return {
    ...nb,
    celulas: nb.celulas.map((c) =>
      id === undefined || c.id === id ? { ...c, contador: null, saidas: [] } : c
    ),
  };
}

/** A tabela como fica GUARDADA: as primeiras linhas e o total de verdade. */
export function saidaDeTabela(
  colunas: readonly string[], linhas: readonly (readonly CellValue[])[]
): Saida {
  return { tipo: 'tabela', colunas, linhas: linhas.slice(0, SAIDA_MAX_LINHAS), total: linhas.length };
}

// ---------------------------------------------------------------------------
// Ler e gravar
// ---------------------------------------------------------------------------

export function escreverNotebook(nb: Notebook): string {
  const misto = nb.celulas.some((c) => c.tipo === 'codigo' && c.linguagem !== null && c.linguagem !== nb.kernel);
  const dados = {
    formato: FORMATO,
    versao: misto ? VERSAO_DO_NOTEBOOK : 1,
    kernel: nb.kernel,
    conexao: nb.conexao,
    laravel: nb.laravel,
    celulas: nb.celulas,
  };
  return `${JSON.stringify(dados, null, 2)}\n`;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

function lerVinculo(v: unknown): Vinculo | null {
  if (!ehObjeto(v) || typeof v.connectionId !== 'string' || typeof v.database !== 'string') {
    return null;
  }
  return { connectionId: v.connectionId, database: v.database };
}

function lerSaida(v: unknown): Saida | null {
  if (!ehObjeto(v)) return null;
  switch (v.tipo) {
    case 'texto':
      return { tipo: 'texto', fluxo: v.fluxo === 'erro' ? 'erro' : 'saida', texto: texto(v.texto) };
    case 'erro':
      return { tipo: 'erro', mensagem: texto(v.mensagem) };
    case 'imagem':
      return typeof v.dados === 'string' && typeof v.mime === 'string'
        ? { tipo: 'imagem', mime: v.mime, dados: v.dados }
        : null;
    case 'tabela': {
      if (!Array.isArray(v.colunas) || !Array.isArray(v.linhas)) return null;
      const linhas = v.linhas.filter(Array.isArray) as CellValue[][];
      return {
        tipo: 'tabela',
        colunas: v.colunas.map(String),
        linhas,
        total: typeof v.total === 'number' ? v.total : linhas.length,
      };
    }
    default:
      // Tipo que esta versão não conhece: descartado, não quebra a leitura.
      return null;
  }
}

/**
 * Lê um `.brnb`. `null` quando o arquivo está VAZIO — é um notebook que ainda
 * não escolheu kernel (criado pela árvore), e a aba pergunta qual.
 *
 * Arquivo estragado LANÇA com recado: abrir um notebook e ver tela branca é o
 * pior jeito de descobrir que ele não abre.
 */
export function lerNotebook(conteudo: string): Notebook | null {
  if (conteudo.trim() === '') return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo);
  } catch (e) {
    throw new Error(`O arquivo não é um notebook válido: JSON quebrado (${(e as Error).message}).`);
  }
  if (!ehObjeto(bruto) || bruto.formato !== FORMATO) {
    throw new Error('Este arquivo não é um notebook da Braytech Code.');
  }
  if (typeof bruto.versao !== 'number' || bruto.versao > VERSAO_DO_NOTEBOOK) {
    throw new Error(
      `Este notebook é da versão ${String(bruto.versao)} do formato; esta versão lê até a ` +
        `${VERSAO_DO_NOTEBOOK}. Atualize a Braytech Code.`
    );
  }
  if (!KERNELS.includes(bruto.kernel as Kernel)) {
    throw new Error(
      `O notebook pede o kernel "${String(bruto.kernel)}", que não existe. ` +
        `Os kernels são: ${KERNELS.join(', ')}.`
    );
  }

  const celulas: Celula[] = [];
  for (const [i, c] of (Array.isArray(bruto.celulas) ? bruto.celulas : []).entries()) {
    if (!ehObjeto(c)) continue;
    const tipo: TipoDeCelula = c.tipo === 'sql' || c.tipo === 'markdown' ? c.tipo : 'codigo';
    const nomeLido = tipo === 'sql' && typeof c.nome === 'string' && nomeValido(c.nome) ? c.nome : null;
    celulas.push({
      id: typeof c.id === 'string' && c.id !== '' ? c.id : `c${i + 1}`,
      tipo,
      // Sem o campo (arquivo da 0.1.12) ou com um que não existe: a do notebook.
      linguagem: tipo !== 'codigo' ? null
        : KERNELS.includes(c.linguagem as Kernel) ? (c.linguagem as Kernel) : (bruto.kernel as Kernel),
      conteudo: texto(c.conteudo),
      nome: tipo === 'sql' ? (nomeLido ?? nomeDeResultadoLivre({ celulas })) : null,
      conexao: tipo === 'sql' ? lerVinculo(c.conexao) : null,
      contador: typeof c.contador === 'number' ? c.contador : null,
      saidas: (Array.isArray(c.saidas) ? c.saidas : [])
        .map(lerSaida)
        .filter((s): s is Saida => s !== null),
    });
  }
  return {
    kernel: bruto.kernel as Kernel,
    conexao: lerVinculo(bruto.conexao),
    laravel: bruto.laravel === true,
    celulas,
  };
}

/**
 * A pasta de projeto que contém o notebook — a MAIS FUNDA, quando uma raiz
 * aberta mora dentro de outra. É o limite da busca por `.venv` (ver
 * `server/notebook/ambiente.ts`).
 *
 * Aceita `/` e `\`: o caminho vem do servidor, que pode ser Windows.
 */
export function raizQueContem(caminho: string, raizes: readonly string[]): string | null {
  const plano = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const alvo = plano(caminho);
  const candidatas = raizes.filter((r) => alvo.startsWith(`${plano(r)}/`));
  if (candidatas.length === 0) return null;
  return candidatas.reduce((a, b) => (plano(b).length > plano(a).length ? b : a));
}
