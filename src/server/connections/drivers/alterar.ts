// Os comandos de alteração de estrutura (spec 046).
//
// **Nada aqui executa.** O comando é montado e a interface o ABRE numa aba
// amarrada à conexão; quem roda é o usuário, com o `▷ Run` da spec 038.
//
// A razão é o perfil de risco: um `UPDATE` de três linhas é instantâneo e se
// desfaz com outro `UPDATE`. Um `ALTER TABLE` numa tabela de 100 milhões de
// linhas reescreve a tabela, tranca por minutos e não tem desfazer — é operação
// de janela de manutenção, não de clique enquanto se navega.
//
// O que muda entre bancos não é só a citação: é o VERBO. O MySQL redeclara a
// coluna inteira num `MODIFY`; o PostgreSQL muda um aspecto por vez; o SQLite
// simplesmente não altera coluna. Um dialeto que "quase" faz é pior que um que
// declara não fazer — por isso `operacoesDisponiveis`.
import { quoteIdentifier, type QuoteStyle } from './sql-base';

export type TipoDeOperacao =
  | 'renomear-tabela'
  | 'comentario-tabela'
  | 'acrescentar-coluna'
  | 'alterar-coluna'
  | 'renomear-coluna'
  | 'apagar-coluna'
  | 'criar-indice'
  | 'apagar-indice'
  | 'apagar-chave-estrangeira';

export type Operacao =
  | { readonly tipo: 'renomear-tabela'; readonly novo: string }
  | { readonly tipo: 'comentario-tabela'; readonly texto: string }
  | {
      readonly tipo: 'acrescentar-coluna' | 'alterar-coluna';
      readonly coluna: string;
      readonly tipoSql: string;
      readonly obrigatoria: boolean;
      readonly padrao: string | null;
    }
  | { readonly tipo: 'renomear-coluna'; readonly coluna: string; readonly novo: string }
  | { readonly tipo: 'apagar-coluna'; readonly coluna: string }
  | {
      readonly tipo: 'criar-indice';
      readonly nome: string;
      readonly colunas: readonly string[];
      readonly unico: boolean;
    }
  | { readonly tipo: 'apagar-indice'; readonly nome: string }
  | { readonly tipo: 'apagar-chave-estrangeira'; readonly nome: string };

export interface Dialeto {
  readonly nome: string;
  readonly estilo: QuoteStyle;
  /** O que ESTE banco sabe fazer. O que não está aqui não vira botão. */
  readonly faz: readonly TipoDeOperacao[];
  /** `DROP INDEX x ON t` no MySQL; `DROP INDEX x` nos outros. */
  readonly dropIndexPrecisaDaTabela: boolean;
  /** `DROP FOREIGN KEY` no MySQL; `DROP CONSTRAINT` no PostgreSQL. */
  readonly verboDropFk: string;
  /** `COMMENT = '...'` no MySQL; `COMMENT ON TABLE` no PostgreSQL. */
  readonly comentarioNoAlter: boolean;
}

const TODAS: readonly TipoDeOperacao[] = [
  'renomear-tabela',
  'comentario-tabela',
  'acrescentar-coluna',
  'alterar-coluna',
  'renomear-coluna',
  'apagar-coluna',
  'criar-indice',
  'apagar-indice',
  'apagar-chave-estrangeira',
];

export const DIALETOS: Readonly<Record<'mysql' | 'postgres' | 'sqlite', Dialeto>> = {
  mysql: {
    nome: 'MySQL',
    estilo: 'backtick',
    faz: TODAS,
    dropIndexPrecisaDaTabela: true,
    verboDropFk: 'DROP FOREIGN KEY',
    comentarioNoAlter: true,
  },
  postgres: {
    nome: 'PostgreSQL',
    estilo: 'double',
    faz: TODAS,
    dropIndexPrecisaDaTabela: false,
    verboDropFk: 'DROP CONSTRAINT',
    comentarioNoAlter: false,
  },
  sqlite: {
    nome: 'SQLite',
    estilo: 'double',
    // O SQLite faz muito pouco de `ALTER TABLE`, e isso não é limitação da IDE:
    // ele nunca teve `MODIFY COLUMN`, não guarda comentário de tabela, e não
    // remove restrição. Quem precisa disso recria a tabela e copia os dados.
    faz: [
      'renomear-tabela',
      'acrescentar-coluna',
      'renomear-coluna',
      'apagar-coluna',
      'criar-indice',
      'apagar-indice',
    ],
    dropIndexPrecisaDaTabela: false,
    verboDropFk: '',
    comentarioNoAlter: false,
  },
};

