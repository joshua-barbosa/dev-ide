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
    lista: [...estado.lista, { id, titulo: proximoTitulo(estado.lista) }],
    ativo: id,
  };
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
