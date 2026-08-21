// Os arquivos de query, guardados por conexão e database.
//
// Duas rotas mexem em arquivo de query, e só UMA tem cerca — vale explicar por
// quê, porque parece inconsistência e não é.
//
// Abrir e salvar passam por `/api/file`, que resolve qualquer caminho. Isso foi
// decidido na spec 012 e continua valendo: o servidor escuta só em `127.0.0.1` e
// já executa código arbitrário do editor, então uma cerca ali seria teatro.
// Reaproveitar a rota dá de graça o `Ctrl+S`, o vigia da spec 037 e a volta das
// abas depois do F5 da spec 030.
//
// Este arquivo faz o que aquela rota NÃO faz — listar, criar, renomear e apagar
// — e aqui a cerca é real: tudo resolve sob a raiz de queries, e o que escapar é
// recusado. A diferença é que aqui o caminho é MONTADO a partir de um nome que
// veio do usuário, e nome vindo de fora é onde `..` entra.
import * as fs from 'fs';
import * as path from 'path';
import {
  PASTA_DE_QUERIES,
  pastaDoVinculo,
  type ArquivoDeQuery,
  type Vinculo,
} from '../shared/sql/vinculo';

export type { ArquivoDeQuery };
import { homeDeDados } from './paths';

/**
 * Extensões que a pasta de query aceita.
 *
 * `.sqlbook` entrou na spec 048. A primeira da lista é a que um nome sem
 * extensão ganha.
 */
const EXTENSOES = ['.sql', '.sqlbook'] as const;
const EXTENSAO = EXTENSOES[0];

/** Teto de arquivos por conexão+database. Rede de proteção, não limite de uso. */
export const MAX_ARQUIVOS = 500;

/** Nome de arquivo: o que o usuário digita, e por isso o que precisa de guarda. */
export const MAX_NOME = 80;

/**
 * Nome de arquivo padrão para um database.
 *
 * Aqui SANEAR é o certo, e não recusar — ao contrário de `validarNome`. A
 * diferença é a origem: `validarNome` guarda o que o USUÁRIO digitou, e sanear
 * ali faria "../x" virar "x.sql" sem ele saber. Este nome vem do BANCO, o
 * usuário não escolheu nada, e recusar deixaria `Abrir Query` quebrado para um
 * database chamado `a/b` — que o MySQL aceita entre crases.
 *
 * Encontrado pelo teste, não na tela: o nome do arquivo herdava o nome cru do
 * database e batia na validação.
 */
export function nomePadraoDoDatabase(database: string): string {
  const limpo = database
    .replace(/[/\\\0]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_NOME - EXTENSAO.length);
  return limpo === '' ? 'query' : limpo;
}

/** Raiz de todas as pastas de query. */
export function raizDeQueries(): string {
  return path.join(homeDeDados(), PASTA_DE_QUERIES);
}

/** Pasta de uma conexão+database. Não cria nada. */
export function pastaDe(vinculo: Vinculo): string {
  return path.join(raizDeQueries(), pastaDoVinculo(vinculo));
}

/**
 * Valida um nome de arquivo vindo do usuário.
 *
 * Recusa em vez de sanear: saneamento silencioso faria "../x.sql" virar "x.sql",
 * e o usuário nunca saberia que pediu outra coisa.
 */
export function validarNome(bruto: unknown): string {
  const nome = typeof bruto === 'string' ? bruto.trim() : '';
  if (nome === '') throw new Error('O arquivo precisa de um nome.');
  if (nome.length > MAX_NOME) throw new Error(`O nome passa de ${MAX_NOME} caracteres.`);
  if (nome.includes('\0')) throw new Error('Nome inválido.');
  if (nome.includes('/') || nome.includes('\\')) {
    throw new Error('O nome não pode conter separador de caminho.');
  }
  if (nome === '.' || nome === '..' || nome.startsWith('.')) {
    throw new Error('O nome não pode começar com ponto.');
  }
  const baixo = nome.toLowerCase();
  return EXTENSOES.some((e) => baixo.endsWith(e)) ? nome : `${nome}${EXTENSAO}`;
}

