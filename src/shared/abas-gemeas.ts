// O mesmo arquivo aberto em dois grupos (T028, spec 072).
//
// A desculpa que eu tinha escrito para não fazer era *"mudança no modelo, não
// no arranjo"* — verdadeira e irrelevante: era descrição do trabalho, não
// motivo para não fazê-lo.
//
// **O problema real é um só: duas abas do mesmo arquivo não podem ter dois
// conteúdos.** Se tivessem, salvar de um lado apagaria o que foi escrito do
// outro, e o defeito só apareceria depois de perder trabalho. Quem resolve isso
// é o Monaco — os dois editores dividem o MESMO modelo, como no VS Code, e o
// texto é um só por construção. Aqui mora apenas a identidade: como uma cópia
// se chama e como se acha a irmã dela.
//
// O id da cópia é `copia:<n>:<id original>`. Prefixo, e não sufixo: um sufixo
// como `#2` poderia colidir com um arquivo de verdade chamado `x#2`, que no
// Linux é nome legítimo. Nenhum id da IDE começa com `copia:`.

const PREFIXO = 'copia:';
const FORMATO = /^copia:(\d+):(.+)$/;

/** O id da n-ésima cópia de uma aba. */
export function idDeCopia(idBase: string, n: number): string {
  return `${PREFIXO}${n}:${idBase}`;
}

export function ehCopia(id: string): boolean {
  return FORMATO.test(id);
}

/**
 * O id da aba original, dado o de qualquer uma das cópias.
 *
 * Um id que não é cópia é a própria base — assim quem chama não precisa
 * perguntar antes.
 */
export function idBaseDe(id: string): string {
  return FORMATO.exec(id)?.[2] ?? id;
}

/**
 * Todos os ids que mostram o mesmo arquivo, o próprio incluído.
 *
 * É o que `marcarSujo` e `salvar` usam: as gêmeas têm de sujar e limpar juntas,
 * senão um lado ficaria com a bolinha de "não salvo" para sempre.
 */
export function gemeas(ids: readonly string[], id: string): string[] {
  const base = idBaseDe(id);
  return ids.filter((outro) => idBaseDe(outro) === base);
}

/**
 * Um id de cópia que ainda não existe.
 *
 * Conta a partir de 2 porque a original é a 1 — `copia:1:` nunca é gerado, e um
 * arquivo aberto duas vezes mostra `2` na segunda, que é o que se lê.
 */
export function proximaCopia(ids: readonly string[], id: string): string {
  const base = idBaseDe(id);
  const usados = new Set(ids);
  for (let n = 2; ; n += 1) {
    const tentativa = idDeCopia(base, n);
    if (!usados.has(tentativa)) return tentativa;
  }
}

/**
 * A chave do modelo de texto de uma aba.
 *
 * Duas abas com a MESMA chave dividem o modelo do Monaco, e por isso dividem o
 * texto, o histórico de desfazer e cada tecla digitada. É o caminho do arquivo
 * quando há um; senão, o id da aba — uma aba sem título não tem gêmea possível,
 * e um modelo só dela é o certo.
 */
export function chaveDoModelo(id: string, caminho: string | null): string {
  return caminho === null || caminho === '' ? `aba:${idBaseDe(id)}` : `arquivo:${caminho}`;
}

/** O prefixo das URIs de modelo. Mora aqui porque a chave também mora. */
export const ESQUEMA_DO_MODELO = 'inmemory://aba/';

/**
 * O caminho do arquivo a partir da URI do modelo — o INVERSO de
 * `chaveDoModelo`.
 *
 * O caminho já está dentro da URI, e lê-lo de lá é o que permite aos provedores
 * de linguagem do Monaco (lote E) saberem de qual arquivo se trata sem
 * consultar o estado do React — que eles não enxergam, porque rodam dentro do
 * editor.
 *
 * Aba sem arquivo (`aba:…`) devolve `null`: não há o que perguntar ao serviço
 * de linguagem sobre um texto que não está em lugar nenhum.
 */
export function caminhoDaUri(uri: string): string | null {
  if (!uri.startsWith(ESQUEMA_DO_MODELO)) return null;
  let chave: string;
  try {
    chave = decodeURIComponent(uri.slice(ESQUEMA_DO_MODELO.length));
  } catch {
    // URI estragada não pode derrubar o autocomplete.
    return null;
  }
  return chave.startsWith('arquivo:') ? chave.slice('arquivo:'.length) : null;
}
