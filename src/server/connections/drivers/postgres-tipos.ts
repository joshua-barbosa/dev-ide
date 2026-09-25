// Data e hora do PostgreSQL chegam à tela como o banco as devolveu (spec 110).
//
// Ele (25/09): *"Está adicionando mais 3 horas nas colunas timestamp ou
// datetime"* — e depois: *"se eu to consultando uma query do banco, tem que me
// mostrar exatamente o que está na linha"*, *"não converter horário seja o que
// for"*.
//
// O `pg` transforma `timestamp` (sem fuso) em `Date` lendo-o como hora LOCAL da
// máquina; a célula virava `toISOString()`, em UTC: três horas a mais, com um
// `Z` que o banco nunca afirmou. `date` virava meia-noite local — `T03:00Z`.
//
// Por CLIENTE e não no `pg.types` global: o global valeria para qualquer outro
// código do processo que use `pg`, e esta é uma decisão de TELA.
import { types } from 'pg';
import type { CustomTypesConfig } from 'pg';

/** date, timestamp, timestamptz e os vetores de cada um. */
const DATAS = new Set([1082, 1114, 1184, 1182, 1115, 1185]);

const comoVeio = (valor: string): string => valor;

export const TIPOS_SEM_CONVERSAO: CustomTypesConfig = {
  getTypeParser: ((oid: number, formato?: 'text' | 'binary') =>
    DATAS.has(oid) ? comoVeio : types.getTypeParser(oid, formato)) as CustomTypesConfig['getTypeParser'],
};
