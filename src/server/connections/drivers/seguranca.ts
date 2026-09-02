// O `Security` da árvore: usuários e papéis (N003, spec 069).
//
// O pedido dele tem duas metades, e elas NÃO são a mesma pergunta: ver a lista
// e poder criar. No `publico` dele o usuário lê `pg_roles` inteiro e não pode
// criar nada — o nó aparece, o `+` não.
//
// A regra que sustenta o resto: **erro de permissão vira ausência; qualquer
// outro erro continua sendo erro.** Esconder um servidor fora do ar sob "você
// não tem permissão" seria mentir para quem está tentando entender por que a
// árvore está vazia.
import type { NodeAction, NodeIcon, TreeNode } from '../types';
import {
  apagarUsuario, conceder, criarUsuario, PRIVILEGIOS, revogar,
  type DialetoDeUsuario, type Usuario,
} from '../../../shared/sql/usuarios';

/**
 * O caminho do nó de segurança, irmão dos bancos.
 *
 * Papel e usuário são do cluster, não de um banco — é onde o print dele mostra.
 * Um banco chamado literalmente `@security` seria sombreado por este nó; é o
 * preço de não gastar uma ida ao servidor a cada expansão.
 */
export const SECURITY_ID = '@security';

export type DialetoDeSeguranca = 'mysql' | 'postgres';

export interface CategoriaDeSeguranca {
  readonly id: 'users' | 'roles';
  readonly label: string;
  readonly icon: NodeIcon;
}

const USERS: CategoriaDeSeguranca = { id: 'users', label: 'Users', icon: 'user' };
const ROLES: CategoriaDeSeguranca = { id: 'roles', label: 'Roles', icon: 'role' };

/**
 * O MySQL não tem papel na árvore da ferramenta de referência — e antes do 8.0
 * não tinha papel nenhum. O PostgreSQL tem os dois, e a diferença entre eles é
 * uma bandeira: `rolcanlogin`.
 */
export function categoriasDeSeguranca(
  dialeto: DialetoDeSeguranca
): readonly CategoriaDeSeguranca[] {
  return dialeto === 'postgres' ? [USERS, ROLES] : [USERS];
}

/** Códigos de "sem permissão" dos dois bancos. Nada de olhar a mensagem. */
const ERRNOS_MYSQL = new Set([1044, 1045, 1142, 1143, 1227]);
const CODIGOS = new Set([
  '42501', // PostgreSQL: insufficient_privilege
  'ER_DBACCESS_DENIED_ERROR',
  'ER_ACCESS_DENIED_ERROR',
  'ER_TABLEACCESS_DENIED_ERROR',
  'ER_COLUMNACCESS_DENIED_ERROR',
  'ER_SPECIFIC_ACCESS_DENIED_ERROR',
]);

/**
 * O erro é "você não tem permissão"?
 *
 * Só código, nunca texto: `denied` aparece em mensagem de proxy e de firewall, e
 * classificar pela palavra faria um servidor inacessível desaparecer da árvore
 * como se fosse falta de privilégio.
 */
export function ehPermissaoNegada(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const bruto = erro as { errno?: unknown; code?: unknown };
  if (typeof bruto.errno === 'number' && ERRNOS_MYSQL.has(bruto.errno)) return true;
  return typeof bruto.code === 'string' && CODIGOS.has(bruto.code);
}

/** No PostgreSQL, cria papel quem é superusuário OU tem `CREATEROLE`. */
export function podeCriarNoPostgres(
  linha: { rolsuper?: unknown; rolcreaterole?: unknown } | undefined
): boolean {
  return linha?.rolsuper === true || linha?.rolcreaterole === true;
}

/**
 * No MySQL, cria usuário quem tem `CREATE USER` — ou `ALL PRIVILEGES` **em
 * `*.*`**.
 *
 * O alvo importa: `ALL PRIVILEGES ON \`escola\`.*` é tudo dentro de um banco, e
 * não inclui criar usuário. Ler só os privilégios, ignorando o `ON`, mostraria o
 * `+` para quem tomaria DENIED no clique — que é o defeito que ele relatou.
 */
