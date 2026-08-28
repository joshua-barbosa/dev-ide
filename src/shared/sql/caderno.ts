// O formato do Query Book (spec 048).
//
// `.sqlbook` é JSON, e não um texto com separadores. A alternativa parecia
// melhor — continuaria legível e comparável no git —, mas quebra no primeiro
// bloco que contiver a própria marca. E um caderno de SQL contém SQL
// arbitrário: qualquer sequência que se escolha como separador pode aparecer
// dentro de um bloco.
//
// Leitura **tolerante**, como todo arquivo do usuário nesta IDE: bloco estragado
// é descartado, arquivo ilegível vira caderno vazio. Falhar aqui trocaria um
// caderno com um erro por nenhum caderno.

/**
 * A versão do formato. Sobe quando a forma mudar de um jeito incompatível.
 *
 * **3 (T072):** o bloco passou a poder guardar RESULTADOS. É compatível para
 * ler — uma versão antiga abre o arquivo e ignora o campo —, mas não para
 * gravar: aquela versão regravaria o caderno sem os resultados. O número existe
 * para essa perda ficar registrada em vez de acontecer calada.
 */
export const VERSAO_DO_CADERNO = 3;

/** O que uma linguagem de bloco pode ser. NÃO é lista fechada — ver `lerCaderno`. */
export type TipoDeCelula = string;

/** As duas únicas que a versão 1 do formato sabia escrever. */
const TIPOS_DA_VERSAO_1 = ['sql', 'markdown'];

/**
 * Um resultado guardado dentro do caderno (T072).
 *
 * A nota dele na triagem: *"não salvar automático, ele dar a opção de salvar
 * atrelado ao sqlbook, ao code block e com um nome que eu der"*. As três coisas
 * estão aqui: mora no arquivo, mora na CÉLULA, e tem nome dele.
 */
export interface ResultadoSalvo {
  /** O nome que ELE deu. É a chave dentro da célula. */
  readonly nome: string;
  /** Quando foi salvo, em ISO. A tela mostra: um resultado velho engana. */
  readonly salvoEm: string;
  readonly colunas: readonly string[];
  readonly linhas: readonly (readonly (string | null)[])[];
  /** Passou do teto e foi cortado — a tela precisa dizer. */
  readonly cortado: boolean;
}

/**
 * Teto de linhas por resultado guardado.
 *
 * O caderno é um arquivo que ele versiona no git. Um `SELECT` de 500 linhas com
 * cinquenta colunas viraria um JSON de megabytes por bloco, e o diff deixaria
 * de ser legível — que é metade da razão de o caderno existir.
 */
export const MAX_LINHAS_SALVAS = 200;

export interface Celula {
  /** Estável por bloco: é o que o React usa como chave, e o que o foco segue. */
  readonly id: string;
  /**
   * O id da linguagem, no vocabulário da IDE (`sql`, `markdown`, `php`, …).
   *
   * Aberta de propósito (spec 051): uma linguagem que esta versão da IDE não
   * conhece vira um bloco sem realce, e não um bloco perdido. Fechar a lista
   * aqui faria um caderno gravado por uma versão mais nova perder blocos ao
   * abrir numa mais velha — que é a pior coisa que um formato pode fazer.
   */
  readonly linguagem: TipoDeCelula;
  readonly conteudo: string;
  /**
   * Resultados guardados NESTE bloco (T072).
   *
   * Nunca automático: só entra aqui o que ele mandou salvar, com o nome que
   * ele deu. Guardar toda execução encheria o arquivo de lixo que ninguém
   * pediu — e foi exatamente o que ele recusou na triagem.
   */
  readonly resultados: readonly ResultadoSalvo[];
}

/**
 * Para onde vai o `▷ Run` de um bloco (spec 051, D19).
 *
 * `nada` é uma resposta legítima e comum: o seletor oferece todas as linguagens
 * do editor, e a IDE roda cinco. Um `▷ Run` que não faz nada é uma promessa
 * quebrada — então onde não há destino, o botão não existe.
 */
export type Destino = 'sql' | 'runner' | 'markdown' | 'nada';

/**
 * As que o runner da spec 006 executa.
 *
 * Python entrou no T077. A desculpa antiga — "o runner é Node" — descrevia o
 * runner, não um impedimento: ele já chamava `php`, `gcc` e `dotnet`, e passou
 * a chamar `python3` do mesmo jeito.
 */
const DO_RUNNER = ['javascript', 'typescript', 'php', 'c', 'csharp', 'python'];

export function comoRoda(linguagem: string): Destino {
  if (linguagem === 'sql') return 'sql';
  if (linguagem === 'markdown') return 'markdown';
  return DO_RUNNER.includes(linguagem) ? 'runner' : 'nada';
}

