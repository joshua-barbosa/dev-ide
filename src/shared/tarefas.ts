// Tarefas do projeto: o `tasks.json` (T015, T016).
//
// A desculpa que eu escrevi na spec 018 está no cabeçalho de
// `comandos-salvos.ts`: *"configuração, tarefas compostas, de fundo e grupos
// são máquina demais para um projeto de uma pessoa"*. Era palpite meu sobre o
// tamanho do trabalho DELE, e ele mandou fazer.
//
// **O arquivo é o `.vscode/tasks.json`**, pelo mesmo motivo do
// `.vscode/settings.json` no T002: quem já tem um no repositório não precisa
// escrever outro, e o que estiver lá e nós não entendermos é ignorado.
//
// O que a IDE entende é um SUBCONJUNTO, declarado no fim deste arquivo. O que
// ela não entende não vira erro — vira tarefa que roda sem aquele detalhe, ou
// tarefa que não aparece. Recusar o arquivo inteiro por causa de uma chave que
// o VS Code inventou seria trocar "funciona em parte" por "não funciona".

export type GrupoDeTarefa = 'build' | 'test';

export interface Tarefa {
  /** O `label` do `tasks.json`. É por ele que `dependsOn` aponta. */
  readonly nome: string;
  /** Já com os `args` juntados — é o que vai para o shell. */
  readonly comando: string;
  /** Relativo à raiz do projeto; ausente = a própria raiz. */
  readonly cwd?: string;
  readonly grupo?: GrupoDeTarefa;
  /** `group.isDefault` — quem o `Run Build Task` roda sem perguntar. */
  readonly padraoDoGrupo: boolean;
  /** Os `label`s de que ela depende. Vazio quando não depende de nada. */
  readonly dependeDe: readonly string[];
  /** Como rodar as dependências. O padrão do VS Code é `parallel`. */
  readonly ordem: 'sequence' | 'parallel';
  /**
   * `isBackground`: fica rodando (um `watch`, um servidor).
   *
   * Muda uma coisa e só uma: uma tarefa de fundo **não pode entrar numa
   * corrente com `&&`**, porque ela nunca termina e o que vier depois nunca
   * roda. Ela ganha um terminal só dela.
   */
  readonly deFundo: boolean;
}

const MAX_TAREFAS = 200;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** `command` mais `args`, que é como o VS Code descreve a linha de comando. */
function linhaDeComando(bruto: Record<string, unknown>): string {
  const comando = texto(bruto.command);
  if (comando === '') return '';
  const args = Array.isArray(bruto.args)
    ? bruto.args.filter((a): a is string => typeof a === 'string')
    : [];
  return [comando, ...args].join(' ').trim();
}

function lerGrupo(bruto: unknown): { grupo?: GrupoDeTarefa; padrao: boolean } {
  // Duas formas, as duas do VS Code: `"group": "build"` e
  // `"group": { "kind": "build", "isDefault": true }`.
  if (typeof bruto === 'string') {
    return bruto === 'build' || bruto === 'test' ? { grupo: bruto, padrao: false } : { padrao: false };
  }
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return { padrao: false };
  const g = bruto as Record<string, unknown>;
  const kind = texto(g.kind);
  if (kind !== 'build' && kind !== 'test') return { padrao: false };
  return { grupo: kind, padrao: g.isDefault === true };
}

/**
 * Lê o `tasks.json`, tolerando qualquer estrago.
 *
 * Tarefa sem `label` ou sem `command` é DESCARTADA, e não corrigida: um nome
 * inventado por nós apareceria na lista e ninguém saberia o que ele roda.
 * Nome repetido fica com a primeira, que é o que o `dependsOn` vai achar.
 */
export function lerTarefas(bruto: unknown): readonly Tarefa[] {
  const raiz = bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)
    ? {}
    : (bruto as Record<string, unknown>);
  if (!Array.isArray(raiz.tasks)) return [];

  const vistos = new Set<string>();
  const saida: Tarefa[] = [];
  for (const item of raiz.tasks) {
    if (saida.length >= MAX_TAREFAS) break;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const t = item as Record<string, unknown>;

    const nome = texto(t.label);
    const comando = linhaDeComando(t);
    if (nome === '' || comando === '') continue;
    if (vistos.has(nome)) continue;
    vistos.add(nome);

    const { grupo, padrao } = lerGrupo(t.group);
    const dependeDe =
      typeof t.dependsOn === 'string'
        ? [t.dependsOn]
        : Array.isArray(t.dependsOn)
          ? t.dependsOn.filter((d): d is string => typeof d === 'string' && d !== '')
          : [];
    const opcoes = (t.options ?? {}) as Record<string, unknown>;
    const cwd = texto(opcoes.cwd);

    saida.push({
      nome,
      comando,
      ...(cwd === '' ? {} : { cwd }),
      ...(grupo === undefined ? {} : { grupo }),
      padraoDoGrupo: padrao,
      dependeDe,
      ordem: t.dependsOrder === 'sequence' ? 'sequence' : 'parallel',
      deFundo: t.isBackground === true,
    });
  }
  return saida;
}

