// A cascata entre linguagens (spec 113, etapa 3) — as regras, com kernels de
// mentira. O que o usuário pediu: *"se em outra célula eu edito o valor
// daquele resultado… o quarto em diante precisa receber o 'pedidos'
// alterado, assim como funciona o Jupyter"*.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cascata, familiaDe, type Familia, type KernelDeDados } from '../notebook/cascata';

/** Um kernel que guarda variáveis num objeto e só exporta o que mudou. */
class KernelFalso implements KernelDeDados {
  readonly vars: Record<string, unknown> = {};
  private readonly vistas = new Map<string, string>();
  exportacoes = 0;
  importacoes = 0;
  readonly vivo = true;

  async exportar(): Promise<Record<string, unknown>> {
    this.exportacoes += 1;
    const mudou: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.vars)) {
      const s = JSON.stringify(v);
      if (this.vistas.get(k) !== s) {
        this.vistas.set(k, s);
        mudou[k] = v;
      }
    }
    return mudou;
  }

  async importar(valores: Readonly<Record<string, unknown>>): Promise<void> {
    this.importacoes += 1;
    for (const [k, v] of Object.entries(valores)) {
      this.vars[k] = structuredClone(v);
      this.vistas.set(k, JSON.stringify(v));
    }
  }

  /** O que o SQL faz: o valor chega ao kernel e não conta como mudança dele. */
  definir(nome: string, v: unknown): void {
    this.vars[nome] = structuredClone(v);
    this.vistas.set(nome, JSON.stringify(v));
  }
}

function cenario() {
  const ks: Record<Familia, KernelFalso> = { python: new KernelFalso(), node: new KernelFalso(), php: new KernelFalso() };
  const cascata = new Cascata();
  /** Roda uma "célula": a cascata antes, o efeito depois. */
  const rodar = async (f: Familia, efeito: (vars: Record<string, unknown>) => void) => {
    await cascata.antesDeRodar(f, (x) => ks[x]);
    efeito(ks[f].vars);
  };
  return { ks, cascata, rodar };
}

test('JS e TS são o mesmo Node', () => {
  assert.equal(familiaDe('javascript'), 'node');
  assert.equal(familiaDe('typescript'), 'node');
  assert.equal(familiaDe('python'), 'python');
  assert.equal(familiaDe('php'), 'php');
});

test('o que o Node criou chega no Python na troca de linguagem', async () => {
  const { ks, rodar } = cenario();
  await rodar('node', (v) => { v.ids = [1, 2, 3]; });
  await rodar('python', (v) => { v.total = (v.ids as number[]).length; });
  assert.deepEqual(ks.python.vars.ids, [1, 2, 3]);
  assert.equal(ks.python.vars.total, 3);
});

test('a mesma linguagem seguida não copia nada', async () => {
  const { ks, rodar } = cenario();
  await rodar('node', (v) => { v.a = 1; });
  await rodar('node', (v) => { v.b = 2; });
  await rodar('node', (v) => { v.c = 3; });
  assert.equal(ks.node.exportacoes, 0);
  assert.equal(ks.node.importacoes, 0);
});

test('o caso dele: SQL → Node altera por dentro → Python recebe → altera → Node recebe', async () => {
  const { ks, cascata, rodar } = cenario();
  const linhas = [{ id: 1, total: 100 }, { id: 2, total: 50 }];
  // SQL: o resultado chega em todas as linguagens.
  for (const k of Object.values(ks)) k.definir('pedidos', linhas);
  cascata.aoDefinir('pedidos');
  await rodar('node', (v) => { for (const p of v.pedidos as { total: number; desconto?: number }[]) p.desconto = p.total * 0.1; });
  await rodar('python', (v) => {
    for (const p of v.pedidos as { total: number; desconto: number; liquido?: number }[]) p.liquido = p.total - p.desconto;
  });
  await rodar('node', () => undefined);
  assert.deepEqual(ks.node.vars.pedidos, [
    { id: 1, total: 100, desconto: 10, liquido: 90 },
    { id: 2, total: 50, desconto: 5, liquido: 45 },
  ]);
});

test('Node → Python → PHP: o PHP recebe também o que veio do Node', async () => {
  const { ks, rodar } = cenario();
  await rodar('node', (v) => { v.deNode = 'n'; });
  await rodar('python', (v) => { v.dePython = 'p'; });
  await rodar('php', () => undefined);
  assert.equal(ks.php.vars.deNode, 'n');
  assert.equal(ks.php.vars.dePython, 'p');
});

test('o mesmo nome alterado em duas linguagens: vale a mais recente', async () => {
  const { ks, rodar } = cenario();
  await rodar('node', (v) => { v.x = 'antigo'; });
  await rodar('python', (v) => { v.x = 'novo'; });
  await rodar('node', () => undefined);
  assert.equal(ks.node.vars.x, 'novo');
});

test('SQL depois de uma alteração: o resultado novo vence o valor velho da cascata', async () => {
  const { ks, cascata, rodar } = cenario();
  await rodar('node', (v) => { v.pedidos = ['velho']; });
  await rodar('python', () => undefined); // o Python viu o velho
  // O SQL roda de novo e entrega o resultado novo a todos.
  for (const k of Object.values(ks)) k.definir('pedidos', ['novo']);
  cascata.aoDefinir('pedidos');
  await rodar('node', () => undefined);
  await rodar('python', () => undefined);
  assert.deepEqual(ks.node.vars.pedidos, ['novo']);
  assert.deepEqual(ks.python.vars.pedidos, ['novo']);
});

test('{{nome}}: a origem é quem mudou por último, depois de sincronizar', async () => {
  const { cascata, ks, rodar } = cenario();
  await rodar('node', (v) => { v.ids = [1]; });
  await rodar('python', (v) => { v.ids = [1, 2]; });
  await cascata.sincronizar((x) => ks[x]);
  assert.equal(cascata.origemDe('ids'), 'python');
  assert.equal(cascata.ultima, 'python');
});

test('reiniciar UM kernel não traz de volta o que ele tinha', async () => {
  const { ks, cascata, rodar } = cenario();
  await rodar('python', (v) => { v.segredo = 1; });
  await rodar('node', () => undefined); // Node recebe "segredo"
  // O Python reinicia: some tudo nele.
  for (const k of Object.keys(ks.python.vars)) delete ks.python.vars[k];
  cascata.aoReiniciar('python');
  await rodar('python', () => undefined);
  assert.equal(ks.python.vars.segredo, undefined);
});

test('o que chega DEPOIS do reinício continua chegando', async () => {
  const { ks, cascata, rodar } = cenario();
  await rodar('python', () => undefined);
  cascata.aoReiniciar('python');
  await rodar('node', (v) => { v.novo = 'sim'; });
  await rodar('python', () => undefined);
  assert.equal(ks.python.vars.novo, 'sim');
});
