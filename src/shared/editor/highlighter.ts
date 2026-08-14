// Highlighter próprio: tokeniza o código com as regras da linguagem escolhida
// e classifica identificadores em classes, funções, constantes e variáveis.
import { LANGUAGES, type LanguageDef } from './languages';

interface Token {
  type: string;
  text: string;
}

function tokenize(code: string, lang: string): Token[] {
  const def = LANGUAGES[lang] ?? LANGUAGES.plain;
  const tokens: Token[] = [];
  let pos = 0;
  outer: while (pos < code.length) {
    for (const rule of def.rules) {
      rule.regex.lastIndex = pos;
      const m = rule.regex.exec(code);
      if (m && m.index === pos && m[0].length > 0) {
        tokens.push({ type: rule.type, text: m[0] });
        pos += m[0].length;
        continue outer;
      }
    }
    tokens.push({ type: 'text', text: code[pos] });
    pos += 1;
  }
  classifyIdentifiers(tokens, def);
  return tokens;
}

// Reclassifica tokens 'ident' com heurísticas:
//  - keyword/builtin pelas listas da linguagem
//  - após class/new/extends/interface/enum/implements -> classe
//  - após const -> constante; após let/var -> variável
//  - seguido de "(" -> função; UPPER_CASE -> constante; PascalCase -> classe
// SQL não diferencia caixa: SELECT, Select e select são a mesma palavra.
// As listas da linguagem ficam em minúsculas e a busca cai para lowercase.
function contem(set: ReadonlySet<string>, word: string, def: LanguageDef): boolean {
  return set.has(word) || (def.classify === 'sql' && set.has(word.toLowerCase()));
}

function classifyIdentifiers(tokens: Token[], def: LanguageDef): void {
  let declContext: string | null = null; // 'class' | 'const' | 'variable' | 'function' | null

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'ident') {
      if (tok.type !== 'ws') {
        const t = tok.text;
        if (t === ',' && (declContext === 'const' || declContext === 'variable')) {
          // mantém contexto: const a = 1, b = 2
        } else if (tok.type === 'punct' || tok.type === 'op') {
          if (t === ';' || t === '{' || t === '}' || t === ')') declContext = null;
        }
      }
      continue;
    }

    const word = tok.text;
    if (contem(def.keywords, word, def)) {
      tok.type = 'kw';
      if (['class', 'new', 'extends', 'implements', 'interface', 'enum'].includes(word)) {
        declContext = 'class';
      } else if (word === 'const') {
        declContext = 'const';
      } else if (word === 'let' || word === 'var' || word === 'nonlocal' || word === 'global') {
        declContext = 'variable';
      } else if (word === 'function' || word === 'def') {
        declContext = 'function';
      } else {
        declContext = null;
      }
      continue;
    }
    if (contem(def.builtins, word, def)) {
      tok.type = 'builtin';
      declContext = null;
      continue;
    }

    const next = nextMeaningful(tokens, i);
    if (declContext === 'class') {
      tok.type = 'cls';
    } else if (declContext === 'function') {
      tok.type = 'fn';
    } else if (declContext === 'const') {
      tok.type = 'const';
    } else if (declContext === 'variable') {
      tok.type = 'var';
    } else if (next && next.text.startsWith('(')) {
      tok.type = 'fn';
    } else if (/^[A-Z][A-Z0-9_]*$/.test(word) && word.length > 1) {
      tok.type = 'const';
    } else if (/^[A-Z]/.test(word)) {
      tok.type = 'cls';
    } else if (next && next.text.startsWith(':') && def.classify === 'c-like') {
      tok.type = 'prop';
    } else {
      tok.type = 'var';
    }
    declContext = null;
  }
}

function nextMeaningful(tokens: Token[], i: number): Token | null {
  for (let j = i + 1; j < tokens.length; j++) {
    if (tokens[j].type !== 'ws') return tokens[j];
  }
  return null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const CSS_CLASS: Record<string, string | undefined> = {
  kw: 'tok-kw', str: 'tok-str', num: 'tok-num', com: 'tok-com', fn: 'tok-fn',
  cls: 'tok-cls', const: 'tok-const', var: 'tok-var', builtin: 'tok-builtin',
  op: 'tok-op', prop: 'tok-prop',
};

function highlight(code: string, lang: string): string {
  const parts: string[] = [];
  for (const tok of tokenize(code, lang)) {
    const cls = CSS_CLASS[tok.type];
    const safe = escapeHtml(tok.text);
    parts.push(cls ? `<span class="${cls}">${safe}</span>` : safe);
  }
  return parts.join('');
}

export const Highlighter = { tokenize, highlight };
