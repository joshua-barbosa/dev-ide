// `Security` do MySQL: `Users` (N003, spec 069).
//
// É aqui que a feature nasceu. O servidor `banco-grande` dele responde
// `SELECT command denied … for table 'user'` — e a reclamação foi exatamente
// essa: *"seria bom nem aparecer se eu não tenho permissão"*.
//
// O MySQL não ganha `Roles`: antes do 8.0 ele não tinha papel nenhum, e a
// ferramenta de referência também mostra só usuários.
import {
  MYSQL_GRANTS_SQL,
  MYSQL_USUARIOS_SQL,
  categoriasDeSeguranca,
  noDeCategoriaDeSeguranca,
  podeCriarNoMysql,
  sondar,
} from './seguranca';
import type { TreeNode } from '../types';

type Consulta = <T>(sql: string, params?: readonly unknown[]) => Promise<T[]>;

/** O nó `Security` só nasce se `mysql.user` responder. */
export async function segurancaDisponivel(consulta: Consulta): Promise<boolean> {
  const r = await sondar(() => consulta('SELECT 1 FROM mysql.user LIMIT 1'));
  return r !== null;
}

/**
 * Pode criar usuário?
 *
 * `SHOW GRANTS` é o único jeito honesto: `mysql.user` legível não implica poder
 * criar, e o contrário também acontece. Se o próprio `SHOW GRANTS` for negado,
 * a resposta é não — e o `+` some, em vez de dar DENIED no clique.
 */
async function podeCriar(consulta: Consulta): Promise<boolean> {
  const linhas = await sondar(() => consulta<Record<string, string>>(MYSQL_GRANTS_SQL));
  if (linhas === null) return false;
  return podeCriarNoMysql(linhas.map((linha) => Object.values(linha)[0] ?? ''));
}

export async function listarSeguranca(
  consulta: Consulta,
  resto: readonly string[],
  filtro?: string | null
): Promise<TreeNode[]> {
  if (resto.length === 0) {
    const [criar, contagem] = await Promise.all([
      podeCriar(consulta),
      consulta<{ n: number }>('SELECT COUNT(*) AS n FROM mysql.user'),
    ]);
    const n = Number(contagem[0]?.n);
    return categoriasDeSeguranca('mysql').map((categoria) =>
      noDeCategoriaDeSeguranca(categoria, 'mysql', criar, Number.isFinite(n) ? n : undefined)
    );
  }
  if (resto.length === 1 && resto[0] === 'users') {
    const f = filtro === null || filtro === undefined
      ? { sql: '', params: [] as unknown[] }
      : { sql: ' WHERE user LIKE ?', params: [filtro] };
    const linhas = await consulta<{ nome: string; host: string }>(
      MYSQL_USUARIOS_SQL.replace('{FILTRO}', f.sql),
      f.params
    );
    return linhas.map((linha) => ({
      // Um usuário do MySQL é o PAR nome@host: `app@localhost` e `app@%` são
      // contas distintas, com senhas e privilégios distintos. Mostrar só o nome
      // faria duas linhas idênticas na árvore.
      id: `${linha.nome}@${linha.host}`,
      label: `${linha.nome}@${linha.host}`,
      icon: 'user' as const,
      hasChildren: false,
      meta: { seguranca: true, papel: linha.nome, host: linha.host },
    }));
  }
  return [];
}
