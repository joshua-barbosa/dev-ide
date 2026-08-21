// Os modelos de SQL do menu de tabela (spec 040).
//
// Lógica pura, sem rede: montar `INSERT` e `UPDATE` é a parte que dá errado em
// silêncio — coluna de auto-incremento incluída, `WHERE` faltando num `DELETE`
// — e é a que dá para testar sem nenhum banco de pé.
//
// **Nada aqui executa.** As ações de menu geram SQL e a interface o ABRE numa
// aba; quem roda é o usuário, com o `▷ Run` que a spec 038 pôs acima de cada
// statement. É a mesma decisão da spec 018, e agora ela custa um clique.
import { quoteIdentifier, type QuoteStyle } from './sql-base';

export interface ColunaDeModelo {
  readonly nome: string;
  /** Tipo declarado, mostrado em comentário: é o que decide se vai aspa. */
  readonly tipo: string;
  /** Faz parte da chave primária. */
  readonly chave: boolean;
  /** O banco preenche sozinho — não entra no `INSERT`. */
  readonly autoIncremento: boolean;
}

export interface ContextoDeModelo {
  /** Nome já qualificado e citado, ex.: `` `escola`.`alunos` ``. */
  readonly alvo: string;
  readonly colunas: readonly ColunaDeModelo[];
  readonly estilo: QuoteStyle;
}

/** As ações que o menu de uma TABELA oferece, na ordem em que aparecem. */
export const ACOES_DE_TABELA: readonly { id: string; label: string; danger?: boolean }[] = [
  { id: 'select', label: 'Abrir Query' },
  { id: 'ddl', label: 'Ver DDL' },
  { id: 'count', label: 'Contar linhas (exato)' },
  { id: 'template-select', label: 'SELECT' },
  { id: 'template-insert', label: 'INSERT' },
  { id: 'template-update', label: 'UPDATE' },
  { id: 'template-delete', label: 'DELETE' },
  { id: 'copiar', label: 'Copiar tabela' },
  { id: 'truncate', label: 'Esvaziar (TRUNCATE)', danger: true },
  { id: 'drop', label: 'Apagar (DROP)', danger: true },
] as const;

/**
 * O menu do SQLite, sem `TRUNCATE`.
 *
 * **O SQLite não tem `TRUNCATE`** — nunca teve. Ele otimiza `DELETE FROM t` sem
 * `WHERE` para o mesmo efeito, e é isso que o modelo gera. Oferecer um item que
 * o banco recusaria seria pior que não oferecer.
 */
export const ACOES_DE_TABELA_SQLITE: readonly { id: string; label: string; danger?: boolean }[] =
  ACOES_DE_TABELA.map((a) =>
    a.id === 'truncate' ? { id: 'esvaziar', label: 'Esvaziar (DELETE)', danger: true } : a
  );

/** O menu de uma VIEW é menor: não há o que inserir nem o que esvaziar. */
export const ACOES_DE_VIEW: readonly { id: string; label: string; danger?: boolean }[] = [
  { id: 'select', label: 'Abrir Query' },
  { id: 'ddl', label: 'Ver DDL' },
  { id: 'template-select', label: 'SELECT' },
  { id: 'drop-view', label: 'Apagar view (DROP)', danger: true },
];

/** Marcador de valor a preencher, com o tipo ao lado para orientar. */
function marcador(coluna: ColunaDeModelo): string {
  return `:${coluna.nome}`;
}

function listaDeColunas(colunas: readonly ColunaDeModelo[], estilo: QuoteStyle): string {
  return colunas.map((c) => quoteIdentifier(c.nome, estilo)).join(', ');
}

/**
 * O `WHERE` do `UPDATE` e do `DELETE`.
 *
 * Sem chave primária ele vira **`WHERE 1 = 0`**, que não casa com nada.
 *
 * A primeira versão comentava o `WHERE` inteiro, e isso era um **desastre**: o
 * `;` terminador ficava dentro do comentário, e o que chegava ao banco era
 * `DELETE FROM tabela` — sem cláusula nenhuma, apagando tudo. O banco ignora
 * comentário; a proteção que só existe em comentário não existe.
 *
 * `1 = 0` é sintaxe de verdade, sobrevive ao `▷ Run` e afeta zero linhas. O
 * "0 linha(s) afetada(s)" é o aviso que o usuário lê quando esquece de trocar.
 *
 * Encontrado contra o banco do usuário, na tabela `alternativas_backup`.
 */
function clausulaWhere(colunas: readonly ColunaDeModelo[], estilo: QuoteStyle): string {
  const chaves = colunas.filter((c) => c.chave);
  if (chaves.length === 0) {
    return (
      'WHERE 1 = 0 -- TROQUE: esta tabela não tem chave primária.\n' +
      '   -- `1 = 0` não casa com nada, de propósito. Sem um WHERE de verdade,\n' +
      '   -- o comando pegaria a TABELA INTEIRA.'
    );
  }
  const condicao = chaves
    .map((c) => `${quoteIdentifier(c.nome, estilo)} = ${marcador(c)}`)
    .join(' AND ');
  return `WHERE ${condicao}`;
}

/** Cabeçalho dos destrutivos: diz o que faz e que ainda NÃO rodou. */
function aviso(oQueFaz: string): string {
  return (
    `-- ${oQueFaz}\n` +
    '-- Isto ainda NÃO rodou: aperte o ▷ Run acima do comando quando tiver certeza.\n'
  );
}

