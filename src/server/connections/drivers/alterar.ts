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
  | 'apagar-chave-estrangeira'
  // Spec 069 (T065, T066, T067)
  | 'criar-chave-estrangeira'
  | 'criar-checagem'
  | 'apagar-checagem'
  | 'criar-gatilho'
  | 'apagar-gatilho'
  | 'colacao-tabela'
  | 'colacao-coluna';

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
  | { readonly tipo: 'apagar-chave-estrangeira'; readonly nome: string }
  | {
      readonly tipo: 'criar-chave-estrangeira';
      readonly nome: string;
      readonly coluna: string;
      readonly tabelaRef: string;
      readonly colunaRef: string;
      /** `NO ACTION`, `CASCADE`, `SET NULL`, `RESTRICT` — validadas na geração. */
      readonly aoAtualizar: string;
      readonly aoApagar: string;
    }
  | { readonly tipo: 'criar-checagem'; readonly nome: string; readonly expressao: string }
  | { readonly tipo: 'apagar-checagem'; readonly nome: string }
  | {
      readonly tipo: 'criar-gatilho';
      readonly nome: string;
      readonly momento: string;
      readonly evento: string;
      /** MySQL e SQLite: o corpo. PostgreSQL: o NOME DA FUNÇÃO que ele chama. */
      readonly corpo: string;
    }
  | { readonly tipo: 'apagar-gatilho'; readonly nome: string }
  | { readonly tipo: 'colacao-tabela'; readonly colacao: string; readonly conjunto: string }
  | {
      readonly tipo: 'colacao-coluna';
      readonly coluna: string;
      readonly tipoSql: string;
      readonly colacao: string;
    };

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
  /** `DROP CHECK` no MySQL; `DROP CONSTRAINT` no PostgreSQL (spec 069). */
  readonly verboDropCheck: string;
  /**
   * O gatilho chama uma FUNÇÃO em vez de trazer o corpo (PostgreSQL).
   *
   * Não é detalhe de sintaxe: a função precisa EXISTIR antes. Gerar um
   * `CREATE TRIGGER` sozinho no PostgreSQL produz um comando que o banco
   * recusa, e prometer "criar gatilho" assim seria a pior versão da feature.
   */
  readonly gatilhoPrecisaDeFuncao: boolean;
  /** `DROP TRIGGER n ON tabela` no PostgreSQL; `DROP TRIGGER n` nos outros. */
  readonly dropGatilhoPrecisaDaTabela: boolean;
}

const COMUNS: readonly TipoDeOperacao[] = [
  'renomear-tabela',
  'comentario-tabela',
  'acrescentar-coluna',
  'alterar-coluna',
  'renomear-coluna',
  'apagar-coluna',
  'criar-indice',
  'apagar-indice',
  'apagar-chave-estrangeira',
  // Spec 069: restrições e gatilhos, nos dois bancos que fazem `ALTER` de
  // verdade. O SQLite não entra — ver a nota no dialeto dele.
  'criar-chave-estrangeira',
  'criar-checagem',
  'apagar-checagem',
  'criar-gatilho',
  'apagar-gatilho',
];

