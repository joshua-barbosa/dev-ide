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
  /**
   * O salto por um bastion, quando houver (T078).
   *
   * `undefined` = conexão direta, que é o caso comum. A presença deste campo é
   * o que liga o salto — um interruptor separado seria um estado a mais para
   * discordar do preenchimento.
   */
  readonly salto?: ConfigDeSalto;
}

/**
 * O servidor intermediário — o *bastion*, ou *jump host* (T078).
 *
 * Uma máquina que se alcança da internet e que alcança as que não se alcançam.
 * O SSH chama isso de `ProxyJump` (`ssh -J`), e é como quase toda rede séria
 * expõe o que está atrás dela.
 *
 * **Só senha e chave**, e não o agente: o agente do sistema já é oferecido no
 * salto principal, e duplicá-lo aqui abriria a porta para dois agentes
 * diferentes na mesma conexão — confusão sem ganho.
 */
export interface ConfigDeSalto {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password?: string;
  readonly privateKeyPath?: string;
  readonly passphrase?: string;
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
    ...(lerSalto(campos) === null ? {} : { salto: lerSalto(campos) as ConfigDeSalto }),
  };
}

/**
 * O salto, ou `null` quando não há.
 *
 * O HOST é o que decide: sem ele não há para onde saltar, e os outros campos
 * preenchidos sozinhos não formam um salto. Isso também é o que faz apagar o
 * host desligar o bastion sem precisar limpar o resto.
 */
function lerSalto(campos: Readonly<Record<string, FieldValue>>): ConfigDeSalto | null {
  const host = texto(campos.jump_host);
  if (host === undefined) return null;
  const porta = Number(campos.jump_port);
  return {
    host,
    port: Number.isFinite(porta) && porta > 0 ? porta : PORTA_PADRAO,
    // Sem usuário próprio, vale o do destino: é o caso mais comum, e obrigar a
    // repetir o mesmo nome duas vezes é atrito à toa.
    username: texto(campos.jump_username) ?? texto(campos.username) ?? 'root',
    password: texto(campos.jump_password),
    privateKeyPath: texto(campos.jump_private_key_path),
    passphrase: texto(campos.jump_passphrase),
  };
}

const SECAO_AVANCADO = 'Avançado';
const SECAO_ALGORITMO = 'Algoritmo';
const SECAO_SALTO = 'SSH Tunnel';

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
  { name: 'host', label: 'Host', type: 'string', required: true, placeholder: '192.0.2.53' },
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

  // ---- SSH Tunnel: o salto por um bastion (T078) --------------------------
  //
  // O host é o interruptor: preenchido, o salto vale; em branco, a conexão é
  // direta. Por isso os demais campos só aparecem depois dele — um formulário
  // que pede porta e senha de um bastion que não existe é ruído.
  {
    name: 'jump_host',
    label: 'Host do bastion',
    type: 'string',
    section: SECAO_SALTO,
    placeholder: 'em branco = conexão direta',
    help: 'A máquina intermediária. É o `ssh -J` / `ProxyJump` do OpenSSH.',
  },
  {
    name: 'jump_port',
    label: 'Porta do bastion',
    type: 'number',
    section: SECAO_SALTO,
    default: PORTA_PADRAO,
    showIf: { campo: 'jump_host' },
  },
  {
    name: 'jump_username',
    label: 'Usuário no bastion',
    type: 'string',
    section: SECAO_SALTO,
    placeholder: 'em branco = o mesmo do destino',
    showIf: { campo: 'jump_host' },
  },
  {
    name: 'jump_private_key_path',
    label: 'Chave privada do bastion',
    type: 'path',
    section: SECAO_SALTO,
    placeholder: 'em branco = a mesma do destino',
    showIf: { campo: 'jump_host' },
  },
  {
    name: 'jump_passphrase',
    label: 'Passphrase da chave do bastion',
    type: 'password',
    secret: true,
    section: SECAO_SALTO,
    showIf: { campo: 'jump_host' },
  },
  {
    name: 'jump_password',
    label: 'Senha no bastion',
    type: 'password',
    secret: true,
    section: SECAO_SALTO,
    showIf: { campo: 'jump_host' },
  },
];

/** Só para os testes e para quem quer a declaração crua, sem as sugestões. */
export const CAMPOS_SSH = CAMPOS_BASE;