/**
 * Põe o `;` no fim da última linha que NÃO é comentário.
 *
 * Escrever `${clausula};` parece igual e não é: quando a cláusula termina em
 * comentário, o `;` vai para dentro dele e some. O statement chega ao banco sem
 * terminador — e, pior, sem a cláusula.
 */
function terminar(clausula: string): string {
  const linhas = clausula.split('\n');
  for (let i = linhas.length - 1; i >= 0; i -= 1) {
    const linha = linhas[i] ?? '';
    if (!linha.trim().startsWith('--')) {
      // O `;` entra ANTES do comentário de fim de linha, se houver um.
      const corte = linha.indexOf('--');
      linhas[i] = corte === -1
        ? `${linha.trimEnd()};`
        : `${linha.slice(0, corte).trimEnd()}; ${linha.slice(corte)}`;
      return linhas.join('\n');
    }
  }
  return clausula;
}

function comentarioDeTipos(colunas: readonly ColunaDeModelo[]): string {
  if (colunas.length === 0) return '';
  return `-- ${colunas.map((c) => `${c.nome}: ${c.tipo}`).join(' · ')}\n`;
}

export function modeloSql(acaoId: string, ctx: ContextoDeModelo): string {
  const { alvo, colunas, estilo } = ctx;

  switch (acaoId) {
    case 'template-select': {
      // Sem colunas conhecidas o `*` é o que resta — e é melhor que um
      // `SELECT  FROM`, que nem chega ao banco.
      if (colunas.length === 0) return `SELECT * FROM ${alvo} LIMIT 100;\n`;
      return `SELECT ${listaDeColunas(colunas, estilo)}\n  FROM ${alvo}\n LIMIT 100;\n`;
    }

    case 'template-insert': {
      // O banco preenche a coluna de auto-incremento; incluí-la é o erro mais
      // comum de quem escreve `INSERT` à mão.
      const preenchiveis = colunas.filter((c) => !c.autoIncremento);
      if (preenchiveis.length === 0) {
        return (
          '-- Todas as colunas são preenchidas pelo banco.\n' +
          `INSERT INTO ${alvo} DEFAULT VALUES;\n`
        );
      }
      return (
        comentarioDeTipos(preenchiveis) +
        `INSERT INTO ${alvo} (${listaDeColunas(preenchiveis, estilo)})\n` +
        `VALUES (${preenchiveis.map(marcador).join(', ')});\n`
      );
    }

    case 'template-update': {
      // A chave fica FORA do SET: trocar a chave da mesma linha que se está
      // achando por ela é o caminho mais curto para um estrago.
      const atualizaveis = colunas.filter((c) => !c.chave);
      const sets = (atualizaveis.length === 0 ? colunas : atualizaveis)
        .map((c) => `${quoteIdentifier(c.nome, estilo)} = ${marcador(c)}`)
        .join(',\n       ');
      return (
        comentarioDeTipos(colunas) +
        `UPDATE ${alvo}\n   SET ${sets}\n ${terminar(clausulaWhere(colunas, estilo))}\n`
      );
    }

    case 'template-delete':
      return `DELETE FROM ${alvo}\n ${terminar(clausulaWhere(colunas, estilo))}\n`;

    case 'copiar': {
      // Cria e carrega, em dois comandos, para o usuário poder rodar só o
      // primeiro se quiser a estrutura sem os dados.
      const copia = nomeDaCopia(alvo, estilo);
      return (
        aviso(`Cria ${copia} com a estrutura e os dados de ${alvo}.`) +
        `CREATE TABLE ${copia} AS SELECT * FROM ${alvo} WHERE 1 = 0;\n\n` +
        `INSERT INTO ${copia} SELECT * FROM ${alvo};\n`
      );
    }

    case 'truncate':
      return (
        aviso(`APAGA TODAS AS LINHAS de ${alvo}. A estrutura fica; os dados não voltam.`) +
        `TRUNCATE TABLE ${alvo};\n`
      );

    // O SQLite não tem TRUNCATE; `DELETE` sem `WHERE` é o equivalente, e ele
    // próprio o otimiza para o mesmo caminho.
    case 'esvaziar':
      return (
        aviso(`APAGA TODAS AS LINHAS de ${alvo}. A estrutura fica; os dados não voltam.`) +
        `DELETE FROM ${alvo};\n`
      );

    case 'drop':
      return (
        aviso(`APAGA A TABELA ${alvo} inteira — estrutura e dados. Não volta.`) +
        `DROP TABLE ${alvo};\n`
      );

    case 'drop-view':
      return (
        aviso(`APAGA A VIEW ${alvo}. A tabela por trás dela não é tocada.`) +
        `DROP VIEW ${alvo};\n`
      );

    default:
      throw new Error(`Ação desconhecida: ${acaoId}`);
  }
}

/**
 * O nome sugerido para a cópia.
 *
 * Sufixa o último pedaço do nome qualificado, para a cópia nascer no MESMO
 * schema — `escola.alunos` vira `escola.alunos_copia`, e não `alunos_copia`
 * solto no schema em que a conexão estiver.
 */
function nomeDaCopia(alvo: string, estilo: QuoteStyle): string {
  const partes = alvo.split('.');
  const ultima = partes[partes.length - 1] ?? alvo;
  const quote = estilo === 'backtick' ? '`' : '"';
  const cru = ultima.startsWith(quote) ? ultima.slice(1, -1).split(quote + quote).join(quote) : ultima;
  partes[partes.length - 1] = quoteIdentifier(`${cru}_copia`, estilo);
  return partes.join('.');
}
