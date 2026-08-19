// Estado da sessão: onde o usuário estava.
//
// Separado das preferências de propósito. **Preferência é escolha; estado é
// histórico.** Misturar os dois faria o `config.json` — que o usuário edita à
// mão — encher de lixo gerado pela IDE.
//
// Mora em `shared` porque as regras que erram na prática são puras: mover para
// o topo, não duplicar, cortar em dez, e não perder a pasta atual no caminho.
// São quatro linhas de lógica e um teste de dez, em vez de um clique manual.

export interface EstadoDaSessao {
  /** Pasta aberta agora. `null` = nenhuma, que é como a IDE nasce. */
  readonly pastaAtual: string | null;
  /** Últimas pastas abertas, mais recente primeiro, sem repetição. */
  readonly recentes: readonly string[];
}

export const MAX_RECENTES = 10;

export const ESTADO_VAZIO: EstadoDaSessao = { pastaAtual: null, recentes: [] };

function textosDe(bruto: unknown): readonly string[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.filter((v): v is string => typeof v === 'string' && v !== '');
}

/**
 * Lê o que veio do arquivo sem nunca lançar.
 *
 * Mesma regra do `config.json` (spec 011): estado ilegível vale como estado
 * vazio. O pior caso aceitável é a IDE subir sem pasta — nunca não subir.
 */
export function normalizarEstado(bruto: unknown): EstadoDaSessao {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return ESTADO_VAZIO;
  const lido = bruto as Record<string, unknown>;
  const pastaAtual =
    typeof lido.pastaAtual === 'string' && lido.pastaAtual !== '' ? lido.pastaAtual : null;
  // A pasta atual entra nos recentes mesmo que o arquivo não a tenha listado:
  // é o que garante que "abrir recente" sempre ofereça onde você está.
  const recentes = deduplicar([
    ...(pastaAtual === null ? [] : [pastaAtual]),
    ...textosDe(lido.recentes),
  ]);
  return { pastaAtual, recentes };
}

function deduplicar(caminhos: readonly string[]): readonly string[] {
  return [...new Set(caminhos)].slice(0, MAX_RECENTES);
}

/** Abre uma pasta: ela vira a atual e sobe ao topo dos recentes. Imutável. */
export function abrirPasta(estado: EstadoDaSessao, caminho: string): EstadoDaSessao {
  return {
    pastaAtual: caminho,
    recentes: deduplicar([caminho, ...estado.recentes]),
  };
}

/** Fecha a pasta atual, preservando o histórico. */
export function fecharPasta(estado: EstadoDaSessao): EstadoDaSessao {
  return { pastaAtual: null, recentes: estado.recentes };
}

/**
 * Tira uma pasta do histórico.
 *
 * Serve ao caso em que a pasta recente não existe mais: informar e esquecer é
 * melhor que deixá-la na lista para falhar de novo amanhã.
 */
export function esquecerPasta(estado: EstadoDaSessao, caminho: string): EstadoDaSessao {
  return {
    pastaAtual: estado.pastaAtual === caminho ? null : estado.pastaAtual,
    recentes: estado.recentes.filter((c) => c !== caminho),
  };
}
