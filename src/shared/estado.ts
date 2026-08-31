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
  /**
   * Pastas abertas agora, na ordem em que foram acrescentadas (T004).
   *
   * Era `pastaAtual: string | null`. Virou lista porque um espaço de trabalho
   * pode ter mais de uma raiz — a nota dele foi *"árvore, busca e Ctrl+P
   * cobrindo todas as pastas"*. Vazia = nenhuma, que é como a IDE nasce.
   */
  readonly pastas: readonly string[];
  /** Últimas pastas abertas, mais recente primeiro, sem repetição. */
  readonly recentes: readonly string[];
}

export const MAX_RECENTES = 10;

export const ESTADO_VAZIO: EstadoDaSessao = { pastas: [], recentes: [] };

/**
 * A primeira raiz, para quem só sabe lidar com uma.
 *
 * Existe para o que é ancorado numa pasta só e continua fazendo sentido assim —
 * criar arquivo pelo cabeçalho, por exemplo. Quem precisa cobrir tudo usa
 * `pastas` direto.
 */
export function pastaPrincipal(estado: EstadoDaSessao): string | null {
  return estado.pastas[0] ?? null;
}

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

  // `pastaAtual` é o formato de ANTES do T004. Um `state.json` gravado por uma
  // versão anterior tem que abrir na pasta certa, e não em nenhuma — migrar
  // aqui custa uma linha e evita "sumiu meu projeto" na primeira subida.
  const antigo =
    typeof lido.pastaAtual === 'string' && lido.pastaAtual !== '' ? [lido.pastaAtual] : [];
  const pastas = [...new Set([...textosDe(lido.pastas), ...antigo])];

  // As pastas abertas entram nos recentes mesmo que o arquivo não as tenha
  // listado: é o que garante que "abrir recente" sempre ofereça onde você está.
  const recentes = deduplicar([...pastas, ...textosDe(lido.recentes)]);
  return { pastas, recentes };
}

function deduplicar(caminhos: readonly string[]): readonly string[] {
  return [...new Set(caminhos)].slice(0, MAX_RECENTES);
}

/**
 * Abre uma pasta: ela passa a ser a ÚNICA, e sobe ao topo dos recentes.
 *
 * Substitui em vez de acrescentar porque `Open Folder…` é trocar de projeto —
 * é o que o gesto significa no VS Code e é o que ele fazia aqui antes do T004.
 * Quem quer somar usa `acrescentarPasta`.
 */
export function abrirPasta(estado: EstadoDaSessao, caminho: string): EstadoDaSessao {
  return {
    pastas: [caminho],
    recentes: deduplicar([caminho, ...estado.recentes]),
  };
}

/** Soma uma pasta ao espaço de trabalho, sem tirar as que já estão (T004). */
export function acrescentarPasta(estado: EstadoDaSessao, caminho: string): EstadoDaSessao {
  if (estado.pastas.includes(caminho)) return estado;
  return {
    pastas: [...estado.pastas, caminho],
    recentes: deduplicar([caminho, ...estado.recentes]),
  };
}

/** Fecha TODAS as pastas, preservando o histórico. */
export function fecharPasta(estado: EstadoDaSessao): EstadoDaSessao {
  return { pastas: [], recentes: estado.recentes };
}

/** Tira UMA raiz do espaço de trabalho, deixando as outras (T004). */
export function removerPasta(estado: EstadoDaSessao, caminho: string): EstadoDaSessao {
  if (!estado.pastas.includes(caminho)) return estado;
  return { pastas: estado.pastas.filter((c) => c !== caminho), recentes: estado.recentes };
}

/**
 * Tira uma pasta do histórico.
 *
 * Serve ao caso em que a pasta recente não existe mais: informar e esquecer é
 * melhor que deixá-la na lista para falhar de novo amanhã.
 */
export function esquecerPasta(estado: EstadoDaSessao, caminho: string): EstadoDaSessao {
  return {
    pastas: estado.pastas.filter((c) => c !== caminho),
    recentes: estado.recentes.filter((c) => c !== caminho),
  };
}
