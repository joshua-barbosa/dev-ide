// Uma célula JS/TS preparada para o kernel (spec 112, etapa 3).
//
// No Node, `const df = …` rodado duas vezes é "Identifier 'df' has already been
// declared" — e rodar a mesma célula de novo é o gesto mais comum de um
// notebook. A saída: cada célula roda dentro da PRÓPRIA função assíncrona (o
// que ainda libera `await` no topo), e cada nome que ela declara é PUBLICADO em
// `globalThis`, onde as células seguintes o encontram como variável livre.
//
// Publicado duas vezes: logo depois da declaração (se a célula quebrar no meio,
// o que já foi feito fica, como no Jupyter) e no FIM (se a célula mudar o valor
// depois de declarar, a próxima vê o valor final).
//
// Roda no MOTOR, que já tem o TypeScript: o kernel recebe JavaScript pronto.
import ts from 'typescript';

type Linguagem = 'javascript' | 'typescript';

/** Os nomes que uma declaração cria — inclusive de dentro de desestruturação. */
function nomesDe(nome: ts.BindingName): string[] {
  if (ts.isIdentifier(nome)) return [nome.text];
  return nome.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : nomesDe(e.name)));
}

/** Os nomes declarados por um comando do topo da célula. */
function nomesDoComando(c: ts.Statement): string[] {
  if (ts.isVariableStatement(c)) return c.declarationList.declarations.flatMap((d) => nomesDe(d.name));
  if ((ts.isFunctionDeclaration(c) || ts.isClassDeclaration(c)) && c.name !== undefined) return [c.name.text];
  return [];
}

/**
 * Um `import` vira declaração COMUM, antes do TypeScript.
 *
 * Deixado para o compilador, ele some (import cujo nome a célula não usa é
 * apagado — e numa célula o uso é na PRÓXIMA) ou vira `path_1`, com o nome
 * `join` reescrito só dentro desta célula. Como declaração, ele é publicado
 * igual a qualquer `const`.
 */
function importComoRequire(i: ts.ImportDeclaration, fonte: ts.SourceFile): string {
  const modulo = i.moduleSpecifier.getText(fonte);
  const clausula = i.importClause;
  if (clausula === undefined) return `require(${modulo});`;
  if (clausula.isTypeOnly) return '';
  const partes: string[] = [];
  if (clausula.name !== undefined) {
    // O padrão do `esModuleInterop`: `default` de módulo ES, o módulo inteiro de CommonJS.
    partes.push(
      `const ${clausula.name.text} = ((m) => (m && m.__esModule ? m.default : m))(require(${modulo}));`
    );
  }
  const ligacoes = clausula.namedBindings;
  if (ligacoes !== undefined && ts.isNamespaceImport(ligacoes)) {
    partes.push(`const ${ligacoes.name.text} = require(${modulo});`);
  } else if (ligacoes !== undefined) {
    const nomes = ligacoes.elements
      .filter((e) => !e.isTypeOnly)
      .map((e) => (e.propertyName === undefined ? e.name.text : `${e.propertyName.getText(fonte)}: ${e.name.text}`));
    if (nomes.length > 0) partes.push(`const { ${nomes.join(', ')} } = require(${modulo});`);
  }
  return partes.join(' ');
}

function semImports(codigo: string, fonte: ts.SourceFile): string {
  let saida = '';
  let desde = 0;
  for (const c of fonte.statements) {
    if (!ts.isImportDeclaration(c)) continue;
    saida += codigo.slice(desde, c.getStart(fonte)) + importComoRequire(c, fonte);
    desde = c.getEnd();
  }
  return saida + codigo.slice(desde);
}

/** Publica em `globalThis`, sem quebrar se o nome ainda não existe (TDZ). */
const publicar = (nomes: readonly string[]): string =>
  nomes
    .filter((n) => !n.startsWith('__')) // os ajudantes do TypeScript não são do usuário
    .map((n) => `try { globalThis[${JSON.stringify(n)}] = ${n}; } catch {}`)
    .join('\n');

export function prepararCelulaJs(codigo: string, linguagem: Linguagem): string {
  // A célula ORIGINAL decide se há "última expressão": o JavaScript transpilado
  // ganha prólogo e ajudantes, e o último comando dele nem sempre é do usuário.
  const original = ts.createSourceFile(
    linguagem === 'typescript' ? 'celula.ts' : 'celula.js',
    codigo, ts.ScriptTarget.ES2022, true,
    linguagem === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );
  const ultimoOriginal = original.statements[original.statements.length - 1];
  const temValor = ultimoOriginal !== undefined && ts.isExpressionStatement(ultimoOriginal);

  // `import` vira `require`, os tipos somem. Sem diagnóstico: erro de sintaxe
  // aparece como SyntaxError de verdade quando o kernel compilar.
  const js = ts.transpileModule(semImports(codigo, original), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;

  const arvore = ts.createSourceFile('celula.js', js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const comandos = [...arvore.statements];
  const ultimo = temValor ? comandos[comandos.length - 1] : undefined;
  const todos: string[] = [];
  const partes: string[] = [];

  for (const c of comandos) {
    if (c === ultimo && ultimo !== undefined && ts.isExpressionStatement(ultimo)) continue;
    partes.push(c.getFullText(arvore));
    const nomes = nomesDoComando(c);
    todos.push(...nomes);
    if (nomes.length > 0) partes.push(publicar(nomes));
  }

  const valor = ultimo !== undefined && ts.isExpressionStatement(ultimo)
    ? `const __valorDaCelula = (${ultimo.expression.getText(arvore)});`
    : 'const __valorDaCelula = undefined;';

  return [
    '(async (exports) => {',
    ...partes,
    valor,
    publicar(todos),
    'return __valorDaCelula;',
    '})({})',
  ].join('\n');
}
