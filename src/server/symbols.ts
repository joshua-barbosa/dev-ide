import * as path from 'path';
import ts from 'typescript';

export type SymbolKind =
  | 'class'
  | 'function'
  | 'method'
  | 'const'
  | 'variable'
  | 'object'
  | 'interface'
  | 'enum';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number; // 1-based
}

const TS_LIKE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Extrai símbolos (classes, funções, constantes, variáveis, objetos...) de um arquivo. */
export function extractSymbols(filePath: string, content: string): SymbolInfo[] {
  const ext = path.extname(filePath).toLowerCase();
  if (TS_LIKE.has(ext)) return extractTsSymbols(filePath, content);
  if (ext === '.py') return extractPythonSymbols(filePath, content);
  if (ext === '.php') return extractPhpSymbols(filePath, content);
  if (ext === '.c' || ext === '.h') return extractCSymbols(filePath, content);
  if (ext === '.cs') return extractCSharpSymbols(filePath, content);
  return [];
}

function extractTsSymbols(filePath: string, content: string): SymbolInfo[] {
  const source = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const symbols: SymbolInfo[] = [];

  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const push = (name: string, kind: SymbolKind, node: ts.Node) =>
    symbols.push({ name, kind, file: filePath, line: lineOf(node) });

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      push(node.name.text, 'function', node);
    } else if (ts.isClassDeclaration(node) && node.name) {
      push(node.name.text, 'class', node);
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          push(`${node.name.text}.${member.name.text}`, 'method', member);
        }
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      push(node.name.text, 'interface', node);
    } else if (ts.isEnumDeclaration(node)) {
      push(node.name.text, 'enum', node);
    } else if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        push(decl.name.text, classifyVariable(decl, isConst), decl);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return symbols;
}

function classifyVariable(decl: ts.VariableDeclaration, isConst: boolean): SymbolKind {
  const init = decl.initializer;
  if (init) {
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return 'function';
    if (ts.isObjectLiteralExpression(init)) return 'object';
    if (ts.isClassExpression(init)) return 'class';
  }
  return isConst ? 'const' : 'variable';
}

const PY_DEF_RE = /^\s*def\s+([A-Za-z_]\w*)/;
const PY_CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/;
const PY_CONST_RE = /^([A-Z][A-Z0-9_]*)\s*=/;
const PY_VAR_RE = /^([a-z_]\w*)\s*=(?!=)/;

function extractPythonSymbols(filePath: string, content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  content.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    let m: RegExpMatchArray | null;
    if ((m = text.match(PY_DEF_RE))) symbols.push({ name: m[1], kind: 'function', file: filePath, line });
    else if ((m = text.match(PY_CLASS_RE))) symbols.push({ name: m[1], kind: 'class', file: filePath, line });
    else if ((m = text.match(PY_CONST_RE))) symbols.push({ name: m[1], kind: 'const', file: filePath, line });
    else if ((m = text.match(PY_VAR_RE))) symbols.push({ name: m[1], kind: 'variable', file: filePath, line });
  });
  return symbols;
}

// ---- PHP (regex por linha) ----

const PHP_CLASS_RE = /^\s*(?:abstract\s+|final\s+)?class\s+(\w+)/;
const PHP_INTERFACE_RE = /^\s*interface\s+(\w+)/;
const PHP_TRAIT_RE = /^\s*trait\s+(\w+)/;
const PHP_ENUM_RE = /^\s*enum\s+(\w+)/;
const PHP_FUNCTION_RE = /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?(\w+)/;
const PHP_CONST_RE = /^\s*(?:(?:public|private|protected|final)\s+)*const\s+(?:[\w|?\\]+\s+)?([A-Za-z_]\w*)/;
const PHP_DEFINE_RE = /\bdefine\(\s*['"](\w+)['"]/;
const PHP_VAR_RE = /^\s*(\$\w+)\s*=(?!=)/;

function extractPhpSymbols(filePath: string, content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  let insideClass = false;
  let braceDepth = 0;
  content.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    let m: RegExpMatchArray | null;
    if ((m = text.match(PHP_CLASS_RE)) || (m = text.match(PHP_TRAIT_RE))) {
      symbols.push({ name: m[1], kind: 'class', file: filePath, line });
      insideClass = true;
      braceDepth = 0;
    } else if ((m = text.match(PHP_INTERFACE_RE))) {
      symbols.push({ name: m[1], kind: 'interface', file: filePath, line });
      insideClass = true;
      braceDepth = 0;
    } else if ((m = text.match(PHP_ENUM_RE))) {
      symbols.push({ name: m[1], kind: 'enum', file: filePath, line });
      insideClass = true;
      braceDepth = 0;
    } else if ((m = text.match(PHP_FUNCTION_RE))) {
      symbols.push({ name: m[1], kind: insideClass && braceDepth > 0 ? 'method' : 'function', file: filePath, line });
    } else if ((m = text.match(PHP_CONST_RE))) {
      symbols.push({ name: m[1], kind: 'const', file: filePath, line });
    } else if ((m = text.match(PHP_DEFINE_RE))) {
      symbols.push({ name: m[1], kind: 'const', file: filePath, line });
    } else if ((m = text.match(PHP_VAR_RE)) && (!insideClass || braceDepth === 0)) {
      symbols.push({ name: m[1], kind: 'variable', file: filePath, line });
    }
    if (insideClass) {
      braceDepth += (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length;
      if (braceDepth < 0 || (braceDepth === 0 && /\}/.test(text))) insideClass = false;
    }
  });
  return symbols;
}

