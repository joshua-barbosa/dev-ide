// Os dois primeiros níveis da árvore do PostgreSQL: bancos e schemas.
//
// Saíram do `postgres.ts` quando ele passou do teto de 800 linhas do Artigo IV.
// Ficam juntos porque são o mesmo assunto — o que aparece ANTES de haver
// tabela — e porque os dois vivem da mesma regra de visibilidade
// (`applyVisibility`) e do mesmo `main` no topo.
import type { Client } from 'pg';
import type { TreeNode } from '../types';
import type { Exibicao } from './postgres';
import { applyVisibility, mainFirst } from './sql-base';
import { BANCOS_SQL, SCHEMAS_SQL } from './postgres-sql';

export async function listarBancos(client: Client, exibicao: Exibicao): Promise<TreeNode[]> {
  const { rows } = await client.query<{ nome: string; tamanho: string | null }>(BANCOS_SQL);
  const visiveis = applyVisibility(rows, (linha) => linha.nome, exibicao.bancos);

  return mainFirst(visiveis, exibicao.main, (linha) => linha.nome).map((linha) => ({
    id: linha.nome,
    label: linha.nome,
    icon: 'database' as const,
    detail: linha.tamanho ?? undefined,
    hasChildren: true,
    meta: { database: linha.nome, main: linha.nome === exibicao.main },
  }));
}

export async function listarSchemas(client: Client, exibicao: Exibicao): Promise<TreeNode[]> {
  const { rows } = await client.query<{ schema: string; tamanho: string }>(SCHEMAS_SQL);
  const visiveis = applyVisibility(rows, (linha) => linha.schema, exibicao.schemas);

  return visiveis.map((linha) => ({
    id: linha.schema,
    label: linha.schema,
    icon: 'schema' as const,
    detail: linha.tamanho === '0 bytes' ? undefined : linha.tamanho,
    hasChildren: true,
    // T064: o diagrama é do SCHEMA. Quem diz ONDE ele cabe é o nó — a interface
    // não conhece a forma do caminho de cada driver, e não deve conhecer.
    meta: { schema: linha.schema, diagramaEr: true },
  }));
}
