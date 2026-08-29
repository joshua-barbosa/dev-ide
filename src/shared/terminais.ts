// Terminais abertos no painel inferior.
//
// Existe pela mesma razão que o store de abas: **"fechei o do meio, qual fica
// ativo?"** é a pergunta que erra na prática. O store de abas já errou essa uma
// vez, e lá virou teste; repetir o erro num segundo store, agora sem teste,
// seria não ter aprendido nada.
//
// Só terminais de **shell** moram aqui. O de conexão continua sendo aba do
// editor — decisão D6, registrada no backlog: saída longa de query merece tela
// cheia, comando curto de shell não.

export interface TerminalAberto {
  readonly id: string;
  readonly titulo: string;
  /**
   * A que **par** este terminal pertence.
   *
   * Terminais do mesmo par aparecem lado a lado — é o "split terminal". Um
   * terminal comum é o único do par dele, e o par recebe o id do primeiro. O
   * modelo é esse, e não uma árvore de painéis, pelo mesmo motivo da spec 020:
   * árvore é o certo para N divisões aninhadas e o errado para duas.
   */
  readonly par: string;
}

/** `horizontal` = lado a lado; `vertical` = um sobre o outro. */
export type OrientacaoDoPar = 'horizontal' | 'vertical';

export interface EstadoDeTerminais {
  readonly lista: readonly TerminalAberto[];
  readonly ativo: string | null;
  /**
   * Como os panes de cada par se arrumam (T020).
   *
   * Uma orientação POR PAR, e não por pane: misturar as duas dentro de um par
   * exigiria uma árvore, e o painel de baixo não tem altura para isso. Par sem
   * entrada aqui é horizontal — que é como sempre foi, e é o que faz uma sessão
   * gravada antes desta spec abrir igual.
   */
  readonly orientacoes: Readonly<Record<string, OrientacaoDoPar>>;
}

export const SEM_TERMINAIS: EstadoDeTerminais = { lista: [], ativo: null, orientacoes: {} };

/** Como o par daquele terminal se arruma. Sem entrada, horizontal. */
export function orientacaoDoPar(estado: EstadoDeTerminais, id: string): OrientacaoDoPar {
  const par = estado.lista.find((t) => t.id === id)?.par ?? id;
  return estado.orientacoes[par] ?? 'horizontal';
}

/** Vira o par inteiro de lado a lado para um sobre o outro, e de volta. */
export function alternarOrientacao(estado: EstadoDeTerminais, id: string): EstadoDeTerminais {
  const par = estado.lista.find((t) => t.id === id)?.par;
  if (par === undefined) return estado;
  const atual = estado.orientacoes[par] ?? 'horizontal';
  return {
    ...estado,
    orientacoes: { ...estado.orientacoes, [par]: atual === 'horizontal' ? 'vertical' : 'horizontal' },
  };
}

/**
 * Lê o estado guardado no navegador, tolerando lixo.
 *
 * Existe porque a lista passou a ser **persistida** (spec 023), e o que está
 * guardado pode ter sido escrito por uma versão anterior — a de antes do campo
 * `par`, por exemplo. Entrada incompleta é descartada; a ativa que não existe
 * mais vira `null`, em vez de deixar um id fantasma apontando para nada.
 */
export function normalizarTerminais(bruto: unknown): EstadoDeTerminais {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return SEM_TERMINAIS;
  const lido = bruto as Record<string, unknown>;
  if (!Array.isArray(lido.lista)) return SEM_TERMINAIS;

  const lista: TerminalAberto[] = [];
  for (const item of lido.lista) {
    const t = (item ?? {}) as Record<string, unknown>;
    if (typeof t.id !== 'string' || t.id === '') continue;
    if (typeof t.titulo !== 'string' || t.titulo === '') continue;
    lista.push({
      id: t.id,
      titulo: t.titulo,
      par: typeof t.par === 'string' && t.par !== '' ? t.par : t.id,
    });
  }

  const ativo =
    typeof lido.ativo === 'string' && lista.some((t) => t.id === lido.ativo)
      ? lido.ativo
      : (lista[0]?.id ?? null);

  // As orientações guardadas, só as de par que ainda existe: sessão antiga não
  // tem o campo, e par fechado não pode deixar entrada órfã crescendo.
  const pares = new Set(lista.map((t) => t.par));
  const orientacoes: Record<string, OrientacaoDoPar> = {};
  const brutas = lido.orientacoes;
  if (brutas !== null && typeof brutas === 'object' && !Array.isArray(brutas)) {
    for (const [par, valor] of Object.entries(brutas as Record<string, unknown>)) {
      if (pares.has(par) && (valor === 'horizontal' || valor === 'vertical')) {
        orientacoes[par] = valor;
      }
    }
  }
  return { lista, ativo, orientacoes };
}

/** Nome na sequência em que foram abertos: "Terminal 1", "Terminal 2"… */
export function proximoTitulo(lista: readonly TerminalAberto[]): string {
  const usados = new Set(lista.map((t) => t.titulo));
  for (let n = 1; ; n += 1) {
    const candidato = `Terminal ${n}`;
    // Reaproveita o número livre em vez de sempre incrementar: fechar o 1 e
    // abrir outro deve dar "Terminal 1", não "Terminal 3".
    if (!usados.has(candidato)) return candidato;
  }
}

