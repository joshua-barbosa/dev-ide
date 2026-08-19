// Registro de comandos da IDE.
//
// Este arquivo guarda DECLARAÇÕES, nunca funções. Quem executa é um mapa
// `id → função` montado na interface. A separação existe por dois motivos:
//
// 1. Agrupar, separar, filtrar e decidir disponibilidade é a lógica que erra na
//    prática — e aqui ela roda em `node:test`, sem navegador.
// 2. Guardar a função arrastaria React para dentro de `shared`, contra o
//    Artigo III.
//
// A barra de menu, a paleta e os atalhos são três leituras desta mesma lista.
// Comando novo entra aqui uma vez e aparece nos três.

export type MenuId =
  | 'file' | 'edit' | 'selection' | 'view' | 'go' | 'run' | 'terminal' | 'help';

/** Ordem da barra, igual à do VS Code. */
export const MENUS: ReadonlyArray<readonly [MenuId, string]> = [
  ['file', 'File'],
  ['edit', 'Edit'],
  ['selection', 'Selection'],
  ['view', 'View'],
  ['go', 'Go'],
  ['run', 'Run'],
  ['terminal', 'Terminal'],
  ['help', 'Help'],
];

/**
 * Chaves de contexto que ligam e desligam comandos.
 *
 * São chaves declaradas, e não funções arbitrárias, para a disponibilidade
 * continuar sendo dado testável.
 */
export interface ContextoDeComandos {
  readonly temEditor: boolean;
  readonly temProjeto: boolean;
  readonly abaSuja: boolean;
  readonly temAba: boolean;
  readonly temSelecao: boolean;
  readonly temConexaoAtiva: boolean;
  readonly cofreDestrancado: boolean;
  /** Há código rodando agora (spec 013). */
  readonly executando: boolean;
  /** Navegação Back/Forward (spec 016). */
  readonly podeVoltar: boolean;
  readonly podeAvancar: boolean;
}

export type ChaveDeContexto = keyof ContextoDeComandos;

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly menu: MenuId;
  /** Comandos do mesmo grupo ficam juntos; a troca de grupo vira separador. */
  readonly group: number;
  readonly keybinding?: string;
  readonly when?: ChaveDeContexto;
  /**
   * Declarado mas ainda sem implementação. Aparece no menu desabilitado e
   * marcado — o usuário pediu ver o mapa inteiro para decidir o que fica.
   */
  readonly pending?: boolean;
}

// ---------------------------------------------------------------------------
// Declarações
// ---------------------------------------------------------------------------

