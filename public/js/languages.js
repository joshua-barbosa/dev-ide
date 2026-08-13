// Definições de linguagem para o highlighter.
// Cada linguagem tem regras léxicas (regex com flag sticky "y") e listas de
// palavras usadas para classificar identificadores (keyword, builtin).
(function () {
  'use strict';

  const JS_KEYWORDS = [
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function',
    'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'static', 'super',
    'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
    'get', 'set', 'true', 'false', 'null', 'undefined',
  ];

  const TS_KEYWORDS = JS_KEYWORDS.concat([
    'abstract', 'any', 'as', 'boolean', 'declare', 'enum', 'implements', 'interface',
    'is', 'keyof', 'namespace', 'never', 'number', 'object', 'private', 'protected',
    'public', 'readonly', 'string', 'symbol', 'type', 'unknown', 'satisfies', 'override',
  ]);

  const JS_BUILTINS = [
    'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise',
    'Map', 'Set', 'Date', 'RegExp', 'Error', 'Symbol', 'require', 'module', 'exports',
    'process', 'window', 'document', 'globalThis', 'setTimeout', 'setInterval', 'fetch',
    'parseInt', 'parseFloat', 'isNaN', 'structuredClone',
  ];

  const PY_KEYWORDS = [
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
    'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
    'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
    'with', 'yield', 'True', 'False', 'None', 'match', 'case', 'self',
  ];

  const PY_BUILTINS = [
    'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple',
    'open', 'type', 'isinstance', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'sum',
    'min', 'max', 'abs', 'round', 'input', 'super', '__init__',
  ];

  const PHP_KEYWORDS = [
    'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone',
    'const', 'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty',
    'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'enum', 'extends',
    'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if', 'implements',
    'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset', 'list', 'match',
    'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require',
    'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var',
    'while', 'xor', 'yield', 'true', 'false', 'null', 'int', 'float', 'string', 'bool', 'void',
    'mixed', 'never', 'object', 'self', 'parent',
  ];

  const PHP_BUILTINS = [
    'strlen', 'count', 'implode', 'explode', 'array_map', 'array_filter', 'array_merge',
    'array_keys', 'array_values', 'in_array', 'str_replace', 'sprintf', 'printf', 'var_dump',
    'var_export', 'json_encode', 'json_decode', 'file_get_contents', 'file_put_contents',
    'preg_match', 'preg_replace', 'is_array', 'is_string', 'is_int', 'intval', 'floatval',
    'strval', 'trim', 'strtolower', 'strtoupper', 'substr', 'strpos', 'define', 'die', 'exit',
  ];

  const C_KEYWORDS = [
    'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else',
    'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register',
    'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef',
    'union', 'unsigned', 'void', 'volatile', 'while', 'bool', 'true', 'false', 'NULL',
    'size_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t',
    'int64_t', 'ssize_t', 'FILE',
  ];

  const C_BUILTINS = [
    'printf', 'fprintf', 'sprintf', 'snprintf', 'scanf', 'puts', 'putchar', 'getchar', 'fgets',
    'malloc', 'calloc', 'realloc', 'free', 'memcpy', 'memset', 'strcpy', 'strncpy', 'strcat',
    'strcmp', 'strncmp', 'strlen', 'fopen', 'fclose', 'fread', 'fwrite', 'exit', 'abs', 'sqrt',
    'pow', 'floor', 'ceil', 'rand', 'srand', 'atoi', 'atof', 'assert', 'main',
  ];

  const CSHARP_KEYWORDS = [
    'abstract', 'as', 'async', 'await', 'base', 'bool', 'break', 'byte', 'case', 'catch',
    'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do',
    'double', 'dynamic', 'else', 'enum', 'event', 'explicit', 'extern', 'finally', 'fixed',
    'float', 'for', 'foreach', 'get', 'goto', 'if', 'implicit', 'in', 'init', 'int',
    'interface', 'internal', 'is', 'lock', 'long', 'nameof', 'namespace', 'new', 'object',
    'operator', 'out', 'override', 'params', 'partial', 'private', 'protected', 'public',
    'readonly', 'record', 'ref', 'required', 'return', 'sbyte', 'sealed', 'set', 'short',
    'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'try',
    'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'var', 'virtual',
    'void', 'volatile', 'when', 'where', 'while', 'with', 'yield', 'true', 'false', 'null',
  ];

  const CSHARP_BUILTINS = [
    'Console', 'Math', 'String', 'Int32', 'Int64', 'Double', 'Boolean', 'DateTime', 'TimeSpan',
    'List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'Array', 'Task', 'Func', 'Action',
    'Exception', 'ArgumentException', 'Convert', 'Guid', 'Environment', 'File', 'Directory',
    'Path', 'StringBuilder', 'Enumerable', 'IEnumerable', 'Nullable', 'Tuple', 'Span',
  ];

  // Regras comuns de linguagens C-like (JS/TS)
  const C_LIKE_RULES = [
    { type: 'com', regex: /\/\/[^\n]*/y },
    { type: 'com', regex: /\/\*[\s\S]*?(?:\*\/|$)/y },
    { type: 'str', regex: /`(?:\\[\s\S]|[^\\`])*(?:`|$)/y },
    { type: 'str', regex: /"(?:\\.|[^\\"\n])*(?:"|$)/y },
    { type: 'str', regex: /'(?:\\.|[^\\'\n])*(?:'|$)/y },
    { type: 'num', regex: /\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?\b/y },
    { type: 'ident', regex: /[A-Za-z_$][\w$]*/y },
    { type: 'op', regex: /=>|[+\-*/%=!<>&|^~?:]+/y },
    { type: 'punct', regex: /[{}()[\];,.]/y },
    { type: 'ws', regex: /[\s]+/y },
    { type: 'text', regex: /[\s\S]/y },
  ];

  const SQL_KEYWORDS = [
    'add', 'all', 'alter', 'analyze', 'and', 'as', 'asc', 'begin', 'between', 'by', 'cascade',
    'case', 'cast', 'check', 'collate', 'column', 'commit', 'constraint', 'create', 'cross',
    'database', 'default', 'delete', 'desc', 'describe', 'distinct', 'drop', 'else', 'end',
    'except', 'exists', 'explain', 'foreign', 'from', 'full', 'function', 'grant', 'group',
    'having', 'if', 'ignore', 'in', 'index', 'inner', 'insert', 'intersect', 'into', 'is',
    'join', 'key', 'left', 'like', 'limit', 'not', 'null', 'offset', 'on', 'or', 'order',
    'outer', 'primary', 'procedure', 'references', 'rename', 'replace', 'return', 'revoke',
    'right', 'rollback', 'schema', 'select', 'set', 'show', 'table', 'then', 'to',
    'transaction', 'triggers', 'truncate', 'union', 'unique', 'update', 'using', 'values',
    'view', 'when', 'where', 'with', 'true', 'false',
  ];

  const SQL_BUILTINS = [
    'avg', 'coalesce', 'concat', 'count', 'current_date', 'current_timestamp', 'date',
    'date_format', 'datediff', 'extract', 'greatest', 'group_concat', 'ifnull', 'json_extract',
    'least', 'length', 'lower', 'max', 'min', 'now', 'nullif', 'round', 'row_number',
    'substring', 'sum', 'trim', 'upper',
    // tipos
    'bigint', 'binary', 'blob', 'boolean', 'char', 'decimal', 'double', 'float', 'int',
    'integer', 'json', 'numeric', 'serial', 'text', 'timestamp', 'uuid', 'varchar',
  ];

  window.LANGUAGES = {
    javascript: {
      rules: C_LIKE_RULES,
      keywords: new Set(JS_KEYWORDS),
      builtins: new Set(JS_BUILTINS),
      classify: 'c-like',
    },
    typescript: {
      rules: C_LIKE_RULES,
      keywords: new Set(TS_KEYWORDS),
      builtins: new Set(JS_BUILTINS),
      classify: 'c-like',
    },
    python: {
      rules: [
        { type: 'com', regex: /#[^\n]*/y },
        { type: 'str', regex: /(?:[rbfu]{0,2})?"""[\s\S]*?(?:"""|$)|(?:[rbfu]{0,2})?'''[\s\S]*?(?:'''|$)/y },
        { type: 'str', regex: /(?:[rbfu]{0,2})?"(?:\\.|[^\\"\n])*(?:"|$)|(?:[rbfu]{0,2})?'(?:\\.|[^\\'\n])*(?:'|$)/y },
        { type: 'num', regex: /\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?[jJ]?\b/y },
        { type: 'ident', regex: /[A-Za-z_]\w*/y },
        { type: 'op', regex: /[+\-*/%=!<>&|^~@]+|:=/y },
        { type: 'punct', regex: /[{}()[\];,.:]/y },
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /[\s\S]/y },
      ],
      keywords: new Set(PY_KEYWORDS),
      builtins: new Set(PY_BUILTINS),
      classify: 'python',
    },
    php: {
      rules: [
        { type: 'com', regex: /\/\/[^\n]*|#[^\n]*/y },
        { type: 'com', regex: /\/\*[\s\S]*?(?:\*\/|$)/y },
        { type: 'str', regex: /<<<'?(\w+)'?[\s\S]*?\n\s*\1;?/y },
        { type: 'str', regex: /"(?:\\.|[^\\"\n])*(?:"|$)/y },
        { type: 'str', regex: /'(?:\\.|[^\\'\n])*(?:'|$)/y },
        { type: 'kw', regex: /<\?php\b|<\?=|\?>/y },
        { type: 'var', regex: /\$[A-Za-z_]\w*/y },
        { type: 'num', regex: /\b0[xXbBoO][\da-fA-F_]+\b|\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?\b/y },
        { type: 'ident', regex: /[A-Za-z_]\w*/y },
        { type: 'op', regex: /=>|->|\?\?|::|[+\-*\/%=!<>&|^~?:.@]+/y },
        { type: 'punct', regex: /[{}()[\];,]/y },
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /[\s\S]/y },
      ],
      keywords: new Set(PHP_KEYWORDS),
      builtins: new Set(PHP_BUILTINS),
      classify: 'c-like',
    },
    c: {
      rules: [
        { type: 'com', regex: /\/\/[^\n]*/y },
        { type: 'com', regex: /\/\*[\s\S]*?(?:\*\/|$)/y },
        { type: 'prop', regex: /#\s*\w+/y },
        { type: 'str', regex: /<[a-zA-Z_][\w./]*\.h>/y },
        { type: 'str', regex: /"(?:\\.|[^\\"\n])*(?:"|$)/y },
        { type: 'str', regex: /'(?:\\.|[^\\'\n])*(?:'|$)/y },
        { type: 'num', regex: /\b0[xXbB][\da-fA-F]+[uUlL]*\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFuUlL]*\b/y },
        { type: 'ident', regex: /[A-Za-z_]\w*/y },
        { type: 'op', regex: /->|[+\-*\/%=!<>&|^~?:.]+/y },
        { type: 'punct', regex: /[{}()[\];,]/y },
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /[\s\S]/y },
      ],
      keywords: new Set(C_KEYWORDS),
      builtins: new Set(C_BUILTINS),
      classify: 'c-like',
    },
    csharp: {
      rules: [
        { type: 'com', regex: /\/\/[^\n]*/y },
        { type: 'com', regex: /\/\*[\s\S]*?(?:\*\/|$)/y },
        { type: 'str', regex: /\$?@"(?:""|[^"])*(?:"|$)|@?\$"(?:\\.|\{[^}]*\}|[^\\"\n])*(?:"|$)/y },
        { type: 'str', regex: /"(?:\\.|[^\\"\n])*(?:"|$)/y },
        { type: 'str', regex: /'(?:\\.|[^\\'\n])*(?:'|$)/y },
        { type: 'num', regex: /\b0[xXbB][\da-fA-F_]+\b|\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?[fFdDmMuUlL]*\b/y },
        { type: 'prop', regex: /\[[A-Za-z_][\w.]*(?:\([^)]*\))?\]/y },
        { type: 'ident', regex: /[A-Za-z_]\w*/y },
        { type: 'op', regex: /=>|\?\?|\?\./y },
        { type: 'op', regex: /[+\-*\/%=!<>&|^~?:.]+/y },
        { type: 'punct', regex: /[{}()[\];,]/y },
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /[\s\S]/y },
      ],
      keywords: new Set(CSHARP_KEYWORDS),
      builtins: new Set(CSHARP_BUILTINS),
      classify: 'c-like',
    },
    sql: {
      rules: [
        { type: 'com', regex: /--[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y },
        // Identificador citado (`tabela`, "coluna", [coluna]) antes de string,
        // senão a crase viraria texto solto.
        { type: 'ident', regex: /`(?:[^`]|``)*`|\[[^\]\n]*\]/y },
        { type: 'str', regex: /'(?:''|\\.|[^'\\\n])*(?:'|$)|"(?:""|\\.|[^"\\\n])*(?:"|$)/y },
        { type: 'num', regex: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
        { type: 'ident', regex: /[A-Za-z_@#][\w$]*/y },
        { type: 'op', regex: /<=>|<>|!=|>=|<=|\|\||[+\-*/%=<>!&|^~]/y },
        { type: 'punct', regex: /[(),;.]/y },
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /[\s\S]/y },
      ],
      keywords: new Set(SQL_KEYWORDS),
      builtins: new Set(SQL_BUILTINS),
      // SQL não diferencia caixa: SELECT e select são a mesma palavra-chave.
      classify: 'sql',
    },
    json: {
      rules: [
        { type: 'prop', regex: /"(?:\\.|[^\\"])*"(?=\s*:)/y },
        { type: 'str', regex: /"(?:\\.|[^\\"])*(?:"|$)/y },
        { type: 'num', regex: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
        { type: 'kw', regex: /\b(?:true|false|null)\b/y },
        { type: 'punct', regex: /[{}[\]:,]/y },
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /[\s\S]/y },
      ],
      keywords: new Set(),
      builtins: new Set(),
      classify: 'none',
    },
    html: {
      rules: [
        { type: 'com', regex: /<!--[\s\S]*?(?:-->|$)/y },
        { type: 'kw', regex: /<\/?[A-Za-z][\w-]*|\/?>|<!DOCTYPE[^>]*>/y },
        { type: 'str', regex: /"[^"]*(?:"|$)|'[^']*(?:'|$)/y },
        { type: 'prop', regex: /[A-Za-z-]+(?==)/y },
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /[\s\S]/y },
      ],
      keywords: new Set(),
      builtins: new Set(),
      classify: 'none',
    },
    css: {
      rules: [
        { type: 'com', regex: /\/\*[\s\S]*?(?:\*\/|$)/y },
        { type: 'str', regex: /"[^"]*(?:"|$)|'[^']*(?:'|$)/y },
        { type: 'prop', regex: /[a-zA-Z-]+(?=\s*:)/y },
        { type: 'fn', regex: /[a-zA-Z-]+(?=\()/y },
        { type: 'num', regex: /#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/y },
        { type: 'kw', regex: /[.#]?[A-Za-z_-][\w-]*|@[a-z-]+/y },
        { type: 'punct', regex: /[{}();:,>~+*]/y },
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /[\s\S]/y },
      ],
      keywords: new Set(),
      builtins: new Set(),
      classify: 'none',
    },
    plain: {
      rules: [
        { type: 'ws', regex: /\s+/y },
        { type: 'text', regex: /\S+/y },
      ],
      keywords: new Set(),
      builtins: new Set(),
      classify: 'none',
    },
  };

  // Mapeia extensão de arquivo -> linguagem padrão
  window.EXT_TO_LANG = {
    '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python',
    '.php': 'php',
    '.c': 'c', '.h': 'c',
    '.cs': 'csharp',
    '.json': 'json',
    '.html': 'html', '.htm': 'html',
    '.css': 'css',
    '.sql': 'sql',
  };
})();