export function operacoesDisponiveis(dialeto: Dialeto): readonly TipoDeOperacao[] {
  return dialeto.faz;
}

export interface ContextoDeAlteracao {
  /** Nome já qualificado e citado. */
  readonly alvo: string;
  readonly dialeto: Dialeto;
}

/**
 * Um identificador vindo da tela.
 *
 * Recusa em vez de sanear, como a spec 038 fez com nome de arquivo: saneamento
 * silencioso faria o usuário criar uma coluna com nome diferente do que digitou.
 *
 * Espaço é ACEITO: identificador citado pode ter espaço, e recusá-lo impediria
 * de mexer numa tabela que já existe com esse nome. O que se recusa é o vazio e
 * o NUL — este porque `quoteIdentifier` também o recusa, e falhar aqui dá uma
 * mensagem melhor.
 */
function identificador(bruto: unknown, oQue: string): string {
  const nome = typeof bruto === 'string' ? bruto.trim() : '';
  if (nome === '' || nome.includes('\u0000')) {
    throw new Error(`Nome inválido para ${oQue}: ${JSON.stringify(bruto)}.`);
  }
  return nome;
}

/**
 * Um literal de texto, com a aspa dobrada.
 *
 * Não dá para parametrizar comentário nem `DEFAULT` num DDL: o comando é gerado
 * como texto, para o usuário ler. Dobrar a aspa é a barreira que resta.
 */
function literal(texto: string): string {
  return `'${texto.split("'").join("''")}'`;
}

/**
 * O `DEFAULT` de uma coluna.
 *
 * Número e palavra-chave vão crus; o resto vira literal. `CURRENT_TIMESTAMP`
 * entre aspas seria a string, não a função — e o erro só apareceria na primeira
 * linha inserida.
 */
function padraoSql(padrao: string): string {
  const limpo = padrao.trim();
  if (/^-?\d+(\.\d+)?$/.test(limpo)) return limpo;
  if (/^(NULL|TRUE|FALSE|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|NOW\(\))$/i.test(limpo)) {
    return limpo.toUpperCase();
  }
  return literal(limpo);
}

/** Cabeçalho dos destrutivos: o que faz, e que ainda NÃO rodou. */
function aviso(oQueFaz: string): string {
  return (
    `-- ${oQueFaz}\n` +
    '-- Isto ainda NÃO rodou: aperte o ▷ Run acima do comando quando tiver certeza.\n'
  );
}

/** O aviso extra de quem reescreve a tabela inteira. */
const REESCREVE =
  '-- Em tabela grande, isto REESCREVE a tabela: pode trancá-la por minutos.\n';

