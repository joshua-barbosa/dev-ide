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
      /**
       * Quanto cada filho ocupa, em fração de 0 a 1 (T021).
       *
       * **Opcional de propósito.** Uma sessão gravada antes desta spec não tem
       * o campo, e um arranjo sem tamanhos abre meio a meio — nunca quebrado.
       * Quem lê usa `tamanhosDe`, que já resolve a ausência e o desacerto de
       * contagem.
       */
      readonly tamanhos?: readonly number[];
    };

/** Onde a aba solta cai, em relação ao grupo que está embaixo do cursor. */
export type Lado = 'esquerda' | 'direita' | 'cima' | 'baixo';

export const GRUPO_INICIAL = 0;
export const LAYOUT_INICIAL: NoDeLayout = { tipo: 'grupo', grupo: GRUPO_INICIAL };

/**
 * A menor fatia que uma divisão aceita.
 *
 * Um grupo de largura zero não é grupo: some da tela e não há o que agarrar
 * para trazê-lo de volta. Oito por cento é estreito e ainda agarrável.
 */
export const MINIMO_DA_DIVISAO = 0.08;

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

/**
 * Sempre pode dividir (T019).
 *
 * Havia um teto de seis, e a desculpa que escrevi era *"mantém a barra de abas
 * legível"* — palpite meu sobre a tela dele. A nota da triagem foi direta:
 * *"Sem teto, como o VS Code"*. A função fica, porque é por ela que a interface
 * pergunta, e um dia pode voltar a haver motivo.
 */
export function podeDividir(_no: NoDeLayout): boolean {
  return true;
}

/**
 * As frações de cada filho, sempre com o tamanho certo e somando 1.
 *
 * Resolve os dois jeitos de o campo estar errado: ausente (sessão antiga) e com
 * contagem diferente da de filhos (arranjo mexido por outro caminho). Em ambos,
 * meio a meio — nunca um layout quebrado por causa de um número.
 */
export function tamanhosDe(no: NoDeLayout): readonly number[] {
  // Um grupo não tem filhos para dividir: lista vazia, e não um erro. Quem
  // desenha percorre a árvore sem perguntar de que tipo é cada nó.
  if (no.tipo === 'grupo') return [];
  const n = no.filhos.length;
  const guardados = no.tamanhos;
  if (guardados === undefined || guardados.length !== n) {
    return Array.from({ length: n }, () => 1 / n);
  }
  const soma = guardados.reduce((a, b) => a + b, 0);
  return soma > 0 ? guardados.map((t) => t / soma) : Array.from({ length: n }, () => 1 / n);
}

/**
 * Move a fronteira entre o filho `indice` e o seguinte.
 *
 * **Só os dois vizinhos mudam.** Arrastar uma fronteira não pode mexer no
 * terceiro painel — quem arrasta espera trocar espaço entre os dois lados
 * daquela linha, e mais nada.
 *
 * `caminho` é a sequência de índices até a divisão, da raiz para baixo.
 */
export function redimensionar(
  no: NoDeLayout,
  caminho: readonly number[],
  indice: number,
  fracaoDoPrimeiro: number
): NoDeLayout {
  if (no.tipo === 'grupo') return no;

  if (caminho.length > 0) {
    const [i, ...resto] = caminho;
    return {
      ...no,
      filhos: no.filhos.map((f, k) =>
        k === i ? redimensionar(f, resto, indice, fracaoDoPrimeiro) : f
      ),
    };
  }

  const atuais = [...tamanhosDe(no)];
  const a = atuais[indice];
  const b = atuais[indice + 1];
  if (a === undefined || b === undefined) return no;

  const par = a + b;
  const novoA = Math.min(par - MINIMO_DA_DIVISAO, Math.max(MINIMO_DA_DIVISAO, fracaoDoPrimeiro));
  atuais[indice] = novoA;
  atuais[indice + 1] = par - novoA;
  return { ...no, tamanhos: atuais };
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
    return {
      tipo: 'divisao',
      orientacao,
      filhos: antes ? [novoNo, no] : [no, novoNo],
      tamanhos: [0.5, 0.5],
    };
  }

  const i = no.filhos.findIndex((f) => f.tipo === 'grupo' && f.grupo === alvo);
  if (i !== -1 && no.orientacao === orientacao) {
    const filhos = [...no.filhos];
    filhos.splice(antes ? i : i + 1, 0, novoNo);
    // O novo nasce dividindo o espaço DO ALVO, e não roubando de todos: dividir
    // a terceira coluna não pode estreitar a primeira, que ele já ajustou.
    const atuais = [...tamanhosDe(no)];
    const doAlvo = atuais[i] ?? 1 / filhos.length;
    atuais[i] = doAlvo / 2;
    atuais.splice(antes ? i : i + 1, 0, doAlvo / 2);
    return { ...no, filhos, tamanhos: atuais };
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

  const antes = tamanhosDe(no);
  const sobreviventes: number[] = [];
  const filhos: NoDeLayout[] = [];
  no.filhos.forEach((f, i) => {
    const podado = podar(f, grupo);
    if (podado === null) return;
    filhos.push(podado);
    sobreviventes.push(antes[i] ?? 0);
  });

  if (filhos.length === 0) return null;
  if (filhos.length === 1) return filhos[0] as NoDeLayout;
  // O espaço do que saiu é REDISTRIBUÍDO: `tamanhosDe` normaliza a soma, então
  // basta entregar as fatias que sobraram. Sem isto ficaria um buraco.
  return { ...no, filhos, tamanhos: sobreviventes };
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