export function abrirTerminal(estado: EstadoDeTerminais, id: string): EstadoDeTerminais {
  if (estado.lista.some((t) => t.id === id)) return { ...estado, ativo: id };
  return {
    ...estado,
    lista: [...estado.lista, { id, titulo: proximoTitulo(estado.lista), par: id }],
    ativo: id,
  };
}

/**
 * Quantos panes cabem lado a lado num par.
 *
 * A spec 021 parou em dois e disse por quê: "a interface fica ilegível na
 * altura de um painel inferior". Medido depois, o argumento vale para a
 * ALTURA, não para a quantidade — quatro panes numa janela normal dão uns 45
 * caracteres de largura cada, que é estreito e legível. Acima disso viram tiras.
 *
 * O editor tem o mesmo tipo de teto (`MAX_GRUPOS`, seis), pelo mesmo motivo.
 */
export const MAX_PANES = 4;

/** Verdadeiro enquanto couber outro pane ao lado do ativo. */
export function podeDividirTerminal(estado: EstadoDeTerminais): boolean {
  const ativo = estado.lista.find((t) => t.id === estado.ativo);
  if (ativo === undefined) return estado.lista.length === 0;
  return estado.lista.filter((t) => t.par === ativo.par).length < MAX_PANES;
}

/**
 * Abre um terminal **ao lado** do ativo, no mesmo par.
 *
 * Sem ativo, é o mesmo que abrir um normal: dividir o nada não significa coisa
 * alguma, e recusar seria atrito por preciosismo.
 */
export function dividirTerminal(
  estado: EstadoDeTerminais,
  id: string,
  orientacao: OrientacaoDoPar = 'horizontal'
): EstadoDeTerminais {
  const ativo = estado.lista.find((t) => t.id === estado.ativo);
  if (ativo === undefined) return abrirTerminal(estado, id);
  // No teto, dividir não faz nada: o comando já aparece cinza, e o clique que
  // escapar por atalho não pode criar uma tira ilegível.
  if (!podeDividirTerminal(estado)) return estado;
  return {
    ...estado,
    lista: [...estado.lista, { id, titulo: proximoTitulo(estado.lista), par: ativo.par }],
    ativo: id,
    // A orientação é do PAR e se fixa na PRIMEIRA divisão: dividir de novo não
    // vira a tela sob os dedos de quem só queria mais um pane.
    orientacoes:
      estado.orientacoes[ativo.par] === undefined
        ? { ...estado.orientacoes, [ativo.par]: orientacao }
        : estado.orientacoes,
  };
}

/** Os terminais que dividem a tela com o ativo, na ordem de abertura. */
export function paneisVisiveis(estado: EstadoDeTerminais): readonly TerminalAberto[] {
  const ativo = estado.lista.find((t) => t.id === estado.ativo);
  if (ativo === undefined) return [];
  return estado.lista.filter((t) => t.par === ativo.par);
}

/**
 * A lista lateral: uma entrada por par, com os panes dentro.
 *
 * É o que o VS Code mostra — o par é a unidade de navegação, e os panes são
 * detalhe de layout dele.
 */
export function paresDe(estado: EstadoDeTerminais): readonly (readonly TerminalAberto[])[] {
  const porPar = new Map<string, TerminalAberto[]>();
  for (const t of estado.lista) {
    const atual = porPar.get(t.par);
    if (atual === undefined) porPar.set(t.par, [t]);
    else atual.push(t);
  }
  return [...porPar.values()];
}

/**
 * Fecha um terminal e escolhe o próximo ativo.
 *
 * A regra: fica o **vizinho da direita**; não havendo, o da esquerda; não
 * havendo nenhum, `null`. É o que o VS Code faz e o que a mão espera — voltar
 * sempre para o primeiro faria o usuário perder o lugar.
 */
export function fecharTerminal(estado: EstadoDeTerminais, id: string): EstadoDeTerminais {
  const indice = estado.lista.findIndex((t) => t.id === id);
  if (indice === -1) return estado;

  const lista = estado.lista.filter((t) => t.id !== id);
  // A orientação de um par que não tem mais pane nenhum sai junto: entrada
  // órfã cresceria para sempre na sessão, sem nada apontando para ela.
  const vivos = new Set(lista.map((t) => t.par));
  const orientacoes = Object.fromEntries(
    Object.entries(estado.orientacoes).filter(([par]) => vivos.has(par))
  );
  if (estado.ativo !== id) return { lista, ativo: estado.ativo, orientacoes };

  const proximo = lista[indice] ?? lista[indice - 1] ?? null;
  return { lista, ativo: proximo === null ? null : proximo.id, orientacoes };
}

export function ativarTerminal(estado: EstadoDeTerminais, id: string): EstadoDeTerminais {
  return estado.lista.some((t) => t.id === id) ? { ...estado, ativo: id } : estado;
}