export interface Caderno {
  readonly celulas: readonly Celula[];
}

export const CADERNO_VAZIO: Caderno = { celulas: [] };

/** Um bloco novo, vazio. O id não precisa ser único no mundo — só no caderno. */
export function novaCelula(linguagem: TipoDeCelula, sufixo: number): Celula {
  return { id: `c${sufixo}`, linguagem, conteudo: '', resultados: [] };
}

/**
 * A linguagem de um bloco do arquivo, ou `null` se ele não disser nenhuma.
 *
 * Aceita as duas formas: `linguagem` (versão 2) e `tipo` (versão 1). A versão 1
 * é lida de forma CONSERVADORA — só os dois valores que ela sabia escrever —,
 * porque ali `tipo` era conjunto fechado e qualquer outra coisa é arquivo
 * estragado, não linguagem exótica.
 */
function linguagemDe(c: Record<string, unknown>): string | null {
  if (typeof c.linguagem === 'string' && c.linguagem !== '') return c.linguagem;
  if (typeof c.tipo === 'string' && TIPOS_DA_VERSAO_1.includes(c.tipo)) return c.tipo;
  return null;
}

/**
 * Lê um `.sqlbook`.
 *
 * Nunca lança. Um arquivo que não é JSON, ou que é JSON de outra coisa, vira
 * caderno vazio; um bloco sem tipo ou sem conteúdo é descartado e os vizinhos
 * sobrevivem.
 */
export function lerCaderno(texto: string): Caderno {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return CADERNO_VAZIO;
  }
  if (bruto === null || typeof bruto !== 'object') return CADERNO_VAZIO;

  const lista = (bruto as { celulas?: unknown }).celulas;
  if (!Array.isArray(lista)) return CADERNO_VAZIO;

  const celulas: Celula[] = [];
  lista.forEach((item, i) => {
    const c = (item ?? {}) as Record<string, unknown>;
    const linguagem = linguagemDe(c);
    if (linguagem === null || typeof c.conteudo !== 'string') return;
    // O id do arquivo é ignorado de propósito: dois blocos com o mesmo id
    // fariam o React confundir um com o outro, e nada garante que o arquivo
    // que veio de fora respeite isso.
    celulas.push({ id: `c${i}`, linguagem, conteudo: c.conteudo, resultados: lerResultados(c.resultados) });
  });
  return { celulas };
}

/**
 * Lê os resultados guardados de um bloco, tolerando lixo.
 *
 * Mesma regra do resto do arquivo: um resultado estragado é descartado e os
 * vizinhos sobrevivem. Um caderno com um resultado corrompido continua sendo
 * um caderno.
 */
function lerResultados(bruto: unknown): readonly ResultadoSalvo[] {
  if (!Array.isArray(bruto)) return [];
  const lidos: ResultadoSalvo[] = [];
  for (const item of bruto) {
    const r = (item ?? {}) as Record<string, unknown>;
    if (typeof r.nome !== 'string' || r.nome === '') continue;
    if (!Array.isArray(r.colunas) || !Array.isArray(r.linhas)) continue;
    lidos.push({
      nome: r.nome,
      salvoEm: typeof r.salvoEm === 'string' ? r.salvoEm : '',
      colunas: r.colunas.map((c) => String(c)),
      linhas: r.linhas
        .filter((l): l is unknown[] => Array.isArray(l))
        .map((l) => l.map((v) => (v === null || v === undefined ? null : String(v)))),
      cortado: r.cortado === true,
    });
  }
  return lidos;
}

/** Grava o caderno. O `id` NÃO vai para o arquivo: ele é de tela, não de dado. */
export function escreverCaderno(caderno: Caderno): string {
  const dados = {
    versao: VERSAO_DO_CADERNO,
    celulas: caderno.celulas.map((c) => ({
      linguagem: c.linguagem,
      conteudo: c.conteudo,
      // Ausente quando não há: um `"resultados": []` em cada bloco encheria o
      // diff de linha que não diz nada.
      ...(c.resultados.length === 0 ? {} : { resultados: c.resultados }),
    })),
  };
  return `${JSON.stringify(dados, null, 2)}\n`;
}

/**
 * Guarda um resultado no bloco, com o nome dele.
 *
 * Nome repetido SUBSTITUI, e é de propósito: rodar de novo e salvar com o mesmo
 * nome é atualizar aquele resultado. Acumular dois `vendas de junho` diferentes
 * seria pior que trocar.
 */
