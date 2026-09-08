// Ver, ATUALIZAR e apagar uma rotina: procedure, function, trigger e event.
//
// Ele, em 08/09/2026: *"As functions, procedures não consigo abrir para ver o
// que está na estrutura E também não tenho a opção de atualizar a procedures ou
// functions"*, e logo depois: *"Ou eventos"*. E antes disso: *"Eu tentei abrir
// uma procedure e deu erro"*.
//
// **Não era defeito da extensão.** No motor, uma rotina não recebia ação
// NENHUMA — nem `Ver DDL`. A lista abria, parecia completa, e não havia o que
// clicar. A IDE tinha exatamente o mesmo buraco: por isso o conserto mora aqui,
// no driver, e as duas telas ganham junto.
//
// **Nada roda por clique** (spec 040): `Atualizar` GERA o SQL e o abre, com o
// aviso dentro do texto — que é onde ele é lido.
import type { NodeAction } from '../types';

/** As categorias de árvore que são rotina. */
export type CategoriaDeRotina = 'procedures' | 'functions' | 'triggers' | 'events';

const CATEGORIAS: readonly CategoriaDeRotina[] = [
  'procedures',
  'functions',
  'triggers',
  'events',
];

export function ehRotina(categoria: string): categoria is CategoriaDeRotina {
  return (CATEGORIAS as readonly string[]).includes(categoria);
}

/**
 * A rotina inteira, como o driver a conhece.
 *
 * Vem crua E citada de propósito: o Postgres procura o gatilho por TEXTO em
 * `pg_trigger` (nome cru), e o MySQL o apaga por IDENTIFICADOR (nome citado).
 * Passar só um dos dois obrigaria este módulo a citar — e a citação é de cada
 * banco, com regra própria de escape.
 */
export interface AlvoDeRotina {
  readonly categoria: string;
  /** O esquema, cru. */
  readonly schema: string;
  /** O nome da rotina, cru. */
  readonly objeto: string;
  /** Esquema e nome já citados: `` `app`.`fecha_mes` `` ou `"app"."idade"`. */
  readonly citado: string;
  /** A tabela do gatilho, crua. Só gatilho tem. */
  readonly tabela?: string;
  /** A tabela do gatilho, citada e qualificada. */
  readonly tabelaCitada?: string;
  /** Só o nome, citado e SEM esquema — é assim que o Postgres apaga gatilho. */
  readonly nomeCitado?: string;
}

/**
 * O que se pode fazer com uma rotina.
 *
 * `Ver DDL` vem primeiro porque é o que ele foi procurar: abrir para ler. Os
 * ids são próprios (`-rotina`) e não reaproveitam `ddl`/`drop`, porque o
 * caminho no driver é outro — `SHOW CREATE TABLE` numa procedure é o erro que
 * ele viu.
 */
export const ACOES_DE_ROTINA: readonly NodeAction[] = [
  { id: 'ddl-rotina', label: 'Ver DDL' },
  { id: 'atualizar-rotina', label: 'Atualizar…' },
  { id: 'drop-rotina', label: 'Apagar (DROP)', danger: true },
];

/**
 * O que o CLIQUE numa rotina faz: abre o DDL.
 *
 * Ele, em 08/09/2026: *"não consigo abrir para ver o que está na estrutura"* e
 * *"tentei abrir uma procedure e deu erro"*. O clique caía no `SELECT * FROM`,
 * e `SELECT * FROM minha_procedure` não existe.
 *
 * Vai no `meta` porque quem decide é o NÓ (Artigo III): a IDE e a extensão leem
 * a mesma coisa, e nenhuma das duas precisa saber o que é uma procedure.
 */
export const META_DE_ROTINA = { acaoAoClicar: 'ddl-rotina' } as const;

/** A palavra do objeto no SQL: `PROCEDURE`, `FUNCTION`, `TRIGGER`, `EVENT`. */
export function palavraDaRotina(categoria: CategoriaDeRotina): string {
  return {
    procedures: 'PROCEDURE',
    functions: 'FUNCTION',
    triggers: 'TRIGGER',
    events: 'EVENT',
  }[categoria];
}

/** Um texto como literal SQL, com a aspa simples dobrada. */
function literal(texto: string): string {
  return `'${texto.replace(/'/g, "''")}'`;
}

