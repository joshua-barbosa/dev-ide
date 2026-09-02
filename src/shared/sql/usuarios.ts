// SQL de usuário e permissão: GERADO, nunca executado (P3).
//
// A decisão é dele, com todas as letras em 02/09/2026: *"o melhor é copiar a
// query que faz o drop do usuário e ai a pessoa digita no .sql ou .sqlbook para
// ser executado. Nessa parte seria bom ter o criar usuário também e dar ou
// modificar permissões"*.
//
// **Então aqui não há nenhuma função que executa.** Tudo devolve texto. É a
// mesma regra da spec 046 para o resto do destrutivo, e ela vale em dobro para
// usuário: um `DROP USER` clicado por engano tira o acesso de alguém que está
// trabalhando, e não há Ctrl+Z para isso.
//
// **Senha nunca vai no texto gerado.** Sai um espaço reservado, que ele troca
// antes de rodar. Gerar SQL com senha de verdade a poria no clipboard, no
// arquivo, e no git de quem versiona o `.sql` — três lugares onde ela não deve
// estar.

export type DialetoDeUsuario = 'mysql' | 'postgres';

/** O que se digita no lugar da senha. Curto, e óbvio que é para trocar. */
export const SENHA_RESERVADA = 'TROQUE-ESTA-SENHA';

export interface Usuario {
  readonly nome: string;
  /**
   * O host do MySQL (`%`, `localhost`, `10.0.0.%`).
   *
   * No MySQL a identidade é o PAR: `'ana'@'%'` e `'ana'@'localhost'` são duas
   * contas diferentes, com senhas e permissões diferentes. Apagar uma achando
   * que apagou a outra é o erro clássico — e por isso o host não é opcional
   * aqui: quem chama tem de dizer qual.
   */
  readonly host?: string;
}

/**
 * Escapa um identificador do Postgres: aspas duplas, com `"` dobrado.
 *
 * Sem isto, um papel chamado `a"; DROP ROLE b; --` sairia como SQL executável
 * dentro do texto que ele vai colar. O texto é gerado, não executado, mas é
 * gerado para ser executado — o cuidado é o mesmo.
 */
export function aspas(nome: string): string {
  return `"${nome.replace(/"/g, '""')}"`;
}

/** Escapa uma string literal de SQL: aspas simples, com `'` dobrado. */
export function texto(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}

/** Escapa um identificador do MySQL: crase, com a crase dobrada. */
export function crase(nome: string): string {
  return `\`${nome.replace(/`/g, '``')}\``;
}

/**
 * O usuário do jeito que cada banco o nomeia.
 *
 * No MySQL é `'nome'@'host'` — literal, e não identificador. No Postgres é um
 * identificador entre aspas duplas, e host não existe: quem controla de onde se
 * conecta é o `pg_hba.conf`, e não o papel.
 */
export function nomeDoUsuario(dialeto: DialetoDeUsuario, u: Usuario): string {
  if (dialeto === 'postgres') return aspas(u.nome);
  return `${texto(u.nome)}@${texto(u.host ?? '%')}`;
}

// ---------------------------------------------------------------------------
// Criar e apagar
// ---------------------------------------------------------------------------

export function criarUsuario(dialeto: DialetoDeUsuario, u: Usuario): string {
  const quem = nomeDoUsuario(dialeto, u);
  if (dialeto === 'postgres') {
    return [
      `-- Troque ${SENHA_RESERVADA} antes de executar.`,
      `CREATE ROLE ${quem} WITH LOGIN PASSWORD ${texto(SENHA_RESERVADA)};`,
    ].join('\n');
  }
  return [
    `-- Troque ${SENHA_RESERVADA} antes de executar.`,
    `-- O host faz parte da identidade: ${quem} não é a mesma conta que`,
    `-- ${nomeDoUsuario('mysql', { nome: u.nome, host: 'localhost' })}.`,
    `CREATE USER ${quem} IDENTIFIED BY ${texto(SENHA_RESERVADA)};`,
  ].join('\n');
}

/**
 * O `DROP`, com o aviso junto.
 *
 * O comentário não é enfeite: este texto vai para o clipboard e pode ser colado
 * meses depois, num arquivo que alguém abre sem contexto. A linha que diz o que
 * o comando faz viaja junto com ele.
 */
