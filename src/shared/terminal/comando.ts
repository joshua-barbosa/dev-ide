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
   * Variável de ambiente que recebe a SENHA, para clientes sem arquivo de
   * credencial (spec 089).
   *
   * O `redis-cli` é o caso: não tem nada como o `.pgpass`, e as alternativas
   * são `-a senha` ou `--pass senha`, que põem o segredo em `argv` — legível
   * por qualquer `ps` da máquina. O ambiente de um processo é legível só pelo
   * DONO dele, que aqui é o próprio usuário da IDE.
   *
   * Quem preenche é `montarComando`, e não o driver: assim a senha continua
   * fora do alcance de quem monta os argumentos, que é a garantia que este
   * módulo existe para dar.
   */
  readonly envDeSenha?: string;
  /**
   * Devolve a versão de um campo SECRETO que pode ir para `argv` — ou `null`
   * para ele continuar escondido (spec 089).
   *
   * Existe por um caso concreto: a URL do Redis é secreta porque carrega a
   * senha dentro (`redis://:senha@host:porta/0`), mas sem o ENDEREÇO o terminal
   * não sabe a que servidor se conectar — e cairia no `127.0.0.1` do padrão,
   * calado.
   *
   * A sanitização mora AQUI, num lugar só, e não espalhada por cada driver:
   * assim se audita numa página o que pode escapar para a linha de comando.
   */
  readonly sanitizarSegredo?: (nome: string, valor: string) => string | null;
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
  const seguro: ContextoDeComando = {
    ...ctx,
    fields: semSegredos(ctx.fields, camposSecretos, cli.sanitizarSegredo),
  };

  const temSenha = cli.campoDeSenha !== undefined && senha !== '';
  const precisaDeArquivo = temSenha && cli.envDeSenha === undefined;
  return {
    exec: cli.exec,
    args: cli.montarArgs(seguro),
    env: {
      // A senha entra AQUI, e não em `montarEnv`: o driver nunca a vê.
      ...(temSenha && cli.envDeSenha !== undefined ? { [cli.envDeSenha]: senha } : {}),
      ...(cli.montarEnv?.(seguro) ?? {}),
    },
    credencial: precisaDeArquivo ? cli.montarCredencial(senha) : null,
  };
}

function semSegredos(
  fields: Readonly<Record<string, FieldValue>>,
  secretos: readonly string[],
  sanitizar?: (nome: string, valor: string) => string | null
): Readonly<Record<string, FieldValue>> {
  const fora = new Set(secretos);
  const saida: Record<string, FieldValue> = {};
  for (const [nome, valor] of Object.entries(fields)) {
    if (!fora.has(nome)) {
      saida[nome] = valor;
      continue;
    }
    // Campo secreto: só entra se o cliente disser explicitamente o que dele é
    // seguro, e só com o que ele devolveu.
    const limpo = sanitizar?.(nome, String(valor)) ?? null;
    if (limpo !== null) saida[nome] = limpo;
  }
  return saida;
}