// ---- C (regex por linha) ----

const C_CONTROL_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'switch', 'return', 'sizeof', 'do', 'case']);
const C_DEFINE_RE = /^\s*#\s*define\s+(\w+)/;
const C_STRUCT_RE = /^\s*(?:typedef\s+)?struct\s+(\w+)/;
const C_ENUM_RE = /^\s*(?:typedef\s+)?enum\s+(\w+)/;
// Assinatura de definição: "tipo nome(" no início da linha, sem terminar em ";" (protótipo)
const C_FUNCTION_RE = /^[A-Za-z_][\w\s*]*?[\s*]([A-Za-z_]\w*)\s*\(/;
const C_PROTOTYPE_RE = /;\s*$/;
const C_GLOBAL_RE = /^(static\s+|const\s+)*(?:unsigned\s+|signed\s+)?(?:int|long|short|char|float|double|size_t|bool|uint\d+_t|int\d+_t)\s+\**([A-Za-z_]\w*)\s*(?:=|;|\[)/;

function extractCSymbols(filePath: string, content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  content.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    let m: RegExpMatchArray | null;
    if ((m = text.match(C_DEFINE_RE))) {
      symbols.push({ name: m[1], kind: 'const', file: filePath, line });
    } else if ((m = text.match(C_STRUCT_RE))) {
      symbols.push({ name: m[1], kind: 'class', file: filePath, line });
    } else if ((m = text.match(C_ENUM_RE))) {
      symbols.push({ name: m[1], kind: 'enum', file: filePath, line });
    } else if (
      (m = text.match(C_FUNCTION_RE)) &&
      !C_CONTROL_KEYWORDS.has(m[1]) &&
      !C_PROTOTYPE_RE.test(text)
    ) {
      symbols.push({ name: m[1], kind: 'function', file: filePath, line });
    } else if ((m = text.match(C_GLOBAL_RE))) {
      symbols.push({ name: m[2], kind: /\bconst\b/.test(text) ? 'const' : 'variable', file: filePath, line });
    }
  });
  return symbols;
}

// ---- C# (regex por linha) ----

const CS_CONTROL_KEYWORDS = new Set([
  'if', 'else', 'for', 'foreach', 'while', 'switch', 'return', 'using', 'catch', 'new',
  'lock', 'checked', 'unchecked', 'try', 'do', 'base', 'this', 'nameof', 'typeof',
]);
const CS_CLASS_RE = /^\s*(?:\[[^\]]*\]\s*)?(?:(?:public|private|protected|internal|static|sealed|abstract|partial)\s+)*class\s+(\w+)/;
const CS_INTERFACE_RE = /^\s*(?:(?:public|private|protected|internal|partial)\s+)*interface\s+(\w+)/;
const CS_ENUM_RE = /^\s*(?:(?:public|private|protected|internal)\s+)*enum\s+(\w+)/;
const CS_STRUCT_RE = /^\s*(?:(?:public|private|protected|internal|readonly|ref)\s+)*struct\s+(\w+)/;
const CS_CONST_RE = /\b(?:const|static\s+readonly)\s+[\w<>\[\],?]+\s+(\w+)\s*=/;
const CS_METHOD_RE = /^\s*(?:(?:public|private|protected|internal|static|virtual|override|async|sealed|new|extern|partial)\s+)+[\w<>\[\],?\s]+?\s(\w+)\s*\([^;]*\)?\s*\{?\s*$/;
const CS_LOCAL_FN_RE = /^\s*(?:async\s+)?(?:void|int|string|double|float|bool|decimal|long|var|Task[\w<>]*)\s+(\w+)\s*\([^;]*\)\s*\{?\s*$/;
const CS_VAR_RE = /^\s*(?:var|int|string|double|float|bool|decimal|long)\s+(\w+)\s*=/;

function extractCSharpSymbols(filePath: string, content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  content.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    let m: RegExpMatchArray | null;
    if ((m = text.match(CS_CLASS_RE))) {
      symbols.push({ name: m[1], kind: 'class', file: filePath, line });
    } else if ((m = text.match(CS_INTERFACE_RE))) {
      symbols.push({ name: m[1], kind: 'interface', file: filePath, line });
    } else if ((m = text.match(CS_ENUM_RE))) {
      symbols.push({ name: m[1], kind: 'enum', file: filePath, line });
    } else if ((m = text.match(CS_STRUCT_RE))) {
      symbols.push({ name: m[1], kind: 'class', file: filePath, line });
    } else if ((m = text.match(CS_CONST_RE))) {
      symbols.push({ name: m[1], kind: 'const', file: filePath, line });
    } else if (
      ((m = text.match(CS_METHOD_RE)) || (m = text.match(CS_LOCAL_FN_RE))) &&
      !CS_CONTROL_KEYWORDS.has(m[1])
    ) {
      symbols.push({ name: m[1], kind: 'method', file: filePath, line });
    } else if ((m = text.match(CS_VAR_RE))) {
      symbols.push({ name: m[1], kind: 'variable', file: filePath, line });
    }
  });
  return symbols;
}
