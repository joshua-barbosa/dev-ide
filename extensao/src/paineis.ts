// Qual conexão vai em qual painel — Databases ou Services.
//
// **Quem decide é o DRIVER, não esta lista.** `GET /api/connections/drivers`
// devolve `panel: 'database' | 'service'` para cada tipo, e é o mesmo campo que
// a IDE própria usa para separar as duas abas da barra lateral. Um `Set` de
// tipos escrito aqui seria uma segunda verdade, que envelheceria no dia em que
// um driver novo aparecesse.
//
// Lógica pura, sem `vscode` e sem rede: é o que a deixa conferível por teste.

export type Painel = 'database' | 'service';

export interface DriverPublico {
  readonly type: string;
  readonly panel: Painel;
}

export interface ConexaoPublica {
  readonly id: string;
  readonly label: string;
  readonly type: string;
}

export interface Grupo {
  readonly name: string;
  readonly path: string;
  readonly groups: readonly Grupo[];
  readonly connections: readonly ConexaoPublica[];
}

/** De tipo de driver para painel. */
export function painelPorTipo(drivers: readonly DriverPublico[]): ReadonlyMap<string, Painel> {
  return new Map(drivers.map((d) => [d.type, d.panel]));
}

/**
 * A árvore de grupos com só as conexões deste painel.
 *
 * **Grupo que fica vazio some.** Uma pasta `ACME/Bancos` no painel de Services
 * seria uma promessa que ela não cumpre: abre e não tem nada dentro. É a mesma
 * regra do motor, onde grupos são derivados dos caminhos e grupo vazio não
 * existe.
 *
 * Um tipo desconhecido — driver novo, extensão velha — cai em `database`. Some
 * dos dois painéis seria pior: a conexão existe e o usuário não a acharia em
 * lugar nenhum.
 */
export function filtrarPorPainel(
  grupo: Grupo,
  painel: Painel,
  porTipo: ReadonlyMap<string, Painel>
): Grupo | null {
  const conexoes = grupo.connections.filter(
    (c) => (porTipo.get(c.type) ?? 'database') === painel
  );
  const filhos = grupo.groups
    .map((g) => filtrarPorPainel(g, painel, porTipo))
    .filter((g): g is Grupo => g !== null);

  // A RAIZ fica mesmo vazia: ela não é uma pasta na tela, é a própria lista, e
  // sumir com ela deixaria o painel sem onde dizer "nenhuma conexão".
  const ehRaiz = grupo.path === '';
  if (!ehRaiz && conexoes.length === 0 && filhos.length === 0) return null;

  return { ...grupo, groups: filhos, connections: conexoes };
}