const GATILHO_PG_SQL = `SELECT pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname = {SCHEMA} AND c.relname = {TABELA} AND t.tgname = {NOME}`;

/**
 * O comando que LÊ a definição, ou `null` quando não há um.
 *
 * `null` em vez de um comando genérico de propósito: quem chamar com a
 * categoria errada erra alto, aqui, em vez de mandar `SHOW CREATE TABLE` para o
 * servidor e receber uma recusa que chega à tela dele como "deu erro".
 */
export function comandoDeDdlDeRotina(
  banco: 'mysql' | 'postgres',
  alvo: AlvoDeRotina
): string | null {
  const { categoria } = alvo;
  if (!ehRotina(categoria)) return null;

  if (banco === 'mysql') {
    return `SHOW CREATE ${palavraDaRotina(categoria)} ${alvo.citado}`;
  }

  // O Postgres não tem EVENT, e `pg_get_functiondef` não enxerga gatilho:
  // gatilho tem função DE dentro, e o que se quer ler é o `CREATE TRIGGER`.
  if (categoria === 'events') return null;
  if (categoria === 'triggers') {
    if (alvo.tabela === undefined) return null;
    return GATILHO_PG_SQL.replace('{SCHEMA}', literal(alvo.schema))
      .replace('{TABELA}', literal(alvo.tabela))
      .replace('{NOME}', literal(alvo.objeto));
  }

  // Devolve o `CREATE OR REPLACE` inteiro e pronto — não há o que remontar, e
  // remontar seria perder `LANGUAGE`, `VOLATILE` e o corpo exato.
  return `SELECT pg_get_functiondef(${literal(`${alvo.schema}.${alvo.objeto}`)}::regproc) AS def`;
}

/** O `DROP` da rotina, GERADO e aberto — nunca executado (spec 040). */
export function comandoDeDropDeRotina(
  banco: 'mysql' | 'postgres',
  alvo: AlvoDeRotina
): string | null {
  const { categoria } = alvo;
  if (!ehRotina(categoria)) return null;
  const palavra = palavraDaRotina(categoria);
  const cabecalho =
    `-- Apaga ${palavra.toLowerCase()} ${alvo.citado}.\n` +
    '-- Isto ainda NÃO rodou: aperte o ▷ Run acima do comando quando tiver certeza.\n';

  if (banco === 'postgres' && categoria === 'triggers') {
    // Gatilho do Postgres pende da TABELA: sem o `ON`, o comando nem existe.
    if (alvo.tabelaCitada === undefined || alvo.nomeCitado === undefined) return null;
    return `${cabecalho}DROP TRIGGER IF EXISTS ${alvo.nomeCitado} ON ${alvo.tabelaCitada};\n`;
  }
  if (banco === 'postgres' && categoria === 'events') return null;

  return `${cabecalho}DROP ${palavra} IF EXISTS ${alvo.citado};\n`;
}

const AVISO =
  '-- Isto ainda NÃO rodou: revise e aperte o ▷ Run acima do comando quando\n' +
  '-- tiver certeza. O corpo abaixo é o que está NO SERVIDOR agora.\n' +
  '-- Sem linhas de DELIMITER: são do cliente `mysql`, não do servidor.\n';

/**
 * Põe esquema no nome do `CREATE`, quando o servidor o devolveu sem.
 *
 * O `SHOW CREATE PROCEDURE` do MySQL devolve `CREATE ... PROCEDURE \`nome\``,
 * SEM o esquema. Rodar isso com outro banco ativo no editor apagaria a rotina
 * de um esquema e a criaria noutro — calado, e é o tipo de estrago que só
 * aparece dias depois.
 */
function qualificarCreate(corpo: string, palavra: string, citado: string): string {
  const nome = '(?:`(?:[^`]|``)*`|[A-Za-z0-9_$]+)';
  const alvo = new RegExp(`(\\bCREATE\\b[\\s\\S]{0,300}?\\b${palavra}\\s+)${nome}(\\s*\\.\\s*${nome})?`, 'i');
  return corpo.replace(alvo, (inteiro, prefixo: string) =>
    // `replace` com função não interpreta `$&` no retorno — o corpo da rotina
    // pode ter `$$`, e a forma de string o comeria.
    typeof prefixo === 'string' ? `${prefixo}${citado}` : inteiro
  );
}

