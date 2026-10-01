// O que o editor de uma célula JS/TS sabe das variáveis do notebook (spec 113).
//
// O relato, testando a 0.1.12: *"quando eu passei o patients, ele ficou em
// vermelho, como se não conhecesse a variavel"*. O TypeScript do editor analisa
// UMA célula; o `patients` vinha da célula SQL. Este texto é um `.d.ts` que
// conta a ele o resto: o resultado de cada SQL (tipado pelas colunas do último
// resultado guardado, para `p.` sugerir `name`), o que as outras células JS/TS
// declaram (pelo CÓDIGO delas, em `codigoDasOutrasCelulas`, para o tipo ser
// inferido) e o ambiente do kernel (`require`, `process`, `mostrarImagem`).
//
// O que a célula EM FOCO declara fica de fora: declarado nos dois lugares, o
// TypeScript acusaria "não pode redeclarar".
//
// Puro: a leitura dos nomes é por linha, sem compilador — célula de notebook é
// curta, e um nome a mais ou a menos aqui só muda uma sugestão.
import type { CellValue } from '../contracts';
import type { Notebook, Saida } from './modelo';

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Separa por vírgula no nível de cima (fora de (), [], {} e de textos). */
function partesNoTopo(texto: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let aspa: string | null = null;
  let atual = '';
  for (const c of texto) {
    if (aspa !== null) {
      if (c === aspa) aspa = null;
    } else if (c === '"' || c === "'" || c === '`') aspa = c;
    else if ('([{'.includes(c)) nivel += 1;
    else if (')]}'.includes(c)) nivel -= 1;
    else if (c === ',' && nivel === 0) {
      partes.push(atual);
      atual = '';
      continue;
    }
    atual += c;
  }
  partes.push(atual);
  return partes;
}

/** Os nomes de `{ a, b: c, ...d }` ou `[a, b]`. */
function nomesDoPadrao(padrao: string): string[] {
  const miolo = padrao.trim().slice(1, -1);
  return partesNoTopo(miolo)
    .map((p) => {
      const semPadrao = p.split('=')[0];
      const alvo = semPadrao.includes(':') ? semPadrao.split(':')[1] : semPadrao;
      return alvo.replace('...', '').trim();
    })
    .filter((n) => IDENT.test(n));
}

/** O padrão `{…}` ou `[…]` do começo do texto, com os fechamentos casados. */
function padraoNoComeco(texto: string): string | null {
  const abre = texto[0];
  const fecha = abre === '{' ? '}' : abre === '[' ? ']' : null;
  if (fecha === null) return null;
  let nivel = 0;
  for (let i = 0; i < texto.length; i += 1) {
    if (texto[i] === abre) nivel += 1;
    else if (texto[i] === fecha && (nivel -= 1) === 0) return texto.slice(0, i + 1);
  }
  return null;
}

/** Os nomes que o nível de CIMA de uma célula JS/TS declara. */
export function nomesDeclarados(codigo: string): string[] {
  const nomes: string[] = [];
  for (const linha of codigo.split('\n')) {
    // Linha com recuo está dentro de algo: não é do nível de cima.
    if (/^\s/.test(linha)) continue;
    const decl = /^(?:export\s+)?(?:const|let|var)\s+(.*)$/.exec(linha);
    if (decl !== null) {
      const resto = decl[1].trim();
      const padrao = padraoNoComeco(resto);
      if (padrao !== null) nomes.push(...nomesDoPadrao(padrao));
      else {
        for (const parte of partesNoTopo(resto)) {
          const nome = /^\s*([A-Za-z_$][\w$]*)/.exec(parte)?.[1];
          if (nome !== undefined) nomes.push(nome);
        }
      }
      continue;
    }
    const funcao = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(linha);
    if (funcao !== null) {
      nomes.push(funcao[1]);
      continue;
    }
    const classe = /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(linha);
    if (classe !== null) {
      nomes.push(classe[1]);
      continue;
    }
    const imp = /^import\s+(.+?)\s+from\s/.exec(linha);
    if (imp !== null) {
      for (const parte of partesNoTopo(imp[1])) {
        const p = parte.trim();
        if (p.startsWith('{')) nomes.push(...nomesDoPadrao(p.replace(/\bas\b/g, ':')));
        else if (p.startsWith('*')) nomes.push(...(/as\s+([A-Za-z_$][\w$]*)/.exec(p)?.slice(1) ?? []));
        else if (IDENT.test(p)) nomes.push(p);
      }
    }
  }
  return nomes.filter((n, i) => nomes.indexOf(n) === i);
}

