// `Security` do PostgreSQL: `Users` e `Roles` (N003, spec 069).
//
// Os dois saem da MESMA tabela — `pg_roles` —, e o que os separa é uma bandeira:
// `rolcanlogin`. No PostgreSQL um usuário É um papel que pode entrar; a
// ferramenta de referência mostra os dois separados porque é assim que se pensa
// neles, não porque o catálogo os separe.
import type { Client } from 'pg';
import {
  PG_PAPEIS_SQL,
  PG_PODE_CRIAR_SQL,
  categoriasDeSeguranca,
  noDeCategoriaDeSeguranca,
  podeCriarNoPostgres,
  sondar,
  ACOES_DE_USUARIO,
  ACOES_DA_CATEGORIA_DE_USUARIOS,
} from './seguranca';
import { clausulaDeFiltro } from './postgres-objetos';
import type { TreeNode } from '../types';

interface LinhaDePapel {
  readonly nome: string;
  readonly super: boolean;
  readonly cria_papel: boolean;
  readonly cria_banco: boolean;
  readonly validade: Date | null;
}

/**
 * O nó `Security`, ou `false` quando este usuário não pode nem LISTAR.
 *
 * A sonda é a própria consulta, com `LIMIT 1`: perguntar "eu poderia?" por
 * outro caminho seria uma segunda fonte de verdade, e as duas divergiriam no
 * dia em que o servidor tivesse uma política que o catálogo não descreve.
 *
 * **Nenhum erro daqui sobe** — mesma razão do MySQL: é pergunta lateral feita
 * enquanto se lista os bancos, e não pode derrubar a lista.
 */
export async function segurancaDisponivel(client: Client): Promise<boolean> {
  try {
    return (await sondar(() => client.query('SELECT 1 FROM pg_roles LIMIT 1'))) !== null;
  } catch {
    return false;
  }
}

/** As marcas de um papel, na coluna cinza da árvore. */
function marcasDe(linha: LinhaDePapel): string | undefined {
  const marcas: string[] = [];
  if (linha.super) marcas.push('SUPERUSER');
  if (linha.cria_papel) marcas.push('CREATEROLE');
  if (linha.cria_banco) marcas.push('CREATEDB');
  if (linha.validade !== null) marcas.push(`até ${linha.validade.toISOString().slice(0, 10)}`);
  return marcas.length === 0 ? undefined : marcas.join(' · ');
}

async function listarPapeis(
  client: Client,
  podeEntrar: boolean,
  filtro?: string | null
): Promise<TreeNode[]> {
  const f = clausulaDeFiltro('r.rolname', 2, filtro);
  const { rows } = await client.query<LinhaDePapel>(
    PG_PAPEIS_SQL.replace('{FILTRO}', f.sql),
    [podeEntrar, ...f.params]
  );
  return rows.map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: (podeEntrar ? 'user' : 'role') as TreeNode['icon'],
    detail: marcasDe(linha),
    hasChildren: false,
    meta: { seguranca: true, papel: linha.nome },
    // Todas COPIAM o SQL; nenhuma executa (P3).
    actions: ACOES_DE_USUARIO,
  }));
}

export async function listarSeguranca(
  client: Client,
  resto: readonly string[],
  filtro?: string | null
): Promise<TreeNode[]> {
  if (resto.length === 0) {
    const linha = await client.query<{ rolsuper: boolean; rolcreaterole: boolean }>(
      PG_PODE_CRIAR_SQL
    );
    const podeCriar = podeCriarNoPostgres(linha.rows[0]);
    const { rows } = await client.query<{ entram: string; papeis: string }>(
      `SELECT COUNT(*) FILTER (WHERE rolcanlogin) AS entram,
              COUNT(*) FILTER (WHERE NOT rolcanlogin) AS papeis
         FROM pg_roles`
    );
    const quantos = rows[0];
    return categoriasDeSeguranca('postgres').map((categoria) => {
      const bruto = categoria.id === 'users' ? quantos?.entram : quantos?.papeis;
      const n = Number(bruto);
      // Zero é resposta: "nenhum papel" e "não sei quantos" são coisas
      // diferentes, e a spec 045 já paga esse preço em outro lugar.
      return {
        ...noDeCategoriaDeSeguranca(
          categoria,
          'postgres',
          podeCriar,
          Number.isFinite(n) ? n : undefined
        ),
        ...(categoria.id === 'users' ? { actions: ACOES_DA_CATEGORIA_DE_USUARIOS } : {}),
      };
    });
  }
  if (resto.length === 1 && (resto[0] === 'users' || resto[0] === 'roles')) {
    return listarPapeis(client, resto[0] === 'users', filtro);
  }
  return [];
}
