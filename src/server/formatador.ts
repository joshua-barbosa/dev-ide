// Beautify e Minify de verdade: quem chama as bibliotecas.
//
// Roda no SERVIDOR, e não no navegador, por três motivos:
//
// - o Prettier com os plugins de PHP e Blade pesa alguns megabytes, e mandá-los
//   para o navegador atrasaria a abertura da IDE por uma função que quase nunca
//   é chamada;
// - Python depende de uma ferramenta INSTALADA na máquina, e só daqui dá para
//   ver se ela existe;
// - a declaração do que cada linguagem sabe fazer (`shared/formatacao.ts`) vira
//   uma resposta só, e a interface obedece sem carregar biblioteca nenhuma.
//
// Todas as bibliotecas entram por `import()` preguiçoso: quem nunca formata
// nada nunca paga por elas.
import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { acharNoPath } from './ferramentas-da-maquina';
import {
  CAPACIDADES, capacidadeDe, podeFormatar, sqlNumaLinha,
  type Capacidade, type ModoDeFormatacao,
} from '../shared/formatacao';

export interface OpcoesDeFormatacao {
  /** O `editor.tabSize` dele — o que sai daqui tem de casar com o que ele vê. */
  readonly tabSize: number;
  /** Dialeto da conexão ativa, quando a linguagem é SQL. */
  readonly dialeto?: string;
}

const PADRAO: OpcoesDeFormatacao = { tabSize: 2 };

/** Onde o Prettier acha os plugins, resolvido a partir DESTE arquivo. */
const plugin = (nome: string): string => require.resolve(nome);

/**
 * O formatador de Python que esta máquina tem, ou `null`.
 *
 * Procurado uma vez por chamada e não guardado: instalar o `ruff` no meio da
 * sessão tem de passar a funcionar sem reiniciar a IDE.
 */
export function formatadorDePython(): string | null {
  return acharNoPath(['ruff', 'black']);
}

/** A declaração completa, já com o que a máquina oferece (Artigo III). */
export function capacidades(): Record<string, Capacidade> {
  const ferramentas = { formatadorDePython: formatadorDePython() };
  const saida: Record<string, Capacidade> = {};
  for (const linguagem of Object.keys(CAPACIDADES)) {
    saida[linguagem] = capacidadeDe(linguagem, ferramentas);
  }
  return saida;
}

const PARSER_DO_PRETTIER: Readonly<Record<string, string>> = {
  javascript: 'babel',
  typescript: 'typescript',
  json: 'json',
  html: 'html',
  css: 'css',
  markdown: 'markdown',
  yaml: 'yaml',
  php: 'php',
  blade: 'blade',
};

async function comPrettier(
  texto: string,
  linguagem: string,
  opcoes: OpcoesDeFormatacao
): Promise<string> {
  const prettier = await import('prettier');
  const parser = PARSER_DO_PRETTIER[linguagem] as string;
  const plugins =
    linguagem === 'php'
      ? [plugin('@prettier/plugin-php')]
      : linguagem === 'blade'
        ? [plugin('@shufo/prettier-plugin-blade')]
        : [];
  return prettier.format(texto, {
    parser,
    plugins,
    tabWidth: opcoes.tabSize,
    // O `.prettierrc` do PROJETO não é lido de propósito: o Beautify daqui é um
    // gesto do editor, e ler configuração de projeto faria o mesmo botão dar
    // resultados diferentes em pastas diferentes, sem nada na tela dizendo.
  });
}