/**
 * A tarefa que `Run Build Task` roda sem perguntar.
 *
 * A marcada como padrão; se ninguém marcou e há UMA só do grupo, é ela. Com
 * duas e nenhuma marcada, devolve `null` — e quem chama pergunta, em vez de
 * escolher no chute.
 */
export function tarefaPadrao(
  tarefas: readonly Tarefa[],
  grupo: GrupoDeTarefa
): Tarefa | null {
  const doGrupo = tarefas.filter((t) => t.grupo === grupo);
  return doGrupo.find((t) => t.padraoDoGrupo) ?? (doGrupo.length === 1 ? doGrupo[0] ?? null : null);
}

/**
 * Um passo do plano: o que roda JUNTO.
 *
 * O plano é uma lista de passos, e um passo só começa quando o anterior
 * terminou. Dentro de um passo, tudo roda ao mesmo tempo.
 */
export type Passo = readonly Tarefa[];

export interface Plano {
  readonly passos: readonly Passo[];
}

/**
 * Monta o plano de execução de uma tarefa, resolvendo as dependências.
 *
 * **Ciclo é erro, e com os nomes.** `a` depende de `b` que depende de `a` não
 * tem ordem possível; rodar assim mesmo daria uma sequência inventada, e
 * descobrir isso no meio de um build é caro.
 *
 * Dependência que não existe também é erro: silenciar transformaria um `label`
 * digitado errado em "a tarefa rodou sem o build antes", que é o pior desfecho.
 */
export function planoDe(tarefas: readonly Tarefa[], nome: string): Plano {
  const porNome = new Map(tarefas.map((t) => [t.nome, t]));
  const alvo = porNome.get(nome);
  if (alvo === undefined) throw new Error(`A tarefa "${nome}" não existe no tasks.json.`);

  const passos: Tarefa[][] = [];
  const emCurso: string[] = [];
  const prontas = new Set<string>();

  const dependenciasDe = (t: Tarefa): readonly Tarefa[] =>
    t.dependeDe.map((d) => {
      const dep = porNome.get(d);
      if (dep === undefined) {
        throw new Error(`A tarefa "${t.nome}" depende de "${d}", que não existe no tasks.json.`);
      }
      return dep;
    });

  /**
   * Põe no plano o que `t` precisa e, se `incluirT`, a própria `t`.
   *
   * O `incluirT` é o que faz o modo paralelo funcionar: as dependências das
   * dependências precisam entrar ANTES, mas as dependências diretas têm de
   * sobrar para entrar TODAS JUNTAS num passo só. Sem separar as duas coisas,
   * cada uma virava um passo e o paralelo era sequência com outro nome.
   */
  const preparar = (t: Tarefa, incluirT: boolean): void => {
    if (prontas.has(t.nome)) return;
    if (emCurso.includes(t.nome)) {
      throw new Error(
        `As tarefas dependem umas das outras em círculo: ${[...emCurso, t.nome].join(' → ')}.`
      );
    }
    emCurso.push(t.nome);

    const deps = dependenciasDe(t);
    if (t.ordem === 'sequence') {
      for (const dep of deps) preparar(dep, true);
    } else {
      for (const dep of deps) preparar(dep, false);
      const juntas = deps.filter((d) => !prontas.has(d.nome));
      if (juntas.length > 0) {
        passos.push(juntas);
        for (const d of juntas) prontas.add(d.nome);
      }
    }

    emCurso.pop();
    if (incluirT && !prontas.has(t.nome)) {
      passos.push([t]);
      prontas.add(t.nome);
    }
  };

  preparar(alvo, true);
  return { passos };
}

// ---------------------------------------------------------------------------
// O que a IDE entende, e o que ela ignora
// ---------------------------------------------------------------------------
//
// **Entende:** `label`, `command`, `args`, `options.cwd`, `group` (nas duas
// formas), `dependsOn`, `dependsOrder` e `isBackground`.
//
// **Ignora, e por quê:**
//
// - `type` (`shell` / `process`): tudo aqui roda no shell, que é o que a IDE
//   tem. Distinguir os dois exigiria um segundo caminho de execução para um
//   ganho que ninguém pediu.
// - `problemMatcher`: é o T008, e ele está no lote E. Fazer meia versão agora
//   deixaria duas implementações para juntar depois.
// - `presentation`, `runOptions`, `windows`/`linux`/`osx`: configuração de
//   janela e de sistema operacional que esta IDE não tem onde aplicar.
