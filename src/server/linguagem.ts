// Ir para a definição e achar as referências, em TypeScript e JavaScript.
//
// **Por que só estas duas linguagens.** Responder "onde isto foi definido"
// exige entender a linguagem, não procurar texto: `usuario.nome` e o `nome` de
// outra classe são a mesma palavra e coisas diferentes. Para TS e JS a IDE já
// tem o compilador como dependência (é o que extrai os símbolos desde a spec
// 001); para Python, PHP e C# seria um servidor LSP por linguagem, que é outra
// ordem de grandeza e entra por decisão sua, não por impulso.
//
// **O que este arquivo NÃO faz:** diagnósticos, completar código e renomear.
// O `ts.LanguageService` entrega os três, e cada um traz interface própria.
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { varrerArquivos } from './pastas';

/** Um lugar no código: onde algo foi definido, ou onde é usado. */
export interface Alvo {
  readonly caminho: string;
  /** 1-based, como tudo que o usuário vê. */
  readonly linha: number;
  readonly coluna: number;
  /** A linha inteira, para a lista de escolha mostrar o contexto. */
  readonly previa: string;
}

const EXTENSOES: ReadonlySet<string> = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Teto de arquivos no programa.
 *
 * O serviço carrega e analisa cada um: numa pasta enorme isso é segundos de CPU
 * e centenas de megabytes. Mesma lição dos tetos da busca (spec 027) — o limite
 * existe para a IDE não congelar sem explicação.
 */
export const MAX_ARQUIVOS = 1_500;

/** Por quanto tempo a lista de arquivos é reaproveitada, em ms. */
const VALIDADE_DA_LISTA = 5_000;

interface Servico {
  readonly service: ts.LanguageService;
  /** Conteúdo que ainda não está em disco, por caminho. */
  readonly memoria: Map<string, string>;
  arquivos: string[];
  lidaEm: number;
}

const porPasta = new Map<string, Servico>();

function listarArquivos(pasta: string): string[] {
  return varrerArquivos(pasta, { extensoes: EXTENSOES, max: MAX_ARQUIVOS }).arquivos;
}

/**
 * O serviço da pasta, criado uma vez e reaproveitado.
 *
 * Recriar a cada pergunta reanalisaria o projeto inteiro por tecla — o
 * `LanguageService` foi feito para viver, e a versão de cada arquivo é o que
 * diz a ele o que mudou.
 */