/**
 * Resolve um arquivo dentro da pasta do vínculo, com cerca.
 *
 * A checagem é feita DEPOIS de resolver, e não sobre o texto: `a/../../x` só se
 * revela como fuga depois de `path.resolve`.
 */
export function arquivoDe(vinculo: Vinculo, nome: string): string {
  const pasta = pastaDe(vinculo);
  const alvo = path.resolve(pasta, validarNome(nome));
  if (!alvo.startsWith(pasta + path.sep)) {
    throw new Error('O arquivo precisa ficar dentro da pasta da conexão.');
  }
  return alvo;
}

/** Lista os `.sql` de uma conexão+database. Pasta inexistente é lista vazia. */
export function listar(vinculo: Vinculo): readonly ArquivoDeQuery[] {
  const pasta = pastaDe(vinculo);
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(pasta, { withFileTypes: true });
  } catch {
    // AC-28: ainda não abriu nenhuma query aqui. Vazio não é erro.
    return [];
  }

  const arquivos: ArquivoDeQuery[] = [];
  for (const entrada of entradas) {
    if (arquivos.length >= MAX_ARQUIVOS) break;
    if (!entrada.isFile()) continue;
    const baixo = entrada.name.toLowerCase();
    if (!EXTENSOES.some((e) => baixo.endsWith(e))) continue;
    const caminho = path.join(pasta, entrada.name);
    try {
      const info = fs.statSync(caminho);
      arquivos.push({
        nome: entrada.name,
        caminho,
        bytes: info.size,
        modificadoEm: info.mtime.toISOString(),
      });
    } catch {
      // Sumiu entre o `readdir` e o `stat`: segue com os outros.
    }
  }
  return arquivos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Garante que o arquivo existe, criando vazio se preciso, e devolve o caminho.
 *
 * É o que `Abrir Query` chama: abrir uma query que nunca existiu tem que dar um
 * arquivo em branco, e não um erro (AC-1).
 */
export function garantir(vinculo: Vinculo, nome: string, conteudoInicial = ''): string {
  const alvo = arquivoDe(vinculo, nome);
  if (!fs.existsSync(alvo)) {
    fs.mkdirSync(path.dirname(alvo), { recursive: true, mode: 0o700 });
    fs.writeFileSync(alvo, conteudoInicial, { mode: 0o600 });
  }
  return alvo;
}

/** Cria um arquivo novo. Recusa se já existir — sobrescrever seria perder query. */
export function criar(vinculo: Vinculo, nome: string): string {
  const alvo = arquivoDe(vinculo, nome);
  if (fs.existsSync(alvo)) throw new Error(`Já existe um arquivo chamado "${path.basename(alvo)}".`);
  if (listar(vinculo).length >= MAX_ARQUIVOS) {
    throw new Error(`Esta conexão já tem ${MAX_ARQUIVOS} arquivos de query.`);
  }
  fs.mkdirSync(path.dirname(alvo), { recursive: true, mode: 0o700 });
  fs.writeFileSync(alvo, '', { mode: 0o600 });
  return alvo;
}

export function renomear(vinculo: Vinculo, de: string, para: string): string {
  const origem = arquivoDe(vinculo, de);
  const destino = arquivoDe(vinculo, para);
  if (!fs.existsSync(origem)) throw new Error(`Arquivo não encontrado: ${de}`);
  if (origem === destino) return destino;
  if (fs.existsSync(destino)) {
    throw new Error(`Já existe um arquivo chamado "${path.basename(destino)}".`);
  }
  fs.renameSync(origem, destino);
  return destino;
}

export function apagar(vinculo: Vinculo, nome: string): string {
  const alvo = arquivoDe(vinculo, nome);
  if (!fs.existsSync(alvo)) throw new Error(`Arquivo não encontrado: ${nome}`);
  fs.unlinkSync(alvo);
  return alvo;
}