/** O tipo de uma coluna pelo primeiro valor não nulo do resultado guardado. */
function tipoDaColuna(linhas: readonly (readonly CellValue[])[], i: number): string {
  for (const linha of linhas) {
    const v = linha[i];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') return 'number | null';
    if (typeof v === 'string') return 'string | null';
    if (typeof v === 'boolean') return 'boolean | null';
    return 'any';
  }
  return 'any';
}

function tipoDoResultado(saidas: readonly Saida[]): string {
  const tabela = saidas.find((s) => s.tipo === 'tabela');
  if (tabela === undefined || tabela.tipo !== 'tabela') return 'Array<Record<string, any>>';
  const campos = tabela.colunas.map((c, i) => `${JSON.stringify(c)}: ${tipoDaColuna(tabela.linhas, i)}`);
  return `Array<{ ${campos.join('; ')} }>`;
}

const AMBIENTE = [
  'declare var require: any;',
  'declare var module: any;',
  'declare var exports: any;',
  'declare var process: any;',
  'declare var __dirname: string;',
  'declare var __filename: string;',
  'declare function mostrarImagem(dados: any, mime?: string): void;',
];

/** As outras células JS/TS: quais entram como CÓDIGO e o que sobra como `any`. */
function divisao(nb: Notebook, idEmFoco: string | null): {
  readonly incluidas: readonly string[];
  readonly soNomes: readonly string[];
  readonly declaradosNoCodigo: ReadonlySet<string>;
} {
  const emFoco = nb.celulas.find((c) => c.id === idEmFoco);
  const proprios = new Set(emFoco?.tipo === 'codigo' ? nomesDeclarados(emFoco.conteudo) : []);
  const incluidas: string[] = [];
  const soNomes: string[] = [];
  const declarados = new Set<string>();
  for (const c of nb.celulas) {
    const js = c.linguagem === 'javascript' || c.linguagem === 'typescript';
    if (c.tipo !== 'codigo' || c.id === idEmFoco || !js) continue;
    const nomes = nomesDeclarados(c.conteudo);
    // Declarar de novo o que a célula em foco (ou uma anterior) já declara
    // seria "não pode redeclarar": essa célula entra só pelos nomes livres.
    if (nomes.some((n) => proprios.has(n) || declarados.has(n))) {
      soNomes.push(...nomes.filter((n) => !proprios.has(n) && !declarados.has(n)));
      continue;
    }
    incluidas.push(c.conteudo);
    for (const n of nomes) declarados.add(n);
  }
  return { incluidas, soNomes, declaradosNoCodigo: declarados };
}

/**
 * O código das OUTRAS células JS/TS, como um arquivo de script: é dele que o
 * TypeScript infere o tipo de `users = patients.map(...)`. O relato: *"criei
 * um const users do patients e na celula seguida não reconheceu o tipo do u"*.
 *
 * `import` vira declaração (`declare var dayjs: any`) e `export` sai: com
 * qualquer um dos dois o arquivo viraria MÓDULO, e o que ele declara deixaria
 * de ser global para a célula em foco.
 */
export function codigoDasOutrasCelulas(nb: Notebook, idEmFoco: string | null): string {
  const pedacos = divisao(nb, idEmFoco).incluidas.map((codigo) =>
    codigo
      .split('\n')
      .map((linha) => {
        if (/^import\s/.test(linha)) {
          return nomesDeclarados(linha).map((n) => `declare var ${n}: any;`).join(' ');
        }
        return linha.replace(/^export\s+(default\s+)?/, '');
      })
      .join('\n')
  );
  return `${pedacos.join('\n;\n')}\n`;
}

export function declaracoesDoNotebook(nb: Notebook, idEmFoco: string | null): string {
  const emFoco = nb.celulas.find((c) => c.id === idEmFoco);
  const { soNomes, declaradosNoCodigo } = divisao(nb, idEmFoco);
  // O que a célula em foco declara, e o que o código das outras já declara.
  const proprios = new Set([
    ...(emFoco?.tipo === 'codigo' ? nomesDeclarados(emFoco.conteudo) : []),
    ...declaradosNoCodigo,
  ]);
  const linhas = [...AMBIENTE];
  const ja = new Set<string>();
  const declarar = (nome: string, tipo: string): void => {
    if (proprios.has(nome) || ja.has(nome)) return;
    ja.add(nome);
    linhas.push(`declare var ${nome}: ${tipo};`);
  };
  for (const c of nb.celulas) {
    if (c.tipo === 'sql' && c.nome !== null) declarar(c.nome, tipoDoResultado(c.saidas));
  }
  // As células que não entram como código (conflito de nome): só os nomes.
  for (const nome of soNomes) declarar(nome, 'any');
  return `${linhas.join('\n')}\n`;
}
