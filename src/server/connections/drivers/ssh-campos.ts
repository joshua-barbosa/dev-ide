// Os campos do driver SSH, e o que eles viram (spec 052).
//
// Puro de propósito: a declaração é dado, e a leitura da configuração é uma
// função sem efeito. É o que permite provar, sem servidor nenhum, que `Auth` e
// os campos condicionais combinam — e que um `Root Path` torto não passa.
import type { FieldOption, FieldSpec } from '../../../shared/contracts';
import { normalizarRemoto } from '../../../shared/remoto/caminho';
import type { FieldValue } from '../types';

/** Como o usuário se autentica. `native` fica de fora desta spec (D20). */
export type ModoDeAuth = 'password' | 'key' | 'agent' | 'auto';

export const AUTH_PADRAO: ModoDeAuth = 'password';

/** Os três campos de algoritmo (D21). Vazio = o padrão do `ssh2`. */
export interface AlgoritmosSsh {
  readonly cipher?: readonly string[];
  readonly kex?: readonly string[];
  readonly serverHostKey?: readonly string[];
}

export interface ConfigSsh {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly auth: ModoDeAuth;
  readonly password?: string;
  readonly privateKeyPath?: string;
  readonly passphrase?: string;
  readonly agentPath?: string;
  /** Onde a árvore começa. */
  readonly rootPath: string;
  /** Esconde o que está acima da raiz, e recusa quem tentar subir (D23). */
  readonly pruneRoot: boolean;
  readonly showHidden: boolean;
  /** Comando rodado ao abrir o terminal. Vazio = o shell de login. */
  readonly shell?: string;
  readonly algoritmos: AlgoritmosSsh;
  readonly timeoutMs: number;
}

export const PORTA_PADRAO = 22;
const TIMEOUT_PADRAO = 15_000;

/**
 * Lista separada por vírgula ou espaço, ou `undefined` quando em branco.
 *
 * `undefined` e lista vazia querem dizer coisas diferentes para o `ssh2`: a
 * primeira mantém o padrão dele, a segunda desabilitaria tudo e nenhuma conexão
 * fecharia. Por isso o branco vira ausência, e não `[]`.
 */
export function listaDeAlgoritmos(bruto: unknown): readonly string[] | undefined {
  if (typeof bruto !== 'string') return undefined;
  const itens = bruto
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return itens.length === 0 ? undefined : itens;
}

function texto(valor: FieldValue | undefined): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

function ehModo(bruto: unknown): bruto is ModoDeAuth {
  return bruto === 'password' || bruto === 'key' || bruto === 'agent' || bruto === 'auto';
}

/**
 * Lê a configuração salva, com os padrões da tela de referência.
 *
 * Não valida credencial: se falta senha, quem reclama é o servidor SSH, e a
 * mensagem dele é mais útil que qualquer texto nosso. O que se garante aqui é
 * forma — porta numérica, raiz normalizada, modo de auth conhecido.
 */
export function lerConfigSsh(campos: Readonly<Record<string, FieldValue>>): ConfigSsh {
  const porta = Number(campos.port);
  const bruto = campos.auth;
  return {
    host: texto(campos.host) ?? '',
    port: Number.isFinite(porta) && porta > 0 ? porta : PORTA_PADRAO,
    username: texto(campos.username) ?? 'root',
    auth: ehModo(bruto) ? bruto : AUTH_PADRAO,
    password: texto(campos.password),
    privateKeyPath: texto(campos.private_key_path),
    passphrase: texto(campos.passphrase),
    agentPath: texto(campos.agent_path),
    // A raiz é normalizada aqui e não na hora de usar: ela é o chão de toda
    // comparação da cerca, e uma raiz com `//` ou `/.` faria a cerca comparar
    // com uma coisa que o servidor não tem.
    rootPath: normalizarRemoto(texto(campos.root_path) ?? '/'),
    pruneRoot: campos.prune_root === true,
    // Ligado por padrão, como na ferramenta de referência: quem abre um servidor
    // por SSH costuma estar atrás de `.env`, `.gitignore` e afins.
    showHidden: campos.show_hidden !== false,
    shell: texto(campos.shell),
    algoritmos: {
      cipher: listaDeAlgoritmos(campos.cipher),
      kex: listaDeAlgoritmos(campos.kex),
      serverHostKey: listaDeAlgoritmos(campos.host_key),
    },
    timeoutMs: Number.isFinite(Number(campos.timeout))
      ? Math.max(1_000, Number(campos.timeout))
      : TIMEOUT_PADRAO,
  };
}

const SECAO_AVANCADO = 'Avançado';
const SECAO_ALGORITMO = 'Algoritmo';

