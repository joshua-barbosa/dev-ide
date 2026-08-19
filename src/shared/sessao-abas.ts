// As abas que sobrevivem ao F5.
//
// A spec 023 devolveu os terminais do painel depois de recarregar a página; as
// abas do editor continuavam sumindo, e com elas o terminal de CONEXÃO, que é
// aba do editor desde a spec 008.
//
// Aqui mora só a forma do que se guarda e a leitura tolerante dela. Quem lê
// disco e quem mexe no store estão fora — é a regra do Artigo III, e é o que
// permite testar as decisões chatas (arquivo apagado, pasta trocada, grupo que
// não existe mais) sem navegador nem servidor.
import { gruposDe, LAYOUT_INICIAL, removerGrupo, type NoDeLayout } from './layout-editor';

/** Uma aba guardada. Só arquivo: ver `NÃO se guarda` abaixo. */
export interface AbaSalva {
  readonly caminho: string;
  readonly grupo: number;
}

export interface SessaoDeAbas {
  /**
   * A pasta que estava aberta.
   *
   * É o que impede as abas de um projeto reaparecerem noutro. Sem isto, abrir
   * outra pasta traria de volta arquivos que não pertencem a ela.
   */
  readonly pasta: string;
  readonly abas: readonly AbaSalva[];
  /** Caminho da aba ativa de cada grupo, indexado pelo número do grupo. */
  readonly ativas: Readonly<Record<string, string>>;
  readonly grupoFocado: number;
  readonly layout: NoDeLayout;
}

export const SESSAO_VAZIA: SessaoDeAbas = {
  pasta: '',
  abas: [],
  ativas: {},
  grupoFocado: 0,
  layout: LAYOUT_INICIAL,
};

/**
 * O que **NÃO** se guarda, e por quê:
 *
 * - **Aba sem título.** Ela só existe na memória; guardar o caminho não serve
 *   porque não há caminho, e guardar o conteúdo poria texto do usuário no
 *   `localStorage` sem ele pedir.
 * - **O que não foi salvo.** Restaurar a aba mostrando o disco é honesto;
 *   restaurar mostrando uma cópia velha de uma edição seria pior que não
 *   restaurar nada.
 * - **Aba de query, formulário e grade.** São vistas de uma conexão viva, e
 *   ressuscitá-las sem a conexão daria uma aba que não faz nada.
 */
function lerNo(bruto: unknown): NoDeLayout | null {
  if (bruto === null || typeof bruto !== 'object') return null;
  const no = bruto as Record<string, unknown>;
  if (no.tipo === 'grupo') {
    return typeof no.grupo === 'number' && Number.isInteger(no.grupo) && no.grupo >= 0
      ? { tipo: 'grupo', grupo: no.grupo }
      : null;
  }
  if (no.tipo !== 'divisao') return null;
  if (no.orientacao !== 'horizontal' && no.orientacao !== 'vertical') return null;
  if (!Array.isArray(no.filhos)) return null;
  const filhos = no.filhos.map(lerNo).filter((f): f is NoDeLayout => f !== null);
  // Divisão com menos de dois filhos não é divisão: vira o filho, ou nada.
  if (filhos.length === 0) return null;
  if (filhos.length === 1) return filhos[0] ?? null;
  return { tipo: 'divisao', orientacao: no.orientacao, filhos };
}

/**
 * Lê o que estava guardado, tolerando qualquer estrago.
 *
 * Mesma regra do `normalizarTerminais`: valor quebrado vale como ausente. Um
 * formato de uma versão anterior — ou um `localStorage` mexido à mão — não pode
 * impedir a IDE de abrir.
 */