const DECLARADOS = [
  // ---- File ----
  { id: 'file.new', label: 'New Text File', menu: 'file', group: 1, keybinding: 'Ctrl+N' },
  { id: 'file.newProject', label: 'New Project…', menu: 'file', group: 1 },
  { id: 'file.open', label: 'Open File…', menu: 'file', group: 2, keybinding: 'Ctrl+O' },
  { id: 'file.openFolder', label: 'Open Folder…', menu: 'file', group: 2, keybinding: 'Ctrl+K' },
  { id: 'file.openWorkspace', label: 'Open Workspace…', menu: 'file', group: 2 },
  { id: 'file.openRecent', label: 'Open Recent', menu: 'file', group: 2 },
  { id: 'file.save', label: 'Save', menu: 'file', group: 3, keybinding: 'Ctrl+S', when: 'temEditor' },
  { id: 'file.saveAs', label: 'Save As…', menu: 'file', group: 3, keybinding: 'Ctrl+Shift+S', when: 'temEditor' },
  { id: 'file.saveAll', label: 'Save All', menu: 'file', group: 3, when: 'abaSuja' },
  { id: 'file.autoSave', label: 'Auto Save', menu: 'file', group: 4 },
  { id: 'file.preferences', label: 'Preferences', menu: 'file', group: 4 },
  { id: 'file.revert', label: 'Revert File', menu: 'file', group: 5, when: 'temEditor' },
  { id: 'file.closeEditor', label: 'Close Editor', menu: 'file', group: 5, keybinding: 'Ctrl+W', when: 'temAba' },

  // ---- Edit ----
  { id: 'edit.undo', label: 'Undo', menu: 'edit', group: 1, keybinding: 'Ctrl+Z', when: 'temEditor' },
  { id: 'edit.redo', label: 'Redo', menu: 'edit', group: 1, keybinding: 'Ctrl+Shift+Z', when: 'temEditor' },
  { id: 'edit.cut', label: 'Cut', menu: 'edit', group: 2, keybinding: 'Ctrl+X', when: 'temEditor' },
  { id: 'edit.copy', label: 'Copy', menu: 'edit', group: 2, keybinding: 'Ctrl+C', when: 'temEditor' },
  { id: 'edit.paste', label: 'Paste', menu: 'edit', group: 2, keybinding: 'Ctrl+V', when: 'temEditor' },
  { id: 'edit.find', label: 'Find', menu: 'edit', group: 3, keybinding: 'Ctrl+F' },
  { id: 'edit.replace', label: 'Replace', menu: 'edit', group: 3, keybinding: 'Ctrl+H' },
  { id: 'edit.findInFiles', label: 'Find in Files', menu: 'edit', group: 4, keybinding: 'Ctrl+Shift+F', pending: true },
  { id: 'edit.replaceInFiles', label: 'Replace in Files', menu: 'edit', group: 4, keybinding: 'Ctrl+Shift+H', pending: true },
  { id: 'edit.toggleComment', label: 'Toggle Line Comment', menu: 'edit', group: 5, keybinding: 'Ctrl+/' },
  { id: 'edit.toggleBlockComment', label: 'Toggle Block Comment', menu: 'edit', group: 5, keybinding: 'Ctrl+Shift+A' },
  { id: 'edit.snippets', label: 'Snippets…', menu: 'edit', group: 5, keybinding: 'Ctrl+Shift+J' },
  { id: 'edit.emmet', label: 'Emmet: Expand Abbreviation', menu: 'edit', group: 5, keybinding: 'Tab', pending: true },

  // ---- Selection ----
  { id: 'selection.all', label: 'Select All', menu: 'selection', group: 1, keybinding: 'Ctrl+A', when: 'temEditor' },
  { id: 'selection.expand', label: 'Expand Selection', menu: 'selection', group: 1, keybinding: 'Shift+Alt+ArrowRight' },
  { id: 'selection.shrink', label: 'Shrink Selection', menu: 'selection', group: 1, keybinding: 'Shift+Alt+ArrowLeft' },
  { id: 'selection.copyLineUp', label: 'Copy Line Up', menu: 'selection', group: 2, keybinding: 'Ctrl+Shift+Alt+ArrowUp' },
  { id: 'selection.copyLineDown', label: 'Copy Line Down', menu: 'selection', group: 2, keybinding: 'Ctrl+Shift+Alt+ArrowDown' },
  { id: 'selection.moveLineUp', label: 'Move Line Up', menu: 'selection', group: 2, keybinding: 'Alt+ArrowUp' },
  { id: 'selection.moveLineDown', label: 'Move Line Down', menu: 'selection', group: 2, keybinding: 'Alt+ArrowDown' },
  { id: 'selection.duplicate', label: 'Duplicate Selection', menu: 'selection', group: 2 },
  { id: 'selection.addCursorAbove', label: 'Add Cursor Above', menu: 'selection', group: 3, keybinding: 'Shift+Alt+ArrowUp' },
  { id: 'selection.addCursorBelow', label: 'Add Cursor Below', menu: 'selection', group: 3, keybinding: 'Shift+Alt+ArrowDown' },
  { id: 'selection.cursorsToLineEnds', label: 'Add Cursors to Line Ends', menu: 'selection', group: 3, keybinding: 'Shift+Alt+I' },
  { id: 'selection.addNextOccurrence', label: 'Add Next Occurrence', menu: 'selection', group: 3, keybinding: 'Ctrl+D' },
  { id: 'selection.addPrevOccurrence', label: 'Add Previous Occurrence', menu: 'selection', group: 3 },
  { id: 'selection.allOccurrences', label: 'Select All Occurrences', menu: 'selection', group: 3 },

  // ---- View ----
  { id: 'view.commandPalette', label: 'Command Palette…', menu: 'view', group: 1, keybinding: 'Ctrl+Shift+P' },
  { id: 'view.explorer', label: 'Explorer', menu: 'view', group: 2, keybinding: 'Ctrl+Shift+E' },
  // Mesma feature que `edit.findInFiles`, vista da lateral em vez do menu Edit —
  // por isso compartilham o atalho. Ver a nota sobre atalhos repetidos abaixo.
  { id: 'view.search', label: 'Search', menu: 'view', group: 2, keybinding: 'Ctrl+Shift+F', pending: true },
  { id: 'view.symbols', label: 'Symbols', menu: 'view', group: 2 },
  { id: 'view.database', label: 'Database', menu: 'view', group: 2 },
  { id: 'view.service', label: 'Service', menu: 'view', group: 2 },
  { id: 'view.output', label: 'Output', menu: 'view', group: 3 },
  { id: 'view.problems', label: 'Problems', menu: 'view', group: 3, keybinding: 'Ctrl+Shift+M' },
  { id: 'view.toggleSidebar', label: 'Toggle Primary Side Bar', menu: 'view', group: 3, keybinding: 'Ctrl+B' },
  { id: 'view.togglePanel', label: 'Toggle Panel', menu: 'view', group: 3, keybinding: 'Ctrl+J' },
  { id: 'view.splitEditor', label: 'Split Editor', menu: 'view', group: 3, keybinding: 'Ctrl+\\', when: 'temAba' },
  { id: 'view.appearance', label: 'Appearance', menu: 'view', group: 4 },
  { id: 'view.wordWrap', label: 'Word Wrap', menu: 'view', group: 4, keybinding: 'Alt+Z' },

  // ---- Go ----
  { id: 'go.file', label: 'Go to File…', menu: 'go', group: 1, keybinding: 'Ctrl+P' },
  { id: 'go.symbol', label: 'Go to Symbol…', menu: 'go', group: 1, keybinding: 'Ctrl+Shift+O' },
  { id: 'go.line', label: 'Go to Line…', menu: 'go', group: 1, keybinding: 'Ctrl+G', when: 'temEditor' },
  { id: 'go.back', label: 'Back', menu: 'go', group: 2, keybinding: 'Alt+ArrowLeft', when: 'podeVoltar' },
  { id: 'go.forward', label: 'Forward', menu: 'go', group: 2, keybinding: 'Alt+ArrowRight', when: 'podeAvancar' },

  // ---- Run ----
  { id: 'run.file', label: 'Run File', menu: 'run', group: 1, keybinding: 'Ctrl+Enter', when: 'temEditor' },
  { id: 'run.selection', label: 'Run Selection', menu: 'run', group: 1, when: 'temEditor' },
  { id: 'run.stop', label: 'Stop', menu: 'run', group: 2, when: 'executando' },
  { id: 'run.disconnect', label: 'Disconnect Connection', menu: 'run', group: 3, when: 'temConexaoAtiva' },

  // ---- Terminal ----
  { id: 'terminal.new', label: 'New Terminal', menu: 'terminal', group: 1, keybinding: 'Ctrl+`' },
  { id: 'terminal.connection', label: 'Abrir conexão no terminal', menu: 'terminal', group: 1, when: 'temConexaoAtiva' },
  { id: 'terminal.split', label: 'Split Terminal', menu: 'terminal', group: 1, pending: true },
  { id: 'terminal.runTask', label: 'Run Task…', menu: 'terminal', group: 2, keybinding: 'Ctrl+Shift+R' },

  // ---- Help ----
  { id: 'help.commands', label: 'Show All Commands', menu: 'help', group: 1, keybinding: 'Ctrl+Shift+P' },
  { id: 'help.about', label: 'About dev-ide', menu: 'help', group: 2 },
  { id: 'help.docs', label: 'Documentation', menu: 'help', group: 2, pending: true },
] as const satisfies readonly Command[];

