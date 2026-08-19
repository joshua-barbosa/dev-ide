// Como os grupos de editor estão arranjados na tela.
//
// **Aqui a spec 020 é revista.** Lá o arranjo era um campo (`grupo: number`) e
// só havia duas colunas, e o plano registrava o porquê: *"árvore é o modelo
// certo para N divisões aninhadas e o errado para duas"*. O usuário pediu
// justamente N divisões aninhadas — esquerda, direita, cima, baixo, mais de uma
// vez —, então a árvore passou a ser o modelo certo.
//
// O que **não** mudou: a aba continua pertencendo a um grupo numerado, e o store
// de abas não sabe desta árvore. Ela descreve só o ARRANJO. Essa separação é o
// que permitiu trocar o layout inteiro sem tocar nas regras de "qual aba fica
// ativa depois de fechar", que são as testadas há mais tempo.

/** `horizontal` = lado a lado; `vertical` = um sobre o outro. */
export type Orientacao = 'horizontal' | 'vertical';

export type NoDeLayout =
  | { readonly tipo: 'grupo'; readonly grupo: number }
  | {
      readonly tipo: 'divisao';
      readonly orientacao: Orientacao;
      readonly filhos: readonly NoDeLayout[];
    };

/** Onde a aba solta cai, em relação ao grupo que está embaixo do cursor. */
export type Lado = 'esquerda' | 'direita' | 'cima' | 'baixo';

export const GRUPO_INICIAL = 0;
export const LAYOUT_INICIAL: NoDeLayout = { tipo: 'grupo', grupo: GRUPO_INICIAL };

/** Quantos grupos cabem antes de a tela virar mosaico ilegível. */
export const MAX_GRUPOS = 6;

function orientacaoDe(lado: Lado): Orientacao {
  return lado === 'esquerda' || lado === 'direita' ? 'horizontal' : 'vertical';
}

/** `esquerda` e `cima` entram ANTES do alvo; `direita` e `baixo`, depois. */
function entraAntes(lado: Lado): boolean {
  return lado === 'esquerda' || lado === 'cima';
}

/** Os grupos, na ordem em que aparecem na tela. */
export function gruposDe(no: NoDeLayout): readonly number[] {
  if (no.tipo === 'grupo') return [no.grupo];
  return no.filhos.flatMap(gruposDe);
}

/** O menor número livre. Reaproveita buraco em vez de sempre incrementar. */
export function proximoGrupo(no: NoDeLayout): number {
  const usados = new Set(gruposDe(no));
  for (let n = 0; ; n += 1) if (!usados.has(n)) return n;
}

export function podeDividir(no: NoDeLayout): boolean {
  return gruposDe(no).length < MAX_GRUPOS;
}

/**
 * Divide um grupo, pondo um grupo novo do lado pedido.
 *
 * **Divisão de mesma orientação vira IRMÃ, não aninhada.** Dividir três vezes à
 * direita dá três colunas lado a lado, e não uma coluna com uma coluna dentro
 * de outra — que é o que uma inserção ingênua produziria, e o que faria a
 * terceira coluna nascer com metade da largura da segunda.
 */
export function dividir(
  no: NoDeLayout,
  alvo: number,
  lado: Lado,
  novoGrupo: number
): NoDeLayout {
  const orientacao = orientacaoDe(lado);
  const antes = entraAntes(lado);
  const novoNo: NoDeLayout = { tipo: 'grupo', grupo: novoGrupo };

  if (no.tipo === 'grupo') {
    if (no.grupo !== alvo) return no;
    return { tipo: 'divisao', orientacao, filhos: antes ? [novoNo, no] : [no, novoNo] };
  }

  const i = no.filhos.findIndex((f) => f.tipo === 'grupo' && f.grupo === alvo);
  if (i !== -1 && no.orientacao === orientacao) {
    const filhos = [...no.filhos];
    filhos.splice(antes ? i : i + 1, 0, novoNo);
    return { ...no, filhos };
  }
  return { ...no, filhos: no.filhos.map((f) => dividir(f, alvo, lado, novoGrupo)) };
}

/**
 * Tira um grupo do arranjo, colapsando o que sobrar.
 *
 * Divisão que fica com um filho só deixa de ser divisão — senão sobraria uma
 * moldura vazia em volta de um grupo, e cada fechamento deixaria um nível morto
 * na árvore.
 */
export function removerGrupo(no: NoDeLayout, grupo: number): NoDeLayout {
  const podado = podar(no, grupo);
  return podado ?? LAYOUT_INICIAL;
}

function podar(no: NoDeLayout, grupo: number): NoDeLayout | null {
  if (no.tipo === 'grupo') return no.grupo === grupo ? null : no;

  const filhos = no.filhos
    .map((f) => podar(f, grupo))
    .filter((f): f is NoDeLayout => f !== null);

  if (filhos.length === 0) return null;
  if (filhos.length === 1) return filhos[0] as NoDeLayout;
  return { ...no, filhos };
}

/**
 * Descarta do arranjo os grupos que não existem mais, e garante que sobre um.
 *
 * A árvore e o store de abas são duas verdades; esta função reconcilia as duas
 * quando algo mexeu numa e não na outra — fechar a última aba de um grupo, por
 * exemplo.
 */
export function normalizarLayout(
  no: NoDeLayout,
  gruposVivos: ReadonlySet<number>
): NoDeLayout {
  let atual = no;
  for (const grupo of gruposDe(no)) {
    if (!gruposVivos.has(grupo)) atual = removerGrupo(atual, grupo);
  }
  return gruposDe(atual).length === 0 ? LAYOUT_INICIAL : atual;
}