export function salvarResultado(
  caderno: Caderno,
  id: string,
  resultado: ResultadoSalvo
): Caderno {
  const cortado = resultado.linhas.length > MAX_LINHAS_SALVAS;
  const guardado: ResultadoSalvo = cortado
    ? { ...resultado, linhas: resultado.linhas.slice(0, MAX_LINHAS_SALVAS), cortado: true }
    : resultado;
  return {
    celulas: caderno.celulas.map((c) =>
      c.id === id
        ? {
            ...c,
            resultados: [...c.resultados.filter((r) => r.nome !== guardado.nome), guardado],
          }
        : c
    ),
  };
}

export function removerResultado(caderno: Caderno, id: string, nome: string): Caderno {
  return {
    celulas: caderno.celulas.map((c) =>
      c.id === id ? { ...c, resultados: c.resultados.filter((r) => r.nome !== nome) } : c
    ),
  };
}

/**
 * Insere um bloco numa **fresta** — a posição ENTRE dois blocos.
 *
 * Conta frestas, e não blocos: `0` é antes do primeiro, `n` é depois do último.
 * Até a spec 050 esta função contava "depois de qual bloco", e `-1` queria dizer
 * "no fim". As duas coordenadas conviveram mal por exatamente um teste: a fresta
 * 0 vira `depoisDe = -1`, que é o começo na conta das frestas e o FIM na outra.
 * Um sistema de coordenadas só, igual ao de `reordenar`, fecha essa porta.
 */
export function inserir(
  caderno: Caderno,
  linguagem: TipoDeCelula,
  fresta: number,
  sufixo: number
): Caderno {
  const nova = novaCelula(linguagem, sufixo);
  const onde = Math.max(0, Math.min(fresta, caderno.celulas.length));
  return {
    celulas: [...caderno.celulas.slice(0, onde), nova, ...caderno.celulas.slice(onde)],
  };
}

export function alterar(caderno: Caderno, id: string, conteudo: string): Caderno {
  return {
    celulas: caderno.celulas.map((c) => (c.id === id ? { ...c, conteudo } : c)),
  };
}

export function remover(caderno: Caderno, id: string): Caderno {
  return { celulas: caderno.celulas.filter((c) => c.id !== id) };
}

/**
 * Move um bloco uma posição.
 *
 * Nas pontas não faz nada — e não é engano: mover o primeiro para cima não tem
 * para onde ir, e embrulhar para o fim seria uma surpresa desagradável.
 */
export function mover(caderno: Caderno, id: string, direcao: -1 | 1): Caderno {
  const i = caderno.celulas.findIndex((c) => c.id === id);
  const j = i + direcao;
  if (i === -1 || j < 0 || j >= caderno.celulas.length) return caderno;

  const celulas = [...caderno.celulas];
  const a = celulas[i];
  const b = celulas[j];
  if (a === undefined || b === undefined) return caderno;
  celulas[i] = b;
  celulas[j] = a;
  return { celulas };
}

/**
 * Move um bloco para uma **fresta** — a posição ENTRE dois blocos (spec 050).
 *
 * `destino` conta frestas, não blocos: `0` é antes do primeiro, `n` é depois do
 * último. É assim porque é o que o arraste sabe dizer — o mouse cai entre duas
 * coisas, não sobre uma.
 *
 * A armadilha está no desconto: tirar o bloco da posição `i` faz tudo que vinha
 * depois descer uma casa, então uma fresta ADIANTE de `i` vale um a menos. Sem
 * isso, arrastar para a frente sempre erra por um.
 *
 * Soltar numa das duas frestas que encostam no próprio bloco devolve o caderno
 * IDÊNTICO — não só igual: é o que impede um arraste que não mudou nada de
 * marcar o arquivo como alterado.
 */
export function reordenar(caderno: Caderno, id: string, destino: number): Caderno {
  const i = caderno.celulas.findIndex((c) => c.id === id);
  if (i === -1) return caderno;

  const fresta = Math.max(0, Math.min(destino, caderno.celulas.length));
  if (fresta === i || fresta === i + 1) return caderno;

  const restantes = caderno.celulas.filter((_, k) => k !== i);
  const onde = fresta > i ? fresta - 1 : fresta;
  const celula = caderno.celulas[i];
  if (celula === undefined) return caderno;
  return { celulas: [...restantes.slice(0, onde), celula, ...restantes.slice(onde)] };
}

/**
 * Os blocos que o `Run All` roda, na ordem.
 *
 * Só os de SQL. Um caderno pertence a uma conexão, e `Run All` é a sequência de
 * consultas que reconstitui um problema; misturar a execução de um bloco de PHP
 * no meio dela daria um "rodou tudo" que não quer dizer nada.
 */
export function blocosExecutaveis(caderno: Caderno): readonly Celula[] {
  return caderno.celulas.filter(
    (c) => comoRoda(c.linguagem) === 'sql' && c.conteudo.trim() !== ''
  );
}