export const COMMANDS: readonly Command[] = DECLARADOS;

/**
 * Comandos atendidos pelo editor, e não pelo mapa de ações do App.
 *
 * Desde a spec 010 o editor é o Monaco, e ele já implementa busca, multi-cursor
 * e operações de linha — com os mesmos atalhos. Declará-los aqui é o que os tira
 * de "pendente" sem exigir uma entrada em `ACOES`: quem os executa é o editor,
 * quando a tecla chega nele.
 */
const ATENDIDOS = [
  'edit.find', 'edit.replace', 'edit.toggleComment', 'edit.toggleBlockComment',
  'selection.expand', 'selection.shrink',
  'selection.copyLineUp', 'selection.copyLineDown',
  'selection.moveLineUp', 'selection.moveLineDown', 'selection.duplicate',
  'selection.addCursorAbove', 'selection.addCursorBelow', 'selection.cursorsToLineEnds',
  'selection.addNextOccurrence', 'selection.addPrevOccurrence', 'selection.allOccurrences',
] as const;

export const ATENDIDOS_PELO_EDITOR: ReadonlySet<string> = new Set(ATENDIDOS);

/**
 * Ids que precisam de implementação — todos menos os pendentes.
 *
 * Existe para o COMPILADOR provar a completude, em vez de um teste: o mapa de
 * ações da interface é declarado como `Record<IdImplementado, ...>`, então
 * declarar um comando não pendente sem ligá-lo a uma função não compila. É a
 * mesma técnica que já garante a totalidade do mapa de ícones, e é melhor que
 * teste porque falha antes de rodar.
 */
