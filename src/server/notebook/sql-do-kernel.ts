// O `sql()` de dentro do kernel, do lado do motor (spec 114, C).
//
// O usuário: *"se me passarem uma lista de ids… eu preciso rodar a function
// … para cada uma delas"* e *"fazer um update … rodando uma construção de SQL"*
// — um laço de verdade, em código. O kernel pede pelo canal (`{tipo:'sql'}`),
// e esta classe executa pela conexão do NOTEBOOK.
//
// Decisões do usuário (30/09): cada `sql()` vale sozinho; erro vira exceção normal;
// sem confirmação (a trava de somente-leitura da conexão continua valendo).
// Tudo-ou-nada só com `sql.transacao`, que ganha uma sessão PRÓPRIA — a do
// pool é compartilhada com o resto da IDE, e um BEGIN nela prenderia todo
// mundo na mesma transação.
import type { Session } from '../connections/types';
import type { Vinculo } from '../../shared/sql/vinculo';
import { trocarInterrogacoes, type EstiloDeParametro } from '../../shared/notebook/parametros';

export interface DepsDoSqlDoKernel {
  /** A conexão do notebook agora (a da barra de cima). */
  vinculo(): Vinculo | null;
  /** A sessão do pool — a mesma que as células SQL usam. */
  sessao(connectionId: string): Promise<Session>;
  /** Uma sessão NOVA, só desta transação. */
  abrirDedicada(connectionId: string): Promise<Session>;
  /** O tipo do banco: decide o marcador de parâmetro e o BEGIN. */
  tipo(connectionId: string): string;
}

type Pedido = Readonly<Record<string, unknown>>;

interface Aberta {
  readonly sessao: Session;
  readonly database: string;
  readonly tipo: string;
}

function estiloDe(tipo: string): EstiloDeParametro {
  if (tipo === 'postgres') return 'dolar';
  if (tipo === 'sqlserver') return 'arroba';
  return 'interrogacao';
}

function comandosDe(tipo: string): { comecar: string; confirmar: string; desfazer: string } {
  if (tipo === 'sqlserver') {
    return { comecar: 'BEGIN TRANSACTION', confirmar: 'COMMIT TRANSACTION', desfazer: 'ROLLBACK TRANSACTION' };
  }
  if (tipo === 'mysql' || tipo === 'mariadb') return { comecar: 'START TRANSACTION', confirmar: 'COMMIT', desfazer: 'ROLLBACK' };
  return { comecar: 'BEGIN', confirmar: 'COMMIT', desfazer: 'ROLLBACK' };
}

/** Só o que um banco aceita como parâmetro; o resto vai como JSON. */
function comoParametro(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

export class SqlDoKernel {
  private readonly abertas = new Map<number, Aberta>();
  private proxima = 1;

  constructor(private readonly deps: DepsDoSqlDoKernel) {}

  private vinculoOuErro(): Vinculo {
    const v = this.deps.vinculo();
    if (v === null) {
      throw new Error('sql() usa a conexão do notebook: escolha uma na barra de cima ("escolher conexão…").');
    }
    return v;
  }

  /** Um pedido do kernel. A resposta (ou a exceção) volta para a célula. */
  async atender(p: Pedido): Promise<Record<string, unknown>> {
    if (p.tipo === 'sql-transacao') return this.transacao(p);
    const vinculo = this.vinculoOuErro();
    const params = (Array.isArray(p.params) ? p.params : []).map(comoParametro);
    const aberta = typeof p.transacao === 'number' ? this.abertas.get(p.transacao) : undefined;
    if (typeof p.transacao === 'number' && aberta === undefined) {
      throw new Error('A transação deste sql() já terminou.');
    }
    const tipo = aberta?.tipo ?? this.deps.tipo(vinculo.connectionId);
    const statement = trocarInterrogacoes(String(p.texto ?? ''), params.length, estiloDe(tipo));
    const sessao = aberta?.sessao ?? (await this.deps.sessao(vinculo.connectionId));
    if (typeof sessao.execute !== 'function') throw new Error('Esta conexão não executa SQL.');
    const r = await sessao.execute({
      statement,
      params,
      database: aberta?.database ?? vinculo.database,
      semTeto: true,
      orcamentoDeCelulas: Number.MAX_SAFE_INTEGER,
    });
    // Linhas afetadas só quando o banco CONTA (MySQL, SQLite). O Postgres lê
    // por cursor e o SQL Server não informa: aí é `null`, e não um 0 que
    // pareceria "nada mudou".
    const contou = r.columns.length === 0 && /linha\(s\) afetada/.test(r.message ?? '');
    return {
      colunas: r.columns.map((c) => c.name),
      linhas: r.rows,
      linhasAfetadas: contou ? r.rowCount : null,
    };
  }

  private async transacao(p: Pedido): Promise<Record<string, unknown>> {
    if (p.acao === 'comecar') {
      const vinculo = this.vinculoOuErro();
      const tipo = this.deps.tipo(vinculo.connectionId);
      const sessao = await this.deps.abrirDedicada(vinculo.connectionId);
      try {
        await sessao.execute?.({ statement: comandosDe(tipo).comecar, params: [], database: vinculo.database });
      } catch (e) {
        await sessao.close().catch(() => undefined);
        throw e;
      }
      const id = this.proxima++;
      this.abertas.set(id, { sessao, database: vinculo.database, tipo });
      return { transacao: id };
    }
    const id = Number(p.transacao);
    const aberta = this.abertas.get(id);
    if (aberta === undefined) throw new Error('Esta transação já terminou.');
    this.abertas.delete(id);
    const comando = p.acao === 'confirmar' ? comandosDe(aberta.tipo).confirmar : comandosDe(aberta.tipo).desfazer;
    try {
      await aberta.sessao.execute?.({ statement: comando, params: [], database: aberta.database });
    } finally {
      await aberta.sessao.close().catch(() => undefined);
    }
    return {};
  }

  /** A célula acabou (ou foi parada) com transação aberta: desfaz. */
  async desfazerAbertas(): Promise<void> {
    for (const id of [...this.abertas.keys()]) {
      await this.transacao({ acao: 'desfazer', transacao: id }).catch(() => undefined);
    }
  }
}
