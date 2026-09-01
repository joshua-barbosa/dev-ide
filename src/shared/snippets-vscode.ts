// Snippets no formato do VS Code (T017, T018).
//
// Um formato, dois usos. O mesmo leitor serve para **importar** os snippets que
// ele já tem (T017) e para ler os que vêm **com o projeto** (T018) — foi o que
// permitiu os dois itens custarem um arquivo em vez de dois.
//
// O formato é um objeto onde a CHAVE é o nome:
//
// ```json
// { "Log": { "prefix": "log", "body": ["console.log($1);", "$0"] } }
// ```
//
// O corpo pode ser lista de linhas ou texto único, e os marcadores (`$1`,
// `${1:valor}`, `$0`) são os mesmos do Monaco — o que significa que o snippet
// importado funciona igual, com espelho e tudo, sem conversão nenhuma.
import { LINGUAGEM_TODAS, MAX_CORPO, MAX_PREFIXO, type Snippet } from './snippets';

/** Um snippet lido de fora, ainda sem id — quem grava atribui. */
export type SnippetImportado = Omit<Snippet, 'id'>;

const MAX_POR_ARQUIVO = 500;

/**
 * A linguagem de um arquivo de snippets do VS Code.
 *
 * `javascript.json` vale para JavaScript; `qualquer.code-snippets` vale para
 * todas, salvo `scope` dizendo o contrário. É a regra do VS Code, e adivinhar
 * diferente poria snippet de Python aparecendo em SQL.
 */
export function linguagemDoArquivo(nome: string): string {
  const limpo = nome.split('/').pop() ?? nome;
  if (limpo.endsWith('.code-snippets')) return LINGUAGEM_TODAS;
  const ponto = limpo.lastIndexOf('.');
  const base = ponto <= 0 ? limpo : limpo.slice(0, ponto);
  return base.trim() === '' ? LINGUAGEM_TODAS : base.trim().toLowerCase();
}

function corpoDe(bruto: unknown): string {
  if (typeof bruto === 'string') return bruto;
  if (!Array.isArray(bruto)) return '';
  // Só as linhas de texto: uma lista com número no meio viria de um arquivo
  // estragado, e emendar o número no código daria um corpo que não compila.
  return bruto.filter((l): l is string => typeof l === 'string').join('\n');
}

/**
 * Os snippets de um arquivo do VS Code.
 *
 * **Entrada ruim é DESCARTADA, uma a uma.** Um snippet sem prefixo ou sem corpo
 * não tem como disparar nem o que inserir; recusar o arquivo inteiro por causa
 * dele faria perder os outros vinte que estavam certos.
 *
 * `scope` vira a linguagem quando tem UMA só. Com várias, cai em `*`: esta IDE
 * guarda uma linguagem por snippet, e escolher a primeira da lista esconderia
 * o snippet nas outras.
 */
export function lerSnippetsDoVsCode(
  bruto: unknown,
  linguagemPadrao: string = LINGUAGEM_TODAS
): readonly SnippetImportado[] {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return [];

  const saida: SnippetImportado[] = [];
  for (const [nome, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (saida.length >= MAX_POR_ARQUIVO) break;
    if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) continue;
    const v = valor as Record<string, unknown>;

    // `prefix` também pode ser uma LISTA no VS Code; a primeira é a que vale
    // aqui, porque esta IDE guarda um prefixo por snippet.
    const prefixoBruto = Array.isArray(v.prefix) ? v.prefix[0] : v.prefix;
    const prefixo = typeof prefixoBruto === 'string' ? prefixoBruto.trim() : '';
    const corpo = corpoDe(v.body);
    if (prefixo === '' || /\s/.test(prefixo) || prefixo.length > MAX_PREFIXO) continue;
    if (corpo.trim() === '' || corpo.length > MAX_CORPO) continue;

    const escopo = Array.isArray(v.scope)
      ? v.scope.filter((e): e is string => typeof e === 'string')
      : typeof v.scope === 'string'
        ? v.scope.split(',').map((e) => e.trim()).filter((e) => e !== '')
        : [];

    saida.push({
      nome: nome.trim() === '' ? prefixo : nome.trim(),
      prefixo,
      corpo,
      linguagem: escopo.length === 1 ? (escopo[0] as string).toLowerCase() : linguagemPadrao,
    });
  }
  return saida;
}

/**
 * Tira os que já existem, comparando por PREFIXO e linguagem.
 *
 * É o par que dispara o snippet: dois com o mesmo prefixo na mesma linguagem
 * fariam a conclusão oferecer duas entradas idênticas, e importar duas vezes
 * dobraria a lista em silêncio. O nome não entra na comparação — mudar o nome
 * não faz dele outro snippet.
 */
export function semOsRepetidos(
  novos: readonly SnippetImportado[],
  existentes: readonly Snippet[]
): readonly SnippetImportado[] {
  const chave = (s: { prefixo: string; linguagem: string }): string =>
    `${s.linguagem}\u0000${s.prefixo}`;
  const vistos = new Set(existentes.map(chave));
  const saida: SnippetImportado[] = [];
  for (const novo of novos) {
    if (vistos.has(chave(novo))) continue;
    vistos.add(chave(novo));
    saida.push(novo);
  }
  return saida;
}
