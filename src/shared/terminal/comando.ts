// Montagem do comando que abre uma conexão no cliente de linha de comando.
//
// Este arquivo existe por causa de UM requisito, e ele vale ser dito por
// extenso: a senha não pode aparecer em `argv` nem no ambiente.
//
// A ferramenta que este projeto substitui abre um `bash` e digita nele
// `mysql -h ... -p'senha'`. O próprio cliente avisa que isso é inseguro, e com
// razão — a senha vaza em quatro lugares:
//
//   - `ps` e `/proc/<pid>/cmdline`, legíveis por QUALQUER usuário da máquina;
//   - `~/.bash_history`, em texto puro e para sempre;
//   - a rolagem do terminal, até a aba fechar;
//   - qualquer captura de tela.
//
// Aqui a credencial vai num arquivo `600` e a linha de comando carrega só o
// caminho. Variável de ambiente também não serve: `/proc/<pid>/environ` a expõe,
// e o próprio MySQL documenta `MYSQL_PWD` como inseguro.
//
// A montagem é lógica pura de propósito: é o que permite testar a garantia sem
// servidor de banco nenhum. O teste que importa percorre todos os drivers e
// afirma que a senha não está em argumento nenhum.
import type { FieldValue } from '../contracts';

/** O que o driver declara sobre seu cliente de linha de comando. */
export interface ClienteDeLinhaDeComando {
  /** Executável, procurado no PATH. */
  readonly exec: string;
  /** Nome do campo que guarda a senha, se houver. */
  readonly campoDeSenha?: string;
  /**
   * Monta os argumentos. Recebe o caminho do arquivo de credencial já
   * escrito — nunca a senha, para não haver como colocá-la em `argv` por
   * descuido.
   */
  montarArgs(ctx: ContextoDeComando): readonly string[];
  /** Conteúdo do arquivo de credencial. Vazio significa "não precisa". */
  montarCredencial(senha: string): string;
  /** Variáveis extras. A senha NUNCA entra aqui. */
  montarEnv?(ctx: ContextoDeComando): Readonly<Record<string, string>>;
}

export interface ContextoDeComando {
  /**
   * Campos da conexão **sem os secretos**.
   *
   * A remoção é feita por `montarComando`, e não é zelo excessivo: sem ela um
   * driver poderia escrever `texto(fields, 'password')` e pôr o segredo em
   * `argv` sem ninguém notar. Assim a senha simplesmente não está ao alcance de
   * quem monta os argumentos.
   */
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly readOnly: boolean;
  /** Caminho do arquivo de credencial, ou `null` quando não há senha. */
  readonly arquivoDeCredencial: string | null;
}

export interface ComandoDeTerminal {
  readonly exec: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** Conteúdo a gravar antes de lançar; `null` quando não há senha. */
  readonly credencial: string | null;
}

/** Texto de um campo, ou vazio. Centralizado para não repetir a conversão. */
export function texto(fields: Readonly<Record<string, FieldValue>>, nome: string): string {
  const valor = fields[nome];
  return valor === undefined || valor === null ? '' : String(valor);
}

/**
 * Monta o comando completo.
 *
 * Devolve `null` quando o driver não declara cliente — é o que faz a ação
 * simplesmente não existir para SQLite, sem a interface precisar saber disso.
 *
 * `camposSecretos` é obrigatório de propósito: com valor padrão, um chamador
 * que esquecesse do argumento desligaria a proteção em silêncio.
 */
export function montarComando(
  cli: ClienteDeLinhaDeComando | undefined,
  ctx: ContextoDeComando,
  senha: string,
  camposSecretos: readonly string[]
): ComandoDeTerminal | null {
  if (cli === undefined) return null;

  // Tira os segredos ANTES de qualquer driver ver os campos. É o que torna o
  // vazamento em `argv` impossível por construção, e não apenas improvável.
  const seguro: ContextoDeComando = { ...ctx, fields: semSegredos(ctx.fields, camposSecretos) };

  const precisaDeArquivo = cli.campoDeSenha !== undefined && senha !== '';
  return {
    exec: cli.exec,
    args: cli.montarArgs(seguro),
    env: cli.montarEnv?.(seguro) ?? {},
    credencial: precisaDeArquivo ? cli.montarCredencial(senha) : null,
  };
}

function semSegredos(
  fields: Readonly<Record<string, FieldValue>>,
  secretos: readonly string[]
): Readonly<Record<string, FieldValue>> {
  const fora = new Set(secretos);
  return Object.fromEntries(Object.entries(fields).filter(([nome]) => !fora.has(nome)));
}