export function montarAlteracao(ctx: ContextoDeAlteracao, op: Operacao): string {
  const { alvo, dialeto } = ctx;
  const q = (nome: string): string => quoteIdentifier(nome, dialeto.estilo);

  if (!dialeto.faz.includes(op.tipo)) {
    throw new Error(`O ${dialeto.nome} não faz esta operação: ${op.tipo}.`);
  }

  switch (op.tipo) {
    case 'renomear-tabela':
      return `ALTER TABLE ${alvo}\n  RENAME TO ${q(identificador(op.novo, 'a tabela'))};\n`;

    case 'comentario-tabela':
      return dialeto.comentarioNoAlter
        ? `ALTER TABLE ${alvo}\n  COMMENT = ${literal(op.texto)};\n`
        : `COMMENT ON TABLE ${alvo} IS ${literal(op.texto)};\n`;

    case 'acrescentar-coluna':
      return `ALTER TABLE ${alvo}\n  ADD COLUMN ${declaracao(op, q)};\n`;

    case 'alterar-coluna': {
      const coluna = q(identificador(op.coluna, 'a coluna'));
      const tipoSql = tipoValido(op.tipoSql);
      if (dialeto.comentarioNoAlter) {
        // MySQL: `MODIFY` redeclara a coluna inteira. Omitir `NOT NULL` aqui
        // não a mantém obrigatória — ela vira nula. Por isso a declaração
        // completa, e não um pedaço.
        return (
          aviso(`Redeclara a coluna ${op.coluna} de ${alvo}.`) +
          REESCREVE +
          `ALTER TABLE ${alvo}\n  MODIFY COLUMN ${declaracao(op, q)};\n`
        );
      }
      // PostgreSQL: um aspecto por vez, e cada um é um comando.
      const partes = [
        `ALTER TABLE ${alvo}\n  ALTER COLUMN ${coluna} TYPE ${tipoSql};`,
        `ALTER TABLE ${alvo}\n  ALTER COLUMN ${coluna} ` +
          `${op.obrigatoria ? 'SET' : 'DROP'} NOT NULL;`,
        `ALTER TABLE ${alvo}\n  ALTER COLUMN ${coluna} ` +
          (op.padrao === null ? 'DROP DEFAULT;' : `SET DEFAULT ${padraoSql(op.padrao)};`),
      ];
      return (
        aviso(`Altera a coluna ${op.coluna} de ${alvo}, em três comandos.`) +
        REESCREVE +
        `${partes.join('\n\n')}\n`
      );
    }

    case 'renomear-coluna':
      return (
        `ALTER TABLE ${alvo}\n  RENAME COLUMN ${q(identificador(op.coluna, 'a coluna'))} ` +
        `TO ${q(identificador(op.novo, 'a coluna'))};\n`
      );

    case 'apagar-coluna':
      return (
        aviso(`APAGA a coluna ${op.coluna} de ${alvo}, com os dados dela. Não volta.`) +
        REESCREVE +
        `ALTER TABLE ${alvo}\n  DROP COLUMN ${q(identificador(op.coluna, 'a coluna'))};\n`
      );

    case 'criar-indice': {
      if (op.colunas.length === 0) throw new Error('Um índice precisa de ao menos uma coluna.');
      const colunas = op.colunas.map((c) => q(identificador(c, 'a coluna'))).join(', ');
      return (
        `CREATE ${op.unico ? 'UNIQUE ' : ''}INDEX ${q(identificador(op.nome, 'o índice'))}\n` +
        `    ON ${alvo} (${colunas});\n`
      );
    }

    case 'apagar-indice': {
      const nome = q(identificador(op.nome, 'o índice'));
      return (
        aviso(`APAGA o índice ${op.nome}. Consultas que dependiam dele ficam mais lentas.`) +
        (dialeto.dropIndexPrecisaDaTabela
          ? `DROP INDEX ${nome} ON ${alvo};\n`
          : `DROP INDEX ${nome};\n`)
      );
    }

    case 'apagar-chave-estrangeira':
      return (
        aviso(`APAGA a chave estrangeira ${op.nome}. A integridade deixa de ser garantida.`) +
        `ALTER TABLE ${alvo}\n  ${dialeto.verboDropFk} ` +
        `${q(identificador(op.nome, 'a restrição'))};\n`
      );

    default:
      throw new Error(`Operação desconhecida: ${(op as { tipo: string }).tipo}.`);
  }
}

function tipoValido(bruto: unknown): string {
  const tipo = typeof bruto === 'string' ? bruto.trim() : '';
  // Tipo NÃO é identificador: `varchar(255)` e `numeric(10, 2)` têm parênteses
  // e vírgula, e `bigint unsigned` tem espaço. Citá-lo daria `"varchar(255)"`,
  // um nome de tipo inexistente — e recusar espaço impediria metade dos tipos
  // do MySQL. O que dá para exigir é que não esteja vazio e não traga
  // ponto-e-vírgula, que é o que emendaria outro comando.
  if (tipo === '' || tipo.includes(';') || tipo.includes('\u0000')) {
    throw new Error(`Tipo de coluna inválido: ${JSON.stringify(bruto)}.`);
  }
  return tipo;
}

/** `nome tipo [NOT NULL] [DEFAULT x]` — o miolo do ADD e do MODIFY. */
function declaracao(
  op: { coluna: string; tipoSql: string; obrigatoria: boolean; padrao: string | null },
  q: (nome: string) => string
): string {
  const partes = [q(identificador(op.coluna, 'a coluna')), tipoValido(op.tipoSql)];
  if (op.obrigatoria) partes.push('NOT NULL');
  if (op.padrao !== null && op.padrao.trim() !== '') {
    partes.push(`DEFAULT ${padraoSql(op.padrao)}`);
  }
  return partes.join(' ');
}