export const DIALETOS: Readonly<Record<'mysql' | 'postgres' | 'sqlite', Dialeto>> = {
  mysql: {
    nome: 'MySQL',
    estilo: 'backtick',
    faz: [...COMUNS, 'colacao-tabela'],
    dropIndexPrecisaDaTabela: true,
    verboDropFk: 'DROP FOREIGN KEY',
    comentarioNoAlter: true,
    verboDropCheck: 'DROP CHECK',
    gatilhoPrecisaDeFuncao: false,
    dropGatilhoPrecisaDaTabela: false,
  },
  postgres: {
    nome: 'PostgreSQL',
    estilo: 'double',
    faz: [...COMUNS, 'colacao-coluna'],
    dropIndexPrecisaDaTabela: false,
    verboDropFk: 'DROP CONSTRAINT',
    comentarioNoAlter: false,
    verboDropCheck: 'DROP CONSTRAINT',
    gatilhoPrecisaDeFuncao: true,
    dropGatilhoPrecisaDaTabela: true,
  },
  sqlite: {
    nome: 'SQLite',
    estilo: 'double',
    // O SQLite faz muito pouco de `ALTER TABLE`, e isso não é limitação da IDE:
    // ele nunca teve `MODIFY COLUMN`, não guarda comentário de tabela, e não
    // remove restrição. Quem precisa disso recria a tabela e copia os dados.
    // Gatilho o SQLite FAZ — `CREATE TRIGGER` e `DROP TRIGGER` existem desde
    // sempre. O que ele não faz é acrescentar restrição a uma tabela pronta:
    // chave estrangeira e checagem só entram no `CREATE TABLE`, e mudá-las
    // exige recriar a tabela e copiar os dados. Declarar que faz e gerar um
    // ALTER que o banco recusa seria pior que não oferecer.
    faz: [
      'renomear-tabela',
      'acrescentar-coluna',
      'renomear-coluna',
      'apagar-coluna',
      'criar-indice',
      'apagar-indice',
      'criar-gatilho',
      'apagar-gatilho',
    ],
    dropIndexPrecisaDaTabela: false,
    verboDropFk: '',
    comentarioNoAlter: false,
    verboDropCheck: '',
    gatilhoPrecisaDeFuncao: false,
    dropGatilhoPrecisaDaTabela: false,
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

    case 'criar-chave-estrangeira': {
      // A FK nova valida a tabela INTEIRA na hora de criar: numa tabela grande
      // isso é uma varredura, e é por isso que ela sai gerada e não executada.
      const nome = q(identificador(op.nome, 'a restrição'));
      const coluna = q(identificador(op.coluna, 'a coluna'));
      const tabelaRef = q(identificador(op.tabelaRef, 'a tabela referenciada'));
      const colunaRef = q(identificador(op.colunaRef, 'a coluna referenciada'));
      return (
        '-- Cria a chave estrangeira. O banco VALIDA as linhas existentes: numa\n' +
        '-- tabela grande isto varre a tabela inteira, e falha se houver órfã.\n' +
        '-- Isto ainda NÃO rodou: aperte o ▷ Run acima do comando quando tiver certeza.\n' +
        `ALTER TABLE ${alvo}\n` +
        `  ADD CONSTRAINT ${nome} FOREIGN KEY (${coluna})\n` +
        `  REFERENCES ${tabelaRef} (${colunaRef})\n` +
        `  ON UPDATE ${regraDeIntegridade(op.aoAtualizar)}\n` +
        `  ON DELETE ${regraDeIntegridade(op.aoApagar)};\n`
      );
    }

    case 'criar-checagem': {
      const nome = q(identificador(op.nome, 'a checagem'));
      return (
        '-- Cria a checagem. As linhas que já existem são validadas agora, e o\n' +
        '-- comando falha se alguma não passar.\n' +
        '-- Isto ainda NÃO rodou: aperte o ▷ Run acima do comando quando tiver certeza.\n' +
        `ALTER TABLE ${alvo}\n  ADD CONSTRAINT ${nome} CHECK (${expressaoValida(op.expressao)});\n`
      );
    }

    case 'apagar-checagem':
      return (
        aviso(`APAGA a checagem ${op.nome}. A regra deixa de ser garantida pelo banco.`) +
        `ALTER TABLE ${alvo}\n  ${dialeto.verboDropCheck} ` +
        `${q(identificador(op.nome, 'a checagem'))};\n`
      );

    case 'criar-gatilho': {
      const nome = q(identificador(op.nome, 'o gatilho'));
      const cabeca =
        `CREATE TRIGGER ${nome}\n` +
        `  ${momentoValido(op.momento)} ${eventoValido(op.evento)} ON ${alvo}\n` +
        '  FOR EACH ROW\n';
      const aviso1 =
        '-- O gatilho passa a rodar em TODA escrita desta tabela.\n' +
        '-- Isto ainda NÃO rodou: aperte o ▷ Run acima do comando quando tiver certeza.\n';

      if (dialeto.gatilhoPrecisaDeFuncao) {
        // No PostgreSQL o gatilho não tem corpo: ele CHAMA uma função, que
        // precisa existir antes. O esqueleto dela vai comentado acima, para
        // quem ainda não a tem — em vez de um comando que o banco recusaria.
        const funcao = identificador(op.corpo, 'a função do gatilho');
        return (
          aviso1 +
          `-- A função ${funcao} precisa EXISTIR. Se ainda não existe, comece por ela:\n` +
          `-- CREATE FUNCTION ${funcao}() RETURNS trigger LANGUAGE plpgsql AS $$\n` +
          '-- BEGIN\n' +
          '--   RETURN NEW;\n' +
          '-- END $$;\n' +
          cabeca +
          `  EXECUTE FUNCTION ${q(funcao)}();\n`
        );
      }
      // A nota do DELIMITER é do MySQL, e só dele: o SQLite aceita
      // `BEGIN…END` direto. Repeti-la lá seria explicar um problema que
      // aquele banco não tem.
      const notaDoCorpo =
        dialeto.nome === 'MySQL'
          ? '-- Corpo de um comando só. Para vários, use BEGIN…END — e aí o cliente\n' +
            '-- mysql exige DELIMITER, que esta IDE ainda não interpreta (T052).\n'
          : '';
      return aviso1 + notaDoCorpo + cabeca + `  ${corpoValido(op.corpo)}\n`;
    }

    case 'apagar-gatilho': {
      const nome = q(identificador(op.nome, 'o gatilho'));
      return (
        aviso(`APAGA o gatilho ${op.nome}. O que ele fazia deixa de acontecer.`) +
        (dialeto.dropGatilhoPrecisaDaTabela
          ? `DROP TRIGGER ${nome} ON ${alvo};\n`
          : `DROP TRIGGER ${nome};\n`)
      );
    }

    case 'colacao-tabela':
      // `CONVERT TO CHARACTER SET` REESCREVE os dados de toda coluna de texto —
      // é o aviso que ele pediu na triagem, com todas as letras.
      return (
        aviso(`Muda a colação de ${op.conjunto} para ${op.colacao}.`) +
        REESCREVE +
        `ALTER TABLE ${alvo}\n` +
        `  CONVERT TO CHARACTER SET ${identificadorSimples(op.conjunto, 'o conjunto')} ` +
        `COLLATE ${identificadorSimples(op.colacao, 'a colação')};\n`
      );

    case 'colacao-coluna':
      // O PostgreSQL não tem colação de TABELA: ela é da coluna, e mudá-la
      // reescreve a coluna e reconstrói todo índice que a use.
      return (
        aviso(`Muda a colação da coluna ${op.coluna} para ${op.colacao}.`) +
        REESCREVE +
        `ALTER TABLE ${alvo}\n` +
        `  ALTER COLUMN ${q(identificador(op.coluna, 'a coluna'))} ` +
        `TYPE ${tipoValido(op.tipoSql)} COLLATE "${identificadorSimples(op.colacao, 'a colação')}";\n`
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

/**
 * As regras de integridade referencial que existem.
 *
 * Lista fechada, e não texto livre: o valor vem da tela e entra no comando SEM
 * aspas — é a única parte da FK que não dá para citar como identificador.
 */
const REGRAS_VALIDAS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'];

function regraDeIntegridade(bruto: unknown): string {
  const regra = typeof bruto === 'string' ? bruto.trim().toUpperCase() : '';
  if (!REGRAS_VALIDAS.includes(regra)) {
    throw new Error(
      `Regra inválida: ${JSON.stringify(bruto)}. Use uma de ${REGRAS_VALIDAS.join(', ')}.`
    );
  }
  return regra;
}

const MOMENTOS = ['BEFORE', 'AFTER'];
const EVENTOS = ['INSERT', 'UPDATE', 'DELETE'];

function momentoValido(bruto: unknown): string {
  const m = typeof bruto === 'string' ? bruto.trim().toUpperCase() : '';
  if (!MOMENTOS.includes(m)) throw new Error(`Momento inválido: ${JSON.stringify(bruto)}.`);
  return m;
}

function eventoValido(bruto: unknown): string {
  const e = typeof bruto === 'string' ? bruto.trim().toUpperCase() : '';
  if (!EVENTOS.includes(e)) throw new Error(`Evento inválido: ${JSON.stringify(bruto)}.`);
  return e;
}

/**
 * O corpo do gatilho e a expressão da checagem: SQL de verdade, escrito por ele.
 *
 * Não dá para citar nem parametrizar — é código, e é o ponto da feature. O que
 * dá para exigir é que não esteja vazio e não traga NUL. **Não** se recusa
 * ponto-e-vírgula: o corpo de um gatilho termina em `;`, e recusá-lo impediria
 * de escrever qualquer gatilho. Isto sai como TEXTO para ele ler antes de rodar
 * — é a razão de a spec 046 gerar e abrir em vez de executar.
 */
function corpoValido(bruto: unknown): string {
  const corpo = typeof bruto === 'string' ? bruto.trim() : '';
  if (corpo === '' || corpo.includes('\u0000')) {
    throw new Error(`Corpo de gatilho inválido: ${JSON.stringify(bruto)}.`);
  }
  return corpo;
}

function expressaoValida(bruto: unknown): string {
  const expressao = typeof bruto === 'string' ? bruto.trim() : '';
  if (expressao === '' || expressao.includes('\u0000')) {
    throw new Error(`Expressão de checagem inválida: ${JSON.stringify(bruto)}.`);
  }
  return expressao;
}

/**
 * Nome que entra no comando SEM citação: conjunto de caracteres e colação.
 *
 * `COLLATE` e `CHARACTER SET` não aceitam identificador citado no MySQL, então
 * aqui a barreira é a FORMA: só letra, dígito, `_` e `-`. É mais estreito que
 * `identificador`, e precisa ser.
 */
function identificadorSimples(bruto: unknown, oQue: string): string {
  const nome = typeof bruto === 'string' ? bruto.trim() : '';
  if (!/^[A-Za-z0-9_-]+$/.test(nome)) {
    throw new Error(`Nome inválido para ${oQue}: ${JSON.stringify(bruto)}.`);
  }
  return nome;
}
