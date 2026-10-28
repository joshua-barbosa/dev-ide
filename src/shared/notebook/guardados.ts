// O que o `.brnb` guardou e volta como variável num kernel NOVO (relato de 28/10).
//
// O pedido: *"Se está salvando os resultados no próprio arquivo, porque não
// usar os resultados também?"*. Um kernel que sobe — o primeiro, o que voltou
// depois de morrer, o do Reiniciar — recebe a resposta de cada célula HTTP e o
// resultado de cada SQL com nome, como estão na tela. Nada vai de novo ao
// servidor nem ao banco.
//
// Só volta o que o arquivo tem INTEIRO (decisão dele): a resposta HTTP cortada
// em 1 MB, o SQL com mais linhas que as guardadas e o resumo de um "para cada"
// HTTP não viram variável pela metade — viram um aviso para rodar de novo.
import type { CellValue } from '../contracts';
import { SAIDA_HTTP_MAX_BYTES, valorDaVariavel, type SaidaHttp } from './http';
import { tamanhoLegivel } from './http-resposta';
import { nomeValido, type Celula, type Notebook, type Saida } from './modelo';

interface Base {
  /** A célula de onde veio: o aviso aparece embaixo dela. */
  readonly celula: string;
  readonly nome: string;
}

export type Guardado =
  /** HTTP: a variável inteira, como a célula a entregou (vai por `importar`). */
  | (Base & { readonly tipo: 'valor'; readonly valor: unknown })
  /** SQL: colunas e linhas, como o resultado chegou (vai por `definir` — DataFrame no Python). */
  | (Base & { readonly tipo: 'tabela'; readonly colunas: readonly string[]; readonly linhas: readonly (readonly CellValue[])[] })
  /** Rodou, mas o arquivo não tem o valor inteiro. */
  | (Base & { readonly tipo: 'faltando'; readonly motivo: string });

type Tabela = Extract<Saida, { tipo: 'tabela' }>;

const ultima = <T extends Saida>(c: Celula, tipo: T['tipo']): T | undefined =>
  [...c.saidas].reverse().find((s): s is T => s.tipo === tipo);

function daCelula(c: Celula, nome: string): Guardado | null {
  const base = { celula: c.id, nome };
  if (c.tipo === 'http') {
    if (c.paraCada !== null) {
      return c.saidas.length === 0 ? null : {
        ...base, tipo: 'faltando', motivo: 'o arquivo guarda só o resumo do "para cada", não as respostas',
      };
    }
    const r = ultima<SaidaHttp>(c, 'http');
    if (r === undefined) return null;
    return r.truncado
      ? {
        ...base, tipo: 'faltando',
        motivo: `o arquivo guarda só ${tamanhoLegivel(SAIDA_HTTP_MAX_BYTES)} da resposta de ${tamanhoLegivel(r.tamanho)}`,
      }
      : { ...base, tipo: 'valor', valor: valorDaVariavel(r) };
  }
  // SQL: a última tabela é a do último SELECT do bloco — a que ficou na variável.
  const t = ultima<Tabela>(c, 'tabela');
  if (t === undefined) return null;
  return t.linhas.length < t.total
    ? { ...base, tipo: 'faltando', motivo: `o arquivo guarda só ${t.linhas.length} de ${t.total} linhas` }
    : { ...base, tipo: 'tabela', colunas: t.colunas, linhas: t.linhas };
}

/** Um por nome, na ordem das células; o mesmo nome mais abaixo vale mais. */
export function guardadosDoNotebook(nb: Pick<Notebook, 'celulas'>): Guardado[] {
  const porNome = new Map<string, Guardado>();
  for (const c of nb.celulas) {
    if ((c.tipo !== 'http' && c.tipo !== 'sql') || c.nome === null) continue;
    const g = daCelula(c, c.nome);
    if (g === null) continue;
    porNome.delete(g.nome);
    porNome.set(g.nome, g);
  }
  return [...porNome.values()];
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** O que chega ao motor pela rede: só passa o que tem a forma de um `Guardado`. */
export function lerGuardados(v: unknown): Guardado[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((g): Guardado[] => {
    if (!ehObjeto(g) || typeof g.celula !== 'string' || typeof g.nome !== 'string' || !nomeValido(g.nome)) return [];
    const base = { celula: g.celula, nome: g.nome };
    if (g.tipo === 'valor' && 'valor' in g) return [{ ...base, tipo: 'valor', valor: g.valor }];
    if (g.tipo === 'faltando' && typeof g.motivo === 'string') return [{ ...base, tipo: 'faltando', motivo: g.motivo }];
    if (
      g.tipo === 'tabela' && Array.isArray(g.colunas) && g.colunas.every((x) => typeof x === 'string') &&
      Array.isArray(g.linhas) && g.linhas.every(Array.isArray)
    ) {
      return [{ ...base, tipo: 'tabela', colunas: g.colunas as string[], linhas: g.linhas as CellValue[][] }];
    }
    return [];
  });
}