/**
 * A declaração que a tela obedece.
 *
 * As condições (`showIf`) são a razão da D20: `Auth` tem quatro valores e cada
 * um muda quais campos fazem sentido. Quem sabe que `Passphrase` pertence à
 * chave é quem declarou os dois — não a tela.
 */
function camposDoSsh(sugestoesDeChave: readonly FieldOption[]): readonly FieldSpec[] {
  return CAMPOS_BASE.map((campo) =>
    campo.name === 'private_key_path' && sugestoesDeChave.length > 0
      ? {
          ...campo,
          options: sugestoesDeChave,
          help: 'As chaves encontradas em ~/.ssh. Escolha uma, ou digite outro caminho.',
        }
      : campo
  );
}

export { camposDoSsh };

const CAMPOS_BASE: readonly FieldSpec[] = [
  { name: 'host', label: 'Host', type: 'string', required: true, placeholder: '10.0.16.53' },
  { name: 'port', label: 'Porta', type: 'number', required: true, default: PORTA_PADRAO },
  { name: 'username', label: 'Usuário', type: 'string', required: true, default: 'root' },
  {
    name: 'auth',
    label: 'Autenticação',
    type: 'select',
    required: true,
    default: AUTH_PADRAO,
    options: [
      { value: 'password', label: 'Senha' },
      { value: 'key', label: 'Chave privada' },
      { value: 'agent', label: 'Agente' },
      { value: 'auto', label: 'Automática (tenta o que houver)' },
    ],
  },
  {
    name: 'password',
    label: 'Senha',
    type: 'password',
    secret: true,
    showIf: { campo: 'auth', valores: ['password', 'auto'] },
  },
  {
    name: 'private_key_path',
    label: 'Chave privada',
    // `path`, e não `select`: as chaves de `~/.ssh` são SUGESTÃO. Uma lista
    // fechada proibiria a chave que mora noutro lugar, que é justamente o caso
    // em que ninguém adivinha o caminho (D22).
    type: 'path',
    placeholder: '~/.ssh/id_ed25519',
    showIf: { campo: 'auth', valores: ['key', 'auto'] },
  },
  {
    name: 'passphrase',
    label: 'Passphrase da chave',
    type: 'password',
    secret: true,
    showIf: { campo: 'auth', valores: ['key', 'auto'] },
  },
  {
    name: 'agent_path',
    label: 'Socket do agente',
    type: 'string',
    placeholder: 'env.SSH_AUTH_SOCK',
    help: 'Em branco usa a variável SSH_AUTH_SOCK do ambiente.',
    showIf: { campo: 'auth', valores: ['agent'] },
  },

  // ------------------------------------------------------------------ avançado
  {
    name: 'root_path',
    label: 'Raiz',
    type: 'string',
    default: '/',
    section: SECAO_AVANCADO,
    help: 'Onde a árvore começa.',
  },
  {
    name: 'prune_root',
    label: 'Prender na raiz',
    type: 'boolean',
    default: false,
    section: SECAO_AVANCADO,
    help: 'Esconde o que está acima da raiz — e recusa quem tentar subir.',
  },
  {
    name: 'show_hidden',
    label: 'Mostrar arquivos ocultos',
    type: 'boolean',
    default: true,
    section: SECAO_AVANCADO,
  },
  {
    name: 'shell',
    label: 'Comando ao abrir o terminal',
    type: 'string',
    section: SECAO_AVANCADO,
    placeholder: 'em branco = o shell de login',
  },
  {
    name: 'timeout',
    label: 'Tempo de conexão (ms)',
    type: 'number',
    default: TIMEOUT_PADRAO,
    section: SECAO_AVANCADO,
  },

  // ----------------------------------------------------------------- algoritmo
  //
  // Três campos de texto no lugar das 40 caixas da ferramenta de referência
  // (D21). Vazios por padrão: quem não precisa nunca os vê. Quem precisa é quem
  // tem servidor antigo — e o erro de negociação diz o que preencher.
  {
    name: 'cipher',
    label: 'Ciphers',
    type: 'string',
    section: SECAO_ALGORITMO,
    placeholder: 'em branco = o padrão',
    help: 'Separados por vírgula. Ex.: aes128-ctr, aes256-ctr',
  },
  {
    name: 'kex',
    label: 'Troca de chaves (kex)',
    type: 'string',
    section: SECAO_ALGORITMO,
    placeholder: 'em branco = o padrão',
    help: 'Servidor antigo costuma exigir diffie-hellman-group14-sha1.',
  },
  {
    name: 'host_key',
    label: 'Chave do servidor',
    type: 'string',
    section: SECAO_ALGORITMO,
    placeholder: 'em branco = o padrão',
    help: 'Servidor antigo costuma exigir ssh-rsa.',
  },
];

/** Só para os testes e para quem quer a declaração crua, sem as sugestões. */
export const CAMPOS_SSH = CAMPOS_BASE;
