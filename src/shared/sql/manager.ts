// O que a aba `Manager` mostra: Dashboard, Log e Structure Sync (T070).
//
// Ele pediu os três com todas as letras: *"os TRÊS: Structure Sync, Dashboard e
// Log"*. São coisas bem diferentes, e o que as junta é o lugar na tela — por
// isso o contrato é um só, com as três partes opcionais: um driver que sabe
// medir e não sabe ler log declara uma e não a outra, e a tela obedece.
//
// **Tudo aqui é LEITURA.** O Structure Sync compara duas estruturas e devolve o
// SQL que igualaria uma à outra — mas não o executa: quem roda é ele, com o
// texto à vista, num editor. Gerar e aplicar no mesmo clique seria a IDE
// mudando o banco dele por conta própria.

/** Um número do painel — o que a ferramenta de referência chama de *status*. */
export interface MetricaDoBanco {
  readonly nome: string;
  readonly valor: string;
  /**
   * O grupo em que ela aparece.
   *
   * Existe porque um `SHOW STATUS` devolve trezentas linhas, e uma lista de
   * trezentos números sem separação não é painel, é despejo.
   */
  readonly grupo: string;
  /** O que ela quer dizer, quando não é óbvio pelo nome. */
  readonly ajuda?: string;
}

/** Uma linha do log do servidor. */
export interface LinhaDeLog {
  /** Quando, se o servidor disser. `null` quando a linha não tem data. */
  readonly quando: string | null;
  readonly nivel: 'erro' | 'aviso' | 'nota' | 'outro';
  readonly texto: string;
}

/**
 * Uma diferença entre duas estruturas.
 *
 * `sql` é o comando que igualaria o destino à origem. Pode ser vazio quando a
 * IDE reconhece a diferença e não sabe escrever o comando — e aí a linha
 * aparece assim mesmo, porque saber que existe já vale.
 */
export interface DiferencaDeEstrutura {
  readonly tipo: 'tabela' | 'coluna' | 'indice' | 'outro';
  /** O objeto: `clientes`, `clientes.email`, `clientes.idx_email`. */
  readonly objeto: string;
  readonly lado: 'só na origem' | 'só no destino' | 'diferente';
  readonly detalhe: string;
  readonly sql: string;
}

export interface RetratoDaEstrutura {
  readonly banco: string;
  readonly tabelas: readonly TabelaDaEstrutura[];
}

export interface TabelaDaEstrutura {
  readonly nome: string;
  readonly colunas: readonly ColunaDaEstrutura[];
  readonly indices: readonly IndiceDaEstrutura[];
}

export interface ColunaDaEstrutura {
  readonly nome: string;
  /** O tipo como o banco o escreve: `varchar(255)`, `int unsigned`. */
  readonly tipo: string;
  readonly aceitaNulo: boolean;
  readonly padrao: string | null;
}

export interface IndiceDaEstrutura {
  readonly nome: string;
  readonly colunas: readonly string[];
  readonly unico: boolean;
}

/**
 * Compara duas estruturas e devolve o que falta no DESTINO.
 *
 * A direção importa e é sempre esta: o que se vê é *"o que fazer no destino
 * para ele ficar como a origem"*. A comparação simétrica — listar os dois lados
 * como iguais em importância — dá uma lista que ninguém sabe aplicar.
 *
 * **Nada é apagado.** Uma tabela que só existe no destino aparece como
 * diferença, e o `sql` vem vazio: gerar `DROP TABLE` num comparador de
 * estrutura é como deixar uma arma engatilhada em cima da mesa. Quem quiser
 * apagar escreve o comando.
 */
export function compararEstruturas(
  origem: RetratoDaEstrutura,
  destino: RetratoDaEstrutura
): readonly DiferencaDeEstrutura[] {
  const saida: DiferencaDeEstrutura[] = [];
  const noDestino = new Map(destino.tabelas.map((t) => [t.nome, t]));
  const naOrigem = new Set(origem.tabelas.map((t) => t.nome));

  for (const tabela of origem.tabelas) {
    const par = noDestino.get(tabela.nome);
    if (par === undefined) {
      saida.push({
        tipo: 'tabela',
        objeto: tabela.nome,
        lado: 'só na origem',
        detalhe: `${tabela.colunas.length} coluna(s)`,
        sql: criarTabela(tabela),
      });
      continue;
    }
    saida.push(...compararColunas(tabela, par));
    saida.push(...compararIndices(tabela, par));
  }

  for (const tabela of destino.tabelas) {
    if (naOrigem.has(tabela.nome)) continue;
    saida.push({
      tipo: 'tabela',
      objeto: tabela.nome,
      lado: 'só no destino',
      detalhe: 'existe aqui e não na origem',
      // Vazio de propósito — ver a nota do cabeçalho desta função.
      sql: '',
    });
  }

  return saida;
}