/** Python pelo `ruff` ou pelo `black`, num arquivo temporário. */
async function comPython(texto: string, ferramenta: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-fmt-'));
  const arquivo = path.join(dir, 'trecho.py');
  fs.writeFileSync(arquivo, texto, 'utf8');
  const argumentos = ferramenta.endsWith('ruff')
    ? ['format', '--quiet', arquivo]
    : ['--quiet', arquivo];
  try {
    await new Promise<void>((resolver, rejeitar) => {
      execFile(ferramenta, argumentos, { timeout: 20_000 }, (erro, _saida, saidaDeErro) => {
        // O `ruff` e o `black` põem o erro de sintaxe no stderr, com linha e
        // coluna. Repassar isso é melhor que "falhou ao formatar".
        if (erro !== null) rejeitar(new Error(saidaDeErro.trim() || erro.message));
        else resolver();
      });
    });
    return fs.readFileSync(arquivo, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function beautify(
  texto: string,
  linguagem: string,
  opcoes: OpcoesDeFormatacao
): Promise<string> {
  if (linguagem === 'sql') {
    const { format } = await import('sql-formatter');
    return format(texto, {
      // O dialeto vem da conexão ativa: `LIMIT` e `TOP` não quebram igual.
      language: dialetoDoSql(opcoes.dialeto),
      tabWidth: opcoes.tabSize,
      keywordCase: 'upper',
    });
  }
  if (linguagem === 'xml') {
    const formatarXml = (await import('xml-formatter')).default;
    return formatarXml(texto, { indentation: ' '.repeat(opcoes.tabSize), lineSeparator: '\n' });
  }
  if (linguagem === 'dockerfile') {
    const { format } = await import('dockerfile-utils');
    // A biblioteca devolve EDIÇÕES (como um servidor de linguagem faria), e não
    // o texto pronto. Aplicadas de trás para a frente, para que o deslocamento
    // de uma não mova o alvo da seguinte.
    const edicoes = format(texto, { insertSpaces: true, tabSize: opcoes.tabSize });
    const linhas = texto.split('\n');
    const posicao = (l: number, c: number): number =>
      linhas.slice(0, l).reduce((soma, linha) => soma + linha.length + 1, 0) + c;
    return [...edicoes]
      .sort((a, b) => posicao(b.range.start.line, b.range.start.character)
        - posicao(a.range.start.line, a.range.start.character))
      .reduce(
        (saida, e) =>
          saida.slice(0, posicao(e.range.start.line, e.range.start.character)) +
          e.newText +
          saida.slice(posicao(e.range.end.line, e.range.end.character)),
        texto
      );
  }
  if (linguagem === 'json') {
    // NÃO é o Prettier, e o motivo é o que este botão promete: o Prettier
    // **preserva** um objeto que estava numa linha só, e um JSON minificado
    // voltaria minificado do "Beautify". `parse` + `stringify` sempre expande.
    //
    // Só que ele não aceita comentário — e `tsconfig.json` e
    // `.vscode/settings.json` têm. Então o Prettier fica como a segunda
    // tentativa, que é exatamente o caso em que ele é melhor.
    try {
      return `${JSON.stringify(JSON.parse(texto), null, opcoes.tabSize)}\n`;
    } catch {
      return comPrettier(texto, linguagem, opcoes);
    }
  }
  if (linguagem === 'python') {
    const ferramenta = formatadorDePython();
    if (ferramenta === null) throw new Error('Nem o ruff nem o black estão nesta máquina.');
    return comPython(texto, ferramenta);
  }
  return comPrettier(texto, linguagem, opcoes);
}

async function minify(texto: string, linguagem: string): Promise<string> {
  if (linguagem === 'javascript') {
    const { minify: terser } = await import('terser');
    const r = await terser(texto, {
      // Nomes PRESERVADOS: ele pediu "tudo em uma linha", e não um build. Um
      // arquivo cujas variáveis viraram `a`, `b`, `c` dentro da própria aba
      // seria irrecuperável com um Ctrl+Z de distância.
      mangle: false,
      compress: false,
      format: { comments: false },
    });
    if (typeof r.code !== 'string') throw new Error('O minificador não devolveu nada.');
    return r.code;
  }
  if (linguagem === 'json') {
    // Sem biblioteca: `parse` + `stringify` é exatamente "tudo numa linha", e
    // ainda diz onde está o erro quando o JSON está quebrado.
    return JSON.stringify(JSON.parse(texto));
  }
  if (linguagem === 'css') {
    const CleanCSS = (await import('clean-css')).default;
    const r = new CleanCSS({ level: 0 }).minify(texto);
    if (r.errors.length > 0) throw new Error(r.errors.join('\n'));
    return r.styles;
  }
  if (linguagem === 'html') {
    const { minify: minificarHtml } = await import('html-minifier-terser');
    return minificarHtml(texto, {
      collapseWhitespace: true,
      removeComments: false,
      // O que estiver dentro de <pre> é texto que a pessoa escreveu para ser
      // visto como está.
      conservativeCollapse: false,
    });
  }
  if (linguagem === 'xml') {
    const formatarXml = (await import('xml-formatter')).default;
    return formatarXml(texto, { indentation: '', lineSeparator: '', collapseContent: true });
  }
  if (linguagem === 'sql') return sqlNumaLinha(texto);
  throw new Error(`Minify não implementado para "${linguagem}".`);
}

/** Os dialetos que o `sql-formatter` conhece, a partir dos nossos. */
function dialetoDoSql(dialeto: string | undefined): 'mysql' | 'postgresql' | 'sqlite' | 'tsql' | 'sql' {
  switch (dialeto) {
    case 'mysql': return 'mysql';
    case 'postgres': case 'postgresql': return 'postgresql';
    case 'sqlite': return 'sqlite';
    case 'sqlserver': case 'mssql': return 'tsql';
    default: return 'sql';
  }
}

/**
 * Formata um texto, ou explica por que não dá.
 *
 * O erro de sintaxe da biblioteca sobe COMO VEIO, com linha e coluna: é o que
 * diz onde arrumar. Trocá-lo por "não foi possível formatar" seria esconder a
 * única informação útil.
 */
export async function formatar(
  texto: string,
  linguagem: string,
  modo: ModoDeFormatacao,
  opcoes: OpcoesDeFormatacao = PADRAO
): Promise<string> {
  const capacidade = capacidadeDe(linguagem, { formatadorDePython: formatadorDePython() });
  const veredito = podeFormatar(capacidade, modo);
  if (!veredito.pode) throw new Error(veredito.motivo);
  if (texto.trim() === '') return texto;
  return modo === 'beautify' ? beautify(texto, linguagem, opcoes) : minify(texto, linguagem);
}