export function podeCriarNoMysql(linhas: readonly string[]): boolean {
  return linhas.some((linha) => {
    const m = /^\s*GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s/i.exec(linha);
    if (m === null) return false;
    const [, privilegios, alvo] = m;
    if (alvo.replace(/`/g, '') !== '*.*') return false;
    return /\bCREATE\s+USER\b/i.test(privilegios) || /\bALL\s+PRIVILEGES\b/i.test(privilegios);
  });
}

// ---------------------------------------------------------------------------
// As consultas
// ---------------------------------------------------------------------------

/**
 * Usuários e papéis do PostgreSQL saem da MESMA tabela: `rolcanlogin` é o que
 * separa quem entra de quem só empresta privilégio.
 */
export const PG_PAPEIS_SQL = `
  SELECT r.rolname AS nome,
         r.rolsuper AS super,
         r.rolcreaterole AS cria_papel,
         r.rolcreatedb AS cria_banco,
         r.rolvaliduntil AS validade
    FROM pg_roles r
   WHERE r.rolcanlogin = $1{FILTRO}
   ORDER BY r.rolname
`;

export const PG_PODE_CRIAR_SQL = `
  SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user
`;

/** `mysql.user` é a tabela que o servidor dele recusa — e é essa recusa que some. */
export const MYSQL_USUARIOS_SQL = `
  SELECT user AS nome, host FROM mysql.user{FILTRO} ORDER BY user, host
`;

export const MYSQL_GRANTS_SQL = 'SHOW GRANTS FOR CURRENT_USER()';

/** Esqueletos de criação, entregues à interface como os das outras categorias. */
export const TEMPLATES_DE_SEGURANCA: Readonly<
  Record<DialetoDeSeguranca, Readonly<Record<string, string>>>
> = {
  postgres: {
    users: [
      "CREATE ROLE novo_usuario WITH LOGIN PASSWORD 'troque-esta-senha';",
      '-- GRANT CONNECT ON DATABASE banco TO novo_usuario;',
    ].join('\n'),
    roles: [
      'CREATE ROLE novo_papel;',
      '-- GRANT USAGE ON SCHEMA public TO novo_papel;',
    ].join('\n'),
  },
  mysql: {
    users: [
      "CREATE USER 'novo_usuario'@'%' IDENTIFIED BY 'troque-esta-senha';",
      "-- GRANT SELECT ON `banco`.* TO 'novo_usuario'@'%';",
    ].join('\n'),
  },
};

// ---------------------------------------------------------------------------
// A navegação, igual nos dois bancos
// ---------------------------------------------------------------------------

/**
 * Roda a consulta e devolve `null` quando o servidor disser "sem permissão".
 *
 * É este `null` que faz o nó não nascer. Qualquer outro erro sobe: um servidor
 * fora do ar precisa aparecer como erro, e não como nó ausente.
 */
export async function sondar<T>(consulta: () => Promise<T>): Promise<T | null> {
  try {
    return await consulta();
  } catch (erro) {
    if (ehPermissaoNegada(erro)) return null;
    throw erro;
  }
}

/** O nó `Security`, irmão dos bancos. */
export function noDeSeguranca(): TreeNode {
  return {
    id: SECURITY_ID,
    label: 'Security',
    icon: 'security',
    hasChildren: true,
    meta: { seguranca: true },
  };
}

/**
 * Um nó de categoria dentro do `Security`.
 *
 * O esqueleto só vai junto quando `podeCriar` — e é a AUSÊNCIA do `template`
 * que faz a interface não desenhar o `+`, pela regra que a spec 038 já usava
 * para as categorias sem esqueleto. Não há um segundo caminho para esconder o
 * botão, e é bom que não haja: dois caminhos divergem.
 */
export function noDeCategoriaDeSeguranca(
  categoria: CategoriaDeSeguranca,
  dialeto: DialetoDeSeguranca,
  podeCriar: boolean,
  quantos: number | undefined
): TreeNode {
  return {
    id: categoria.id,
    label: categoria.label,
    icon: categoria.icon,
    detail: quantos === undefined ? undefined : String(quantos),
    hasChildren: true,
    meta: {
      categoria: true,
      seguranca: true,
      template: podeCriar ? TEMPLATES_DE_SEGURANCA[dialeto][categoria.id] : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// SQL de usuário e permissão — GERADO, nunca executado (P3)
// ---------------------------------------------------------------------------

/**
 * As ações que um nó de usuário oferece.
 *
 * Todas COPIAM: nenhuma executa, e nenhuma abre aba. É a decisão dele de
 * 02/09/2026 — o SQL vai para o `.sql` ou o `.sqlbook`, e quem aperta o Run é
 * ele. O `apagar` fica vermelho pelo `danger`, mas o vermelho aqui avisa sobre
 * o que o TEXTO faz quando for executado, e não sobre o que o clique faz.
 */
export const ACOES_DE_USUARIO: readonly NodeAction[] = [
  { id: 'usuario-grant', label: 'Copiar SQL de GRANT', copiar: true },
  { id: 'usuario-revoke', label: 'Copiar SQL de REVOKE', copiar: true },
  { id: 'usuario-drop', label: 'Copiar SQL para APAGAR', copiar: true, danger: true },
];

/** As ações da categoria `users`: criar. */
export const ACOES_DA_CATEGORIA_DE_USUARIOS: readonly NodeAction[] = [
  { id: 'usuario-create', label: 'Copiar SQL para criar usuário', copiar: true },
];

/**
 * Monta o SQL de uma das ações acima.
 *
 * `null` quando o `actionId` não é destes — quem chama segue para o próximo
 * ramo do `switch` em vez de estourar.
 *
 * O GRANT e o REVOKE saem com ALVO E PRIVILÉGIO DE EXEMPLO, porque a IDE não
 * tem como saber quais ele quer: o menu não pergunta, e inventar um padrão
 * "seguro" que ninguém lê daria um comando errado com cara de certo. O que sai
 * é um esqueleto com o nome do usuário já correto — que é a parte chata de
 * escrever à mão, e a que erra.
 */
export function sqlDeAcaoDeUsuario(
  dialeto: DialetoDeUsuario,
  actionId: string,
  usuario: Usuario
): string | null {
  const exemplo = {
    usuario,
    privilegios: ['SELECT'],
    alvo: { tipo: 'banco', banco: 'NOME_DO_BANCO' },
  } as const;

  switch (actionId) {
    case 'usuario-create':
      return criarUsuario(dialeto, usuario);
    case 'usuario-drop':
      return apagarUsuario(dialeto, usuario);
    case 'usuario-grant':
      return [
        '-- Troque o banco e os privilégios antes de executar.',
        `-- Privilégios possíveis: ${PRIVILEGIOS[dialeto].join(', ')}.`,
        conceder(dialeto, exemplo),
      ].join('\n');
    case 'usuario-revoke':
      return [
        '-- Troque o banco e os privilégios antes de executar.',
        revogar(dialeto, exemplo),
      ].join('\n');
    default:
      return null;
  }
}
