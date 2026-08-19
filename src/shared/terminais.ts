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

export interface EstadoDeTerminais {
  readonly lista: readonly TerminalAberto[];
  readonly ativo: string | null;
}

export const SEM_TERMINAIS: EstadoDeTerminais = { lista: [], ativo: null };

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
    lista: [...estado.lista, { id, titulo: proximoTitulo(estado.lista), par: id }],
    ativo: id,
  };
}

/**
 * Abre um terminal **ao lado** do ativo, no mesmo par.
 *
 * Sem ativo, é o mesmo que abrir um normal: dividir o nada não significa coisa
 * alguma, e recusar seria atrito por preciosismo.
 */
export function dividirTerminal(estado: EstadoDeTerminais, id: string): EstadoDeTerminais {
  const ativo = estado.lista.find((t) => t.id === estado.ativo);
  if (ativo === undefined) return abrirTerminal(estado, id);
  return {
    lista: [...estado.lista, { id, titulo: proximoTitulo(estado.lista), par: ativo.par }],
    ativo: id,
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
  if (estado.ativo !== id) return { lista, ativo: estado.ativo };

  const proximo = lista[indice] ?? lista[indice - 1] ?? null;
  return { lista, ativo: proximo === null ? null : proximo.id };
}

export function ativarTerminal(estado: EstadoDeTerminais, id: string): EstadoDeTerminais {
  return estado.lista.some((t) => t.id === id) ? { ...estado, ativo: id } : estado;
}