function servicoDe(pasta: string): Servico {
  const existente = porPasta.get(pasta);
  if (existente !== undefined) {
    if (Date.now() - existente.lidaEm > VALIDADE_DA_LISTA) {
      existente.arquivos = listarArquivos(pasta);
      existente.lidaEm = Date.now();
    }
    return existente;
  }

  const memoria = new Map<string, string>();
  const estado: Servico = {
    service: undefined as unknown as ts.LanguageService,
    memoria,
    arquivos: listarArquivos(pasta),
    lidaEm: Date.now(),
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => estado.arquivos,
    getScriptVersion: (arquivo) => {
      const emMemoria = memoria.get(arquivo);
      // O conteúdo não salvo muda a cada tecla; o tamanho basta para o serviço
      // saber que precisa reanalisar, e é bem mais barato que um hash.
      if (emMemoria !== undefined) return `mem:${emMemoria.length}`;
      try {
        return String(fs.statSync(arquivo).mtimeMs);
      } catch {
        return '0';
      }
    },
    getScriptSnapshot: (arquivo) => {
      const emMemoria = memoria.get(arquivo);
      if (emMemoria !== undefined) return ts.ScriptSnapshot.fromString(emMemoria);
      try {
        return ts.ScriptSnapshot.fromString(fs.readFileSync(arquivo, 'utf8'));
      } catch {
        return undefined;
      }
    },
    getCurrentDirectory: () => pasta,
    getCompilationSettings: () => ({
      allowJs: true,
      // `checkJs` fica FORA: aqui não se dão diagnósticos, e ligá-lo só faria o
      // serviço trabalhar mais para responder a mesma pergunta.
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      allowNonTsExtensions: true,
      esModuleInterop: true,
    }),
    getDefaultLibFileName: (opcoes) => ts.getDefaultLibFilePath(opcoes),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  (estado as { service: ts.LanguageService }).service = ts.createLanguageService(
    host,
    ts.createDocumentRegistry()
  );
  porPasta.set(pasta, estado);
  return estado;
}

/** Descarta o serviço de uma pasta. Usado ao fechar ou trocar de pasta. */
export function esquecerPasta(pasta: string): void {
  porPasta.get(pasta)?.service.dispose();
  porPasta.delete(pasta);
}

export function ehSuportado(caminho: string): boolean {
  return EXTENSOES.has(path.extname(caminho).toLowerCase());
}

/** Posição 1-based do usuário para o deslocamento em caracteres que o TS usa. */
function deslocamento(texto: string, linha: number, coluna: number): number {
  const linhas = texto.split('\n');
  let total = 0;
  for (let i = 0; i < Math.min(linha - 1, linhas.length); i += 1) {
    total += (linhas[i]?.length ?? 0) + 1;
  }
  return total + Math.max(0, coluna - 1);
}

function textoDe(estado: Servico, caminho: string): string | null {
  const emMemoria = estado.memoria.get(caminho);
  if (emMemoria !== undefined) return emMemoria;
  try {
    return fs.readFileSync(caminho, 'utf8');
  } catch {
    return null;
  }
}

function paraAlvo(estado: Servico, caminho: string, inicio: number): Alvo | null {
  const texto = textoDe(estado, caminho);
  if (texto === null) return null;
  const antes = texto.slice(0, inicio);
  const linha = antes.split('\n').length;
  const inicioDaLinha = antes.lastIndexOf('\n') + 1;
  const linhas = texto.split('\n');
  return {
    caminho,
    linha,
    coluna: inicio - inicioDaLinha + 1,
    previa: (linhas[linha - 1] ?? '').trim().slice(0, 160),
  };
}

export interface Pergunta {
  readonly pasta: string;
  readonly caminho: string;
  readonly linha: number;
  readonly coluna: number;
  /** O que está na tela, quando difere do disco. */
  readonly conteudo?: string;
}

/** Prepara o serviço e devolve a posição em caracteres, ou `null` se não dá. */
function preparar(p: Pergunta): { estado: Servico; posicao: number } | null {
  if (!ehSuportado(p.caminho)) return null;
  const estado = servicoDe(p.pasta);

  if (p.conteudo === undefined) estado.memoria.delete(p.caminho);
  else estado.memoria.set(p.caminho, p.conteudo);

  // O arquivo pode ser novo, ou estar além do teto: sem isto, perguntar sobre
  // ele devolveria vazio como se não houvesse definição.
  if (!estado.arquivos.includes(p.caminho)) estado.arquivos = [...estado.arquivos, p.caminho];

  const texto = textoDe(estado, p.caminho);
  if (texto === null) return null;
  return { estado, posicao: deslocamento(texto, p.linha, p.coluna) };
}

function coletar(
  estado: Servico,
  entradas: readonly { fileName: string; textSpan: ts.TextSpan }[] | undefined
): Alvo[] {
  const alvos: Alvo[] = [];
  const vistos = new Set<string>();
  for (const entrada of entradas ?? []) {
    const alvo = paraAlvo(estado, entrada.fileName, entrada.textSpan.start);
    if (alvo === null) continue;
    const chave = `${alvo.caminho}:${alvo.linha}:${alvo.coluna}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    alvos.push(alvo);
  }
  return alvos;
}

export function definicao(p: Pergunta): Alvo[] {
  const pronto = preparar(p);
  if (pronto === null) return [];
  const { estado, posicao } = pronto;
  return coletar(estado, estado.service.getDefinitionAtPosition(p.caminho, posicao));
}

export function definicaoDeTipo(p: Pergunta): Alvo[] {
  const pronto = preparar(p);
  if (pronto === null) return [];
  const { estado, posicao } = pronto;
  return coletar(estado, estado.service.getTypeDefinitionAtPosition(p.caminho, posicao));
}

export function referencias(p: Pergunta): Alvo[] {
  const pronto = preparar(p);
  if (pronto === null) return [];
  const { estado, posicao } = pronto;
  return coletar(estado, estado.service.getReferencesAtPosition(p.caminho, posicao));
}

// ---------------------------------------------------------------------------
// Diagnósticos, renomear e completar (T037, T038, T114)
//
// Tudo isto sai do MESMO serviço de TypeScript que já respondia "ir para a
// definição" — foi o que fez os três itens custarem um arquivo em vez de três.
// O serviço já conhece o projeto inteiro; só ninguém tinha perguntado.
// ---------------------------------------------------------------------------

export interface Diagnostico {
  readonly linha: number;
  readonly coluna: number;
  readonly linhaFim: number;
  readonly colunaFim: number;
  readonly severidade: 'erro' | 'aviso' | 'nota';
  readonly mensagem: string;
  /** O número do erro do TypeScript, ex.: `2304`. Ajuda a procurar. */
  readonly codigo: number;
}

/** Onde uma posição em caracteres cai, em linha e coluna 1-based. */
function linhaEColuna(texto: string, posicao: number): { linha: number; coluna: number } {
  const antes = texto.slice(0, posicao);
  const linha = antes.split('\n').length;
  return { linha, coluna: posicao - (antes.lastIndexOf('\n') + 1) + 1 };
}

/**
 * Erros e avisos de um arquivo (T037).
 *
 * **Sintaxe e semântica, nesta ordem.** Um arquivo que não fecha uma chave dá
 * centenas de erros semânticos falsos, todos consequência do primeiro — mostrar
 * os dois grupos juntos afogaria o erro que importa.
 */
export function diagnosticos(p: Pergunta): readonly Diagnostico[] {
  const pronto = preparar(p);
  if (pronto === null) return [];
  const { estado } = pronto;
  const texto = textoDe(estado, p.caminho);
  if (texto === null) return [];

  const deSintaxe = estado.service.getSyntacticDiagnostics(p.caminho);
  const brutos =
    deSintaxe.length > 0
      ? deSintaxe
      : [...estado.service.getSemanticDiagnostics(p.caminho)];

  const saida: Diagnostico[] = [];
  for (const d of brutos) {
    const inicio = d.start ?? 0;
    const fim = inicio + (d.length ?? 1);
    const a = linhaEColuna(texto, inicio);
    const b = linhaEColuna(texto, fim);
    saida.push({
      linha: a.linha,
      coluna: a.coluna,
      linhaFim: b.linha,
      colunaFim: b.coluna,
      severidade: severidadeDe(d.category),
      mensagem: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      codigo: d.code,
    });
  }
  return saida;
}

function severidadeDe(categoria: ts.DiagnosticCategory): Diagnostico['severidade'] {
  if (categoria === ts.DiagnosticCategory.Error) return 'erro';
  if (categoria === ts.DiagnosticCategory.Warning) return 'aviso';
  return 'nota';
}

export interface TrocaDeNome {
  readonly caminho: string;
  readonly linha: number;
  readonly coluna: number;
  /** O texto da linha, para a tela mostrar o que vai mudar. */
  readonly previa: string;
}

/**
 * Onde um símbolo é usado, para renomeá-lo (T038).
 *
 * Devolve os LUGARES, e não aplica nada — a nota dele pede *"mostrando os
 * arquivos afetados antes de aplicar"*, e é a mesma regra do Structure Sync na
 * spec 079: quem muda os arquivos dele é ele.
 *
 * `providePrefixAndSuffixTextForRename` fica LIGADO: sem ele, renomear `nome`
 * num objeto `{ nome }` reescreveria a abreviação como `{ novoNome }` e
 * quebraria a propriedade. Com ele, vira `{ nome: novoNome }`.
 */
export function lugaresParaRenomear(p: Pergunta): readonly TrocaDeNome[] {
  const pronto = preparar(p);
  if (pronto === null) return [];
  const { estado, posicao } = pronto;

  const lugares = estado.service.findRenameLocations(p.caminho, posicao, false, false, {
    providePrefixAndSuffixTextForRename: true,
  });
  if (lugares === undefined) return [];

  const saida: TrocaDeNome[] = [];
  for (const lugar of lugares) {
    const alvo = paraAlvo(estado, lugar.fileName, lugar.textSpan.start);
    if (alvo === null) continue;
    saida.push({
      caminho: alvo.caminho,
      linha: alvo.linha,
      coluna: alvo.coluna,
      previa: alvo.previa,
    });
  }
  return saida;
}

export interface Sugestao {
  readonly texto: string;
  /** O que é: `função`, `variável`, `classe`… — a tela mostra o ícone certo. */
  readonly tipo: string;
  /** A assinatura ou o tipo, quando o serviço sabe. */
  readonly detalhe?: string;
}

/** Quantas sugestões voltam. Mais que isto o Monaco filtra sozinho. */
const MAX_SUGESTOES = 200;

/**
 * O que completar nesta posição (T114).
 *
 * A nota dele: *"TS/JS pelo serviço do TypeScript; nas outras, ao menos as
 * palavras do arquivo aberto"*. Esta função é a primeira metade — a segunda
 * mora em `shared/completar-palavras.ts`, roda no navegador e não precisa de
 * projeto nenhum.
 */
export function sugestoes(p: Pergunta): readonly Sugestao[] {
  const pronto = preparar(p);
  if (pronto === null) return [];
  const { estado, posicao } = pronto;

  const lista = estado.service.getCompletionsAtPosition(p.caminho, posicao, {
    // Importar automaticamente ao aceitar a sugestão é o que torna o
    // autocomplete útil num projeto de verdade: sem isto, aceitar `useState`
    // deixa o nome sublinhado de vermelho e a pessoa vai escrever o import à
    // mão.
    includeCompletionsForModuleExports: true,
    includeCompletionsWithInsertText: true,
  });
  if (lista === undefined) return [];

  return lista.entries.slice(0, MAX_SUGESTOES).map((e) => ({
    texto: e.name,
    tipo: e.kind,
    ...(e.kindModifiers === undefined || e.kindModifiers === ''
      ? {}
      : { detalhe: e.kindModifiers }),
  }));
}