/**
 * O esqueleto para atualizar a rotina, a partir do corpo que está no servidor.
 *
 * **Sem corpo lido, recusa.** Devolver um `CREATE ... BEGIN END` vazio seria
 * oferecer a ele APAGAR o corpo da rotina achando que a está atualizando — um
 * estrago silencioso, e irreversível do lado de lá.
 */
export function esqueletoDeAtualizacao(
  banco: 'mysql' | 'postgres',
  alvo: AlvoDeRotina,
  corpoAtual: string
): string {
  const { categoria } = alvo;
  if (!ehRotina(categoria)) {
    throw new Error(`"${categoria}" não é uma rotina.`);
  }
  const corpo = corpoAtual.trim();
  if (corpo === '') {
    throw new Error(
      'Não consegui ler a definição atual no servidor. Sem ela, um esqueleto ' +
        'em branco apagaria o corpo da rotina em vez de atualizá-lo.'
    );
  }

  if (banco === 'postgres') {
    if (categoria === 'events') {
      throw new Error('O PostgreSQL não tem EVENT.');
    }
    if (categoria === 'triggers') {
      // `CREATE OR REPLACE TRIGGER` só existe do PG14 para cima, e o
      // `pg_get_triggerdef` devolve `CREATE TRIGGER` seco: DROP e recria.
      if (alvo.tabelaCitada === undefined || alvo.nomeCitado === undefined) {
        throw new Error('Gatilho sem tabela: não dá para montar o DROP.');
      }
      return (
        `${AVISO}\n` +
        `DROP TRIGGER IF EXISTS ${alvo.nomeCitado} ON ${alvo.tabelaCitada};\n\n` +
        `${corpo};\n`
      );
    }
    // `pg_get_functiondef` já vem como `CREATE OR REPLACE`: editar e rodar
    // substitui no lugar, sem janela em que a função não existe.
    return `${AVISO}\n${corpo};\n`;
  }

  // O MySQL não tem `CREATE OR REPLACE` para rotina: o caminho é DROP e criar
  // de novo. O `IF EXISTS` evita que a primeira metade falhe sozinha e deixe o
  // resto sem rodar.
  const palavra = palavraDaRotina(categoria);
  return (
    `${AVISO}\n` +
    `DROP ${palavra} IF EXISTS ${alvo.citado};\n\n` +
    `${qualificarCreate(corpo, palavra, alvo.citado)}\n`
  );
}

/**
 * As três ações de rotina, resolvidas de uma vez para qualquer driver SQL.
 *
 * Mora aqui, e não em cada driver, porque a sequência é a mesma nos dois — ler
 * o corpo, e então mostrar OU montar o esqueleto — e porque o `postgres.ts`
 * passou das 800 linhas do Artigo IV ao ganhar a sua cópia.
 *
 * `ler` é do driver: só ele sabe de onde sai o texto (uma coluna que muda de
 * nome no MySQL, a coluna `def` no Postgres).
 *
 * Devolve `null` quando a ação não é de rotina, para o `switch` seguir adiante.
 */
export async function acaoDeRotina(
  banco: 'mysql' | 'postgres',
  actionId: string,
  alvo: AlvoDeRotina,
  ler: (sql: string) => Promise<string>
): Promise<{ kind: 'text' | 'statement'; title: string; content: string } | null> {
  if (actionId !== 'ddl-rotina' && actionId !== 'atualizar-rotina' && actionId !== 'drop-rotina') {
    return null;
  }
  const { objeto } = alvo;

  if (actionId === 'drop-rotina') {
    const sql = comandoDeDropDeRotina(banco, alvo);
    if (sql === null) throw new Error(`Não há DROP para "${alvo.categoria}" aqui.`);
    return { kind: 'statement', title: objeto, content: sql };
  }

  const leitura = comandoDeDdlDeRotina(banco, alvo);
  if (leitura === null) throw new Error(`"${alvo.categoria}" não é uma rotina aqui.`);
  const corpo = await ler(leitura);

  if (actionId === 'ddl-rotina') {
    if (corpo.trim() === '') throw new Error(`Não foi possível ler o DDL de ${objeto}.`);
    return { kind: 'text', title: `${objeto} (DDL)`, content: corpo };
  }
  return {
    kind: 'statement',
    title: `${objeto} (atualizar)`,
    content: esqueletoDeAtualizacao(banco, alvo, corpo),
  };
}