export type IdImplementado = Exclude<
  Exclude<(typeof DECLARADOS)[number], { readonly pending: true }>['id'],
  (typeof ATENDIDOS)[number]
>;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Pendente nunca está disponível, mesmo que a condição bata. */
export function estaDisponivel(cmd: Command, ctx: ContextoDeComandos): boolean {
  if (cmd.pending === true) return false;
  return cmd.when === undefined ? true : ctx[cmd.when];
}

export interface ItemDeMenu {
  readonly cmd: Command;
  readonly disponivel: boolean;
  /** Verdadeiro quando um separador deve vir ANTES deste item. */
  readonly separadorAntes: boolean;
}

/**
 * Itens de um menu, com os separadores já calculados.
 *
 * O menu mostra o indisponível — é um mapa do que existe, e um item cinza
 * ensina que o comando existe e por que não dá agora. Quem esconde é a paleta.
 */
export function itensDoMenu(
  menu: MenuId,
  ctx: ContextoDeComandos,
  comandos: readonly Command[] = COMMANDS
): readonly ItemDeMenu[] {
  const doMenu = comandos.filter((c) => c.menu === menu);
  return doMenu.map((cmd, i) => ({
    cmd,
    disponivel: estaDisponivel(cmd, ctx),
    separadorAntes: i > 0 && doMenu[i - 1]!.group !== cmd.group,
  }));
}

/**
 * Resultado da paleta.
 *
 * Ao contrário do menu, aqui o indisponível some: a paleta é uma busca, e
 * resultado que não executa é ruído. Casa por partes, para "cmd pal" achar
 * "Command Palette…".
 */
export function filtrarComandos(
  texto: string,
  ctx: ContextoDeComandos,
  comandos: readonly Command[] = COMMANDS
): readonly Command[] {
  const termos = texto.toLowerCase().split(/\s+/).filter((t) => t !== '');
  return comandos
    .filter((c) => estaDisponivel(c, ctx))
    .filter((c) => {
      const alvo = `${c.label} ${c.id}`.toLowerCase();
      return termos.every((termo) => alvo.includes(termo));
    });
}

/**
 * Atalhos que a IDE tira do terminal.
 *
 * Existe por um defeito real: com o foco no terminal, `Ctrl+J` e `Ctrl+B` nunca
 * chegavam à IDE. O emulador os consome porque **no shell eles significam outra
 * coisa** — `Ctrl+J` é nova linha e `Ctrl+B` é "voltar um caractere" do
 * readline.
 *
 * A escolha aqui é deliberada e tem custo: dentro do terminal, estes quatro
 * deixam de valer para o shell. É o mesmo que o VS Code faz, e é o preço de o
 * usuário poder esconder o painel de onde ele está olhando.
 *
 * **A lista é curta de propósito.** Deixar passar tudo tiraria `Ctrl+C` do
 * terminal, e aí não haveria como interromper um programa — o oposto do que se
 * espera de um terminal.
 */
const ESCAPAM_DO_TERMINAL: ReadonlySet<string> = new Set([
  'Ctrl+J', // esconder/mostrar o painel
  'Ctrl+B', // esconder/mostrar a lateral
  'Ctrl+`', // novo terminal
  'Ctrl+Shift+P', // paleta de comandos
]);

export function escapaDoTerminal(atalho: string): boolean {
  return ESCAPAM_DO_TERMINAL.has(atalho);
}

/** Evento de teclado no formato dos `keybinding` declarados. */
export interface TeclaPressionada {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export function formatarAtalho(e: TeclaPressionada): string {
  const partes: string[] = [];
  // `metaKey` entra como Ctrl para o mesmo atalho valer no Mac.
  if (e.ctrlKey || e.metaKey) partes.push('Ctrl');
  if (e.shiftKey) partes.push('Shift');
  if (e.altKey) partes.push('Alt');

  const tecla = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  partes.push(tecla);
  return partes.join('+');
}

/**
 * O comando de um atalho, se houver um disponível.
 *
 * **Atalho repetido devolve o primeiro declarado.** Isso é aceitável apenas
 * porque as repetições existentes são APELIDOS — o mesmo comando alcançado de
 * dois menus (`view.commandPalette` e `help.commands`; `view.search` e
 * `edit.findInFiles`). Se um dia duas ações diferentes dividirem um atalho, uma
 * delas nunca dispara, e em silêncio.
 */
export function comandoDoAtalho(
  atalho: string,
  ctx: ContextoDeComandos,
  comandos: readonly Command[] = COMMANDS
): Command | null {
  return comandos.find((c) => c.keybinding === atalho && estaDisponivel(c, ctx)) ?? null;
}