export function apagarUsuario(dialeto: DialetoDeUsuario, u: Usuario): string {
  const quem = nomeDoUsuario(dialeto, u);
  if (dialeto === 'postgres') {
    return [
      `-- APAGA o papel ${quem}. O Postgres recusa enquanto ele for dono de algo:`,
      `-- nesse caso, veja REASSIGN OWNED BY e DROP OWNED BY antes.`,
      `DROP ROLE ${quem};`,
    ].join('\n');
  }
  return [
    `-- APAGA a conta ${quem}, e só ela: outras contas com o mesmo nome e outro`,
    `-- host continuam existindo.`,
    `DROP USER ${quem};`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------

/**
 * Onde a permissão vale.
 *
 * Um tipo em vez de string solta porque o alvo é a parte que erra: `banco.*` no
 * MySQL e `ALL TABLES IN SCHEMA banco` no Postgres são a mesma intenção escrita
 * de duas formas que não se parecem.
 */
export type AlvoDaPermissao =
  | { readonly tipo: 'tudo' }
  | { readonly tipo: 'banco'; readonly banco: string }
  | { readonly tipo: 'schema'; readonly schema: string }
  | { readonly tipo: 'tabela'; readonly schema?: string; readonly tabela: string };

export function alvoEmSql(dialeto: DialetoDeUsuario, alvo: AlvoDaPermissao): string {
  if (dialeto === 'mysql') {
    switch (alvo.tipo) {
      case 'tudo':
        return '*.*';
      case 'banco':
      case 'schema':
        // No MySQL schema e banco são a mesma coisa — dizer o contrário na tela
        // criaria uma distinção que o servidor não tem.
        return `${crase(alvo.tipo === 'banco' ? alvo.banco : alvo.schema)}.*`;
      case 'tabela':
        return alvo.schema === undefined
          ? crase(alvo.tabela)
          : `${crase(alvo.schema)}.${crase(alvo.tabela)}`;
    }
  }
  switch (alvo.tipo) {
    case 'tudo':
      // O Postgres não tem "tudo" numa linha: a permissão é por banco, schema
      // ou tabela. `ALL TABLES IN SCHEMA public` é o mais próximo do que se
      // quer dizer, e o comentário do gerador avisa.
      return 'ALL TABLES IN SCHEMA public';
    case 'banco':
      return `DATABASE ${aspas(alvo.banco)}`;
    case 'schema':
      return `ALL TABLES IN SCHEMA ${aspas(alvo.schema)}`;
    case 'tabela':
      return `TABLE ${alvo.schema === undefined ? aspas(alvo.tabela) : `${aspas(alvo.schema)}.${aspas(alvo.tabela)}`}`;
  }
}

/** Os privilégios que a tela oferece. Curtos de propósito: são os que se usam. */
export const PRIVILEGIOS: Readonly<Record<DialetoDeUsuario, readonly string[]>> = {
  mysql: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'ALL PRIVILEGES'],
  postgres: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CONNECT', 'USAGE', 'ALL PRIVILEGES'],
};

export interface PedidoDePermissao {
  readonly usuario: Usuario;
  readonly privilegios: readonly string[];
  readonly alvo: AlvoDaPermissao;
}

/**
 * Lista de privilégios para SQL.
 *
 * `ALL PRIVILEGES` **engole os outros**: pedir `SELECT, ALL PRIVILEGES` é pedir
 * tudo, e escrever os dois faria a linha mentir sobre o que concede.
 */
export function listaDePrivilegios(privilegios: readonly string[]): string {
  const limpos = privilegios.map((p) => p.trim().toUpperCase()).filter((p) => p !== '');
  if (limpos.length === 0) return 'SELECT';
  if (limpos.includes('ALL PRIVILEGES')) return 'ALL PRIVILEGES';
  return [...new Set(limpos)].join(', ');
}

export function conceder(dialeto: DialetoDeUsuario, p: PedidoDePermissao): string {
  const quem = nomeDoUsuario(dialeto, p.usuario);
  const linhas = [
    `GRANT ${listaDePrivilegios(p.privilegios)} ON ${alvoEmSql(dialeto, p.alvo)} TO ${quem};`,
  ];
  if (dialeto === 'mysql') {
    // Sem isto, o GRANT só passa a valer na próxima conexão do usuário — e a
    // pessoa jura que o comando não funcionou.
    linhas.push('FLUSH PRIVILEGES;');
  }
  if (dialeto === 'postgres' && p.alvo.tipo === 'tudo') {
    linhas.unshift(
      '-- O Postgres não tem "tudo" numa linha: isto vale para o schema public.',
      '-- Repita por schema, se houver outros.'
    );
  }
  return linhas.join('\n');
}

export function revogar(dialeto: DialetoDeUsuario, p: PedidoDePermissao): string {
  const quem = nomeDoUsuario(dialeto, p.usuario);
  const linhas = [
    `REVOKE ${listaDePrivilegios(p.privilegios)} ON ${alvoEmSql(dialeto, p.alvo)} FROM ${quem};`,
  ];
  if (dialeto === 'mysql') linhas.push('FLUSH PRIVILEGES;');
  return linhas.join('\n');
}