export function normalizarSessao(bruto: unknown): SessaoDeAbas {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return SESSAO_VAZIA;
  const lido = bruto as Record<string, unknown>;
  if (typeof lido.pasta !== 'string' || lido.pasta === '') return SESSAO_VAZIA;
  if (!Array.isArray(lido.abas)) return SESSAO_VAZIA;

  const vistos = new Set<string>();
  const abas: AbaSalva[] = [];
  for (const item of lido.abas) {
    const a = (item ?? {}) as Record<string, unknown>;
    if (typeof a.caminho !== 'string' || a.caminho === '') continue;
    // A mesma aba duas vezes viraria duas abas do mesmo arquivo — que é
    // exatamente o que o store proíbe quando se abre pela árvore.
    if (vistos.has(a.caminho)) continue;
    const grupo = typeof a.grupo === 'number' && Number.isInteger(a.grupo) && a.grupo >= 0
      ? a.grupo
      : 0;
    vistos.add(a.caminho);
    abas.push({ caminho: a.caminho, grupo });
  }
  if (abas.length === 0) return SESSAO_VAZIA;

  const layout = lerNo(lido.layout) ?? LAYOUT_INICIAL;

  // Ativa que aponta para aba que não foi guardada é lixo: seria uma referência
  // a nada, e o grupo abriria sem aba nenhuma à vista.
  const ativas: Record<string, string> = {};
  const brutoAtivas = (lido.ativas ?? {}) as Record<string, unknown>;
  for (const [grupo, caminho] of Object.entries(brutoAtivas)) {
    if (typeof caminho !== 'string') continue;
    if (abas.some((a) => a.caminho === caminho && String(a.grupo) === grupo)) {
      ativas[grupo] = caminho;
    }
  }

  const focado = typeof lido.grupoFocado === 'number' ? lido.grupoFocado : 0;
  const vivos = new Set(gruposDe(layout));
  return {
    pasta: lido.pasta,
    abas,
    ativas,
    grupoFocado: vivos.has(focado) ? focado : (gruposDe(layout)[0] ?? 0),
    layout,
  };
}

/**
 * Tira do arranjo os grupos que não têm aba, e das abas os grupos que não
 * existem no arranjo.
 *
 * As duas verdades se desencontram quando um arquivo é apagado com a IDE
 * fechada: o arranjo guardado prevê dois lados e só um tem conteúdo. Sem isto,
 * a IDE abriria com metade da tela em branco e sem forma de fechá-la.
 */
export function conciliar(sessao: SessaoDeAbas, existentes: ReadonlySet<string>): SessaoDeAbas {
  const abas = sessao.abas.filter((a) => existentes.has(a.caminho));
  if (abas.length === 0) return SESSAO_VAZIA;

  const comAba = new Set(abas.map((a) => a.grupo));
  let layout = sessao.layout;
  for (const grupo of gruposDe(layout)) {
    if (!comAba.has(grupo)) layout = removerGrupo(layout, grupo);
  }
  // Grupo com aba mas fora do arranjo perderia o editor: manda para o primeiro.
  const noLayout = new Set(gruposDe(layout));
  const destino = gruposDe(layout)[0] ?? 0;
  const ajustadas = abas.map((a) => (noLayout.has(a.grupo) ? a : { ...a, grupo: destino }));

  const ativas: Record<string, string> = {};
  for (const [grupo, caminho] of Object.entries(sessao.ativas)) {
    if (ajustadas.some((a) => a.caminho === caminho && String(a.grupo) === grupo)) {
      ativas[grupo] = caminho;
    }
  }
  const gruposComAba = new Set(ajustadas.map((a) => a.grupo));
  return {
    ...sessao,
    abas: ajustadas,
    ativas,
    layout,
    grupoFocado: gruposComAba.has(sessao.grupoFocado) ? sessao.grupoFocado : destino,
  };
}

/**
 * Monta a sessão a partir do que está na tela.
 *
 * Recebe já filtrado o que é aba de arquivo: decidir isso exige conhecer o
 * `meta` da aba, que é da interface. Aqui só se organiza.
 */
export function montarSessao(entrada: {
  readonly pasta: string;
  readonly abas: readonly AbaSalva[];
  readonly ativas: Readonly<Record<string, string>>;
  readonly grupoFocado: number;
  readonly layout: NoDeLayout;
}): SessaoDeAbas {
  // Passa pela mesma leitura tolerante da volta: guardar algo que não se
  // consegue ler de volta seria guardar nada, e só se descobriria no F5.
  return normalizarSessao(entrada);
}