function compararColunas(
  origem: TabelaDaEstrutura,
  destino: TabelaDaEstrutura
): readonly DiferencaDeEstrutura[] {
  const saida: DiferencaDeEstrutura[] = [];
  const noDestino = new Map(destino.colunas.map((c) => [c.nome, c]));
  const naOrigem = new Set(origem.colunas.map((c) => c.nome));

  for (const coluna of origem.colunas) {
    const par = noDestino.get(coluna.nome);
    if (par === undefined) {
      saida.push({
        tipo: 'coluna',
        objeto: `${origem.nome}.${coluna.nome}`,
        lado: 'só na origem',
        detalhe: coluna.tipo,
        sql: `ALTER TABLE ${crase(origem.nome)} ADD COLUMN ${definicaoDeColuna(coluna)};`,
      });
      continue;
    }
    const mudou = descreverMudanca(coluna, par);
    if (mudou !== null) {
      saida.push({
        tipo: 'coluna',
        objeto: `${origem.nome}.${coluna.nome}`,
        lado: 'diferente',
        detalhe: mudou,
        sql: `ALTER TABLE ${crase(origem.nome)} MODIFY COLUMN ${definicaoDeColuna(coluna)};`,
      });
    }
  }

  for (const coluna of destino.colunas) {
    if (naOrigem.has(coluna.nome)) continue;
    saida.push({
      tipo: 'coluna',
      objeto: `${destino.nome}.${coluna.nome}`,
      lado: 'só no destino',
      detalhe: coluna.tipo,
      // Sem `DROP COLUMN` gerado: apagar coluna apaga os dados dela.
      sql: '',
    });
  }
  return saida;
}

function compararIndices(
  origem: TabelaDaEstrutura,
  destino: TabelaDaEstrutura
): readonly DiferencaDeEstrutura[] {
  const saida: DiferencaDeEstrutura[] = [];
  const noDestino = new Map(destino.indices.map((i) => [i.nome, i]));

  for (const indice of origem.indices) {
    const par = noDestino.get(indice.nome);
    if (par === undefined) {
      saida.push({
        tipo: 'indice',
        objeto: `${origem.nome}.${indice.nome}`,
        lado: 'só na origem',
        detalhe: indice.colunas.join(', '),
        sql:
          `CREATE ${indice.unico ? 'UNIQUE ' : ''}INDEX ${crase(indice.nome)} ` +
          `ON ${crase(origem.nome)} (${indice.colunas.map(crase).join(', ')});`,
      });
      continue;
    }
    // Colunas em ORDEM diferente é índice diferente: `(a, b)` e `(b, a)` servem
    // a consultas diferentes, e comparar como conjunto esconderia isso.
    if (par.colunas.join(',') !== indice.colunas.join(',') || par.unico !== indice.unico) {
      saida.push({
        tipo: 'indice',
        objeto: `${origem.nome}.${indice.nome}`,
        lado: 'diferente',
        detalhe: `origem: (${indice.colunas.join(', ')}) · destino: (${par.colunas.join(', ')})`,
        // Índice não se altera: derruba e cria.
        sql:
          `DROP INDEX ${crase(indice.nome)} ON ${crase(origem.nome)};\n` +
          `CREATE ${indice.unico ? 'UNIQUE ' : ''}INDEX ${crase(indice.nome)} ` +
          `ON ${crase(origem.nome)} (${indice.colunas.map(crase).join(', ')});`,
      });
    }
  }
  return saida;
}

function descreverMudanca(origem: ColunaDaEstrutura, destino: ColunaDaEstrutura): string | null {
  const partes: string[] = [];
  if (origem.tipo !== destino.tipo) partes.push(`tipo: ${destino.tipo} → ${origem.tipo}`);
  if (origem.aceitaNulo !== destino.aceitaNulo) {
    partes.push(origem.aceitaNulo ? 'passa a aceitar nulo' : 'deixa de aceitar nulo');
  }
  if ((origem.padrao ?? '') !== (destino.padrao ?? '')) {
    partes.push(`padrão: ${destino.padrao ?? '(nenhum)'} → ${origem.padrao ?? '(nenhum)'}`);
  }
  return partes.length === 0 ? null : partes.join(' · ');
}

function definicaoDeColuna(c: ColunaDaEstrutura): string {
  const nulo = c.aceitaNulo ? 'NULL' : 'NOT NULL';
  const padrao = c.padrao === null ? '' : ` DEFAULT ${c.padrao}`;
  return `${crase(c.nome)} ${c.tipo} ${nulo}${padrao}`;
}

function criarTabela(t: TabelaDaEstrutura): string {
  const colunas = t.colunas.map((c) => `  ${definicaoDeColuna(c)}`).join(',\n');
  const indices = t.indices
    .map(
      (i) =>
        `CREATE ${i.unico ? 'UNIQUE ' : ''}INDEX ${crase(i.nome)} ` +
        `ON ${crase(t.nome)} (${i.colunas.map(crase).join(', ')});`
    )
    .join('\n');
  return `CREATE TABLE ${crase(t.nome)} (\n${colunas}\n);${indices === '' ? '' : `\n${indices}`}`;
}

/**
 * Envolve um identificador em crase, escapando a crase de dentro.
 *
 * Um nome com crase é raro e legal no MySQL; sem o escape, ele fecharia a
 * citação e o resto do nome viraria comando.
 */
function crase(nome: string): string {
  return `\`${nome.replace(/`/g, '``')}\``;
}

/**
 * Classifica uma linha de log pelo texto.
 *
 * O formato varia entre MySQL e PostgreSQL e entre versões, então o que se faz
 * aqui é reconhecer a PALAVRA — e cair em `outro` quando não reconhece, em vez
 * de chamar de nota o que pode ser erro.
 */
export function nivelDaLinha(texto: string): LinhaDeLog['nivel'] {
  const t = texto.toLowerCase();
  if (/\b(error|erro|fatal|panic)\b/.test(t)) return 'erro';
  if (/\b(warning|warn|aviso)\b/.test(t)) return 'aviso';
  if (/\b(note|notice|info|log)\b/.test(t)) return 'nota';
  return 'outro';
}
