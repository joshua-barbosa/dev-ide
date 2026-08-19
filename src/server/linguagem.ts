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
