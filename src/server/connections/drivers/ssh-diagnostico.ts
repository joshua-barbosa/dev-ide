// Por que a conexão SSH não fechou (spec 052, D21 e AC-5).
//
// Existe porque "falha ao conectar" não ensina nada, e o caso mais provável na
// lista do usuário é o mais silencioso: um servidor de 2017 oferece `ssh-rsa`
// (SHA-1) e `diffie-hellman-group14-sha1`, que o `ssh2` desabilita por padrão.
// A conexão morre no aperto de mão, e o usuário não tem como adivinhar que a
// resposta está em três campos de texto que ele nem abriu.
//
// Puro: recebe a mensagem de erro e as linhas de depuração que o `ssh2` emitiu,
// e devolve texto. Isso permite provar cada caso sem servidor nenhum.

/** O que o servidor ofereceu, quando dá para saber. */
export interface OfertaDoServidor {
  readonly kex?: readonly string[];
  readonly serverHostKey?: readonly string[];
  readonly cipher?: readonly string[];
}

/**
 * O `ssh2` emite as listas do servidor na depuração, numa linha por categoria.
 *
 * O formato mudou entre versões, então a leitura é tolerante: procura a
 * categoria pelo nome e pega o que vem depois dos dois-pontos. Não achar é
 * resposta legítima — o erro sai sem a lista, e continua melhor que o original.
 */
export function lerOfertaDoServidor(linhas: readonly string[]): OfertaDoServidor {
  const pegar = (marca: RegExp): readonly string[] | undefined => {
    for (const linha of linhas) {
      const m = marca.exec(linha);
      const lista = m?.[1];
      if (lista === undefined) continue;
      const itens = lista
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s !== '');
      if (itens.length > 0) return itens;
    }
    return undefined;
  };

  return {
    kex: pegar(/remote ident|KEX(?: method)?s?\s*:\s*(.+)$/i),
    serverHostKey: pegar(/(?:host key|server host key)(?: algorithms?)?\s*:\s*(.+)$/i),
    cipher: pegar(/cipher(?:s)?(?: \(.*?\))?\s*:\s*(.+)$/i),
  };
}

/** As mensagens do `ssh2` que significam "não temos algoritmo em comum". */
const MARCAS_DE_NEGOCIACAO = [
  'no matching key exchange',
  'no matching cipher',
  'no matching server host key',
  'no matching mac',
  'handshake failed',
  'no mutual signature',
];

function ehNegociacao(mensagem: string): boolean {
  const m = mensagem.toLowerCase();
  return MARCAS_DE_NEGOCIACAO.some((marca) => m.includes(marca));
}

/**
 * Enriquece o erro quando ele for de negociação; devolve `null` quando não for.
 *
 * `null` é importante: senha errada e host inalcançável já têm mensagem boa, e
 * cobri-las com um texto sobre algoritmos mandaria o usuário para o lugar
 * errado — que é pior que não dizer nada.
 */
export function explicarFalhaDeHandshake(
  mensagem: string,
  linhasDeDepuracao: readonly string[] = []
): string | null {
  if (!ehNegociacao(mensagem)) return null;

  const oferta = lerOfertaDoServidor(linhasDeDepuracao);
  const partes = [
    'O servidor e a IDE não têm algoritmo em comum — a conexão morreu no aperto de mão, ' +
      'antes de qualquer senha.',
    'Isso é comum com servidor antigo: o cliente moderno desabilita por padrão ' +
      '`ssh-rsa` (SHA-1) e `diffie-hellman-group14-sha1`, que é o que ele oferece.',
  ];

  const oferecido: string[] = [];
  if (oferta.kex !== undefined) oferecido.push(`kex: ${oferta.kex.join(', ')}`);
  if (oferta.serverHostKey !== undefined) {
    oferecido.push(`chave do servidor: ${oferta.serverHostKey.join(', ')}`);
  }
  if (oferta.cipher !== undefined) oferecido.push(`ciphers: ${oferta.cipher.join(', ')}`);
  if (oferecido.length > 0) partes.push(`O servidor ofereceu — ${oferecido.join(' · ')}.`);

  partes.push(
    'Preencha os campos da seção **Algoritmo** com o que ele aceita e tente de novo.'
  );
  partes.push(`Mensagem original: ${mensagem}`);
  return partes.join('\n');
}

/**
 * A distribuição, lida do `/etc/os-release` (AC-11).
 *
 * `PRETTY_NAME` é o que a ferramenta de referência mostra ao lado do nome da
 * conexão (`Ubuntu 24.04.2 LTS`, `Debian GNU/Linux 13 (trixie)`). Quando não há
 * `/etc/os-release` — macOS, BSD, um contêiner mínimo —, devolve `null`, e a
 * árvore mostra só o nome. Inventar "Linux" ali seria dizer algo que não se sabe.
 */
export function lerDistribuicao(osRelease: string): string | null {
  for (const linha of osRelease.split('\n')) {
    const m = /^PRETTY_NAME\s*=\s*(.+)$/.exec(linha.trim());
    const valor = m?.[1];
    if (valor === undefined) continue;
    // O arquivo usa aspas duplas, e o valor pode ter espaço e parêntese.
    const limpo = valor.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (limpo !== '') return limpo;
  }
  return null;
}

export type SistemaRemoto = 'linux' | 'macos' | 'windows' | 'desconhecido';

/** Que sistema é, pelo que o `uname -s` respondeu. */
export function sistemaDe(uname: string): SistemaRemoto {
  const s = uname.trim().toLowerCase();
  if (s.includes('darwin')) return 'macos';
  if (s.includes('linux')) return 'linux';
  if (s.includes('mingw') || s.includes('cygwin') || s.includes('windows')) return 'windows';
  return 'desconhecido';
}
