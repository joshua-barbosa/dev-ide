import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ATENDIDOS_PELO_EDITOR,
  COMMANDS,
  MENUS,
  comandoDoAtalho,
  escapaDoTerminal,
  estaDisponivel,
  filtrarComandos,
  formatarAtalho,
  itensDoMenu,
  type Command,
  type ContextoDeComandos,
} from '../commands';
import { ehSemTitulo, proximoSemTitulo } from '../untitled';
import {
  ICONE_DE_ARQUIVO, ICONES_DE_ARQUIVO, iconeDeArquivo,
} from '../editor/arquivos';
import { iconeDaLinguagem } from '../editor/idiomas';
import { ICONES_DE_SERVICO, resolverIcone } from '../icons';

const NADA: ContextoDeComandos = {
  temEditor: false,
  temProjeto: false,
  abaSuja: false,
  temAba: false,
  temSelecao: false,
  temConexaoAtiva: false,
  cofreDestrancado: false,
  executando: false,
};

const TUDO: ContextoDeComandos = {
  temEditor: true,
  temProjeto: true,
  abaSuja: true,
  temAba: true,
  temSelecao: true,
  temConexaoAtiva: true,
  cofreDestrancado: true,
  executando: true,
};

// ---- integridade do registro (AC-1, AC-4) ----

test('nenhum id de comando se repete', () => {
  const ids = COMMANDS.map((c) => c.id);
  assert.deepEqual([...new Set(ids)].length, ids.length);
});

test('todo comando pertence a um dos oito menus declarados', () => {
  const conhecidos = new Set(MENUS.map(([id]) => id));
  for (const cmd of COMMANDS) {
    assert.ok(conhecidos.has(cmd.menu), `menu desconhecido em ${cmd.id}: ${cmd.menu}`);
  }
});

test('os oito menus da barra saem na ordem do VS Code', () => {
  assert.deepEqual(
    MENUS.map(([, rotulo]) => rotulo),
    ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help']
  );
});

test('todo menu tem pelo menos um comando', () => {
  for (const [id] of MENUS) {
    assert.ok(COMMANDS.some((c) => c.menu === id), `menu vazio: ${id}`);
  }
});

test('os comandos de um menu saem com o grupo em ordem crescente', () => {
  // Grupo fora de ordem geraria separador no lugar errado.
  for (const [id] of MENUS) {
    const grupos = COMMANDS.filter((c) => c.menu === id).map((c) => c.group);
    assert.deepEqual(grupos, [...grupos].sort((a, b) => a - b), `grupos fora de ordem em ${id}`);
  }
});

// ---- disponibilidade (AC-3, AC-6) ----

test('comando sem condição está sempre disponível', () => {
  const cmd: Command = { id: 'x', label: 'X', menu: 'file', group: 1 };
  assert.equal(estaDisponivel(cmd, NADA), true);
});

test('comando com condição segue o contexto', () => {
  const cmd: Command = { id: 'x', label: 'X', menu: 'file', group: 1, when: 'temEditor' };
  assert.equal(estaDisponivel(cmd, NADA), false);
  assert.equal(estaDisponivel(cmd, TUDO), true);
});

test('pendente nunca está disponível, nem com o contexto inteiro ligado', () => {
  for (const cmd of COMMANDS.filter((c) => c.pending === true)) {
    assert.equal(estaDisponivel(cmd, TUDO), false, `pendente disponível: ${cmd.id}`);
  }
});

// ---- menu (AC-5) ----

test('o menu mostra o indisponível, para o usuário ver o que existe', () => {
  const itens = itensDoMenu('file', NADA);
  const salvar = itens.find((i) => i.cmd.id === 'file.save');
  assert.ok(salvar !== undefined, 'Save deveria estar no menu');
  assert.equal(salvar.disponivel, false);
});

test('a troca de grupo vira separador, e o primeiro item nunca tem um', () => {
  const comandos: Command[] = [
    { id: 'a', label: 'A', menu: 'file', group: 1 },
    { id: 'b', label: 'B', menu: 'file', group: 1 },
    { id: 'c', label: 'C', menu: 'file', group: 2 },
  ];
  assert.deepEqual(
    itensDoMenu('file', NADA, comandos).map((i) => i.separadorAntes),
    [false, false, true]
  );
});

// ---- paleta (AC-11) ----

test('a paleta esconde o indisponível — resultado que não executa é ruído', () => {
  const ids = filtrarComandos('save', NADA).map((c) => c.id);
  assert.equal(ids.includes('file.save'), false);
  assert.ok(filtrarComandos('save', TUDO).map((c) => c.id).includes('file.save'));
});

test('a paleta nunca oferece um comando pendente', () => {
  const achados = filtrarComandos('', TUDO);
  assert.equal(achados.some((c) => c.pending === true), false);
});

test('busca por partes acha o comando fora de ordem', () => {
  const ids = filtrarComandos('pal command', TUDO).map((c) => c.id);
  assert.ok(ids.includes('view.commandPalette'), 'deveria achar Command Palette…');
});

test('texto vazio devolve tudo que está disponível', () => {
  const esperado = COMMANDS.filter((c) => estaDisponivel(c, TUDO)).length;
  assert.equal(filtrarComandos('', TUDO).length, esperado);
});

test('busca sem correspondência devolve vazio, não tudo', () => {
  assert.deepEqual(filtrarComandos('zzzzzz', TUDO), []);
});

// ---- atalhos (AC-2) ----

test('formata o atalho na mesma forma que as declarações usam', () => {
  const base = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  assert.equal(formatarAtalho({ ...base, ctrlKey: true, shiftKey: true, key: 'p' }), 'Ctrl+Shift+P');
  assert.equal(formatarAtalho({ ...base, ctrlKey: true, key: 's' }), 'Ctrl+S');
  assert.equal(formatarAtalho({ ...base, altKey: true, key: 'z' }), 'Alt+Z');
  assert.equal(formatarAtalho({ ...base, ctrlKey: true, key: 'Enter' }), 'Ctrl+Enter');
});

test('Cmd do Mac conta como Ctrl', () => {
  const base = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
  assert.equal(formatarAtalho({ ...base, key: 's' }), 'Ctrl+S');
});

test('todo atalho declarado bate com o que a formatação produz', () => {
  // Sem isto, uma declaração como "Ctrl+shift+P" nunca dispararia e ninguém veria.
  const validas = /^(Ctrl\+)?(Shift\+)?(Alt\+)?([A-Z]|Enter|Tab|Escape|Arrow(Up|Down|Left|Right)|\/|`)$/;
  for (const cmd of COMMANDS) {
    if (cmd.keybinding === undefined) continue;
    assert.match(cmd.keybinding, validas, `atalho fora do formato em ${cmd.id}`);
  }
});

test('o atalho acha o comando disponível e ignora o indisponível', () => {
  assert.equal(comandoDoAtalho('Ctrl+S', TUDO)?.id, 'file.save');
  assert.equal(comandoDoAtalho('Ctrl+S', NADA), null);
  assert.equal(comandoDoAtalho('Ctrl+Alt+Q', TUDO), null);
});

// ---- untitled (AC-13) ----

test('sem nenhuma aba, o primeiro é untitled-1', () => {
  assert.equal(proximoSemTitulo([]), 'untitled-1');
});

test('a numeração usa o maior em uso, não a contagem', () => {
  // Com 1 e 3 abertos, contar daria 3 — que já existe.
  assert.equal(proximoSemTitulo(['untitled-1', 'untitled-3']), 'untitled-4');
});

test('títulos fora do padrão são ignorados na numeração', () => {
  assert.equal(proximoSemTitulo(['utils.ts', 'untitled-2', 'untitled-x']), 'untitled-3');
});

test('reconhece o que é aba sem título', () => {
  assert.equal(ehSemTitulo('untitled-7'), true);
  assert.equal(ehSemTitulo('untitled'), false);
  assert.equal(ehSemTitulo('meu-untitled-1'), false);
  assert.equal(ehSemTitulo('utils.ts'), false);
});

// ---- ícone por extensão (spec 007) ----

test('extensão sem linguagem própria tem ícone próprio', () => {
  assert.equal(iconeDeArquivo('LEIAME.md'), 'vscode-icons:file-type-markdown');
  assert.equal(iconeDeArquivo('/a/b/deploy.yml'), 'vscode-icons:file-type-yaml');
  assert.equal(iconeDeArquivo('escola.db'), 'vscode-icons:file-type-db');
});

test('arquivo de linguagem cai no ícone da linguagem', () => {
  assert.equal(iconeDeArquivo('utils.ts', 'typescript'), iconeDaLinguagem('typescript'));
  assert.equal(iconeDeArquivo('app.py', 'python'), iconeDaLinguagem('python'));
});

test('arquivo sem extensão reconhecida cai no papel em branco', () => {
  assert.equal(iconeDeArquivo('LICENSE'), ICONE_DE_ARQUIVO);
  assert.equal(iconeDeArquivo('dados.xyz', 'plain'), ICONE_DE_ARQUIVO);
});

test('nome inteiro também casa, não só a extensão', () => {
  assert.equal(iconeDeArquivo('.gitignore'), 'vscode-icons:file-type-git');
});

test('todo ícone de arquivo declarado está no pacote offline', () => {
  // Um ícone fora da lista cairia no genérico em tempo de execução, calado.
  for (const icone of ICONES_DE_ARQUIVO) {
    assert.equal(resolverIcone(icone), icone, `fora do pacote: ${icone}`);
  }
});

test('todo ícone de serviço declarado está no pacote offline', () => {
  for (const icone of Object.values(ICONES_DE_SERVICO)) {
    assert.equal(resolverIcone(icone), icone, `fora do pacote: ${icone}`);
  }
});

test('atalho com seta é formatado como as declarações esperam', () => {
  // As setas entraram com o menu Selection; sem isto, `Alt+ArrowUp` nunca
  // dispararia e ninguém notaria — o comando existiria só no menu.
  const base = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  assert.equal(formatarAtalho({ ...base, altKey: true, key: 'ArrowUp' }), 'Alt+ArrowUp');
  assert.equal(
    formatarAtalho({ ...base, ctrlKey: true, shiftKey: true, altKey: true, key: 'ArrowDown' }),
    'Ctrl+Shift+Alt+ArrowDown'
  );
  assert.equal(
    formatarAtalho({ ...base, shiftKey: true, altKey: true, key: 'ArrowRight' }),
    'Shift+Alt+ArrowRight'
  );
});

test('atalho repetido só existe entre comandos que são apelidos', () => {
  // `comandoDoAtalho` devolve o primeiro declarado. Isso é seguro enquanto as
  // repetições forem o MESMO comando alcançado de dois menus. No dia em que
  // duas ações diferentes dividirem um atalho, uma delas para de disparar — e
  // em silêncio, que é o pior jeito de quebrar.
  const APELIDOS_CONHECIDOS: ReadonlyArray<readonly string[]> = [
    ['view.commandPalette', 'help.commands'],
    ['edit.findInFiles', 'view.search'],
  ];

  const porAtalho = new Map<string, string[]>();
  for (const cmd of COMMANDS) {
    if (cmd.keybinding === undefined) continue;
    const lista = porAtalho.get(cmd.keybinding) ?? [];
    lista.push(cmd.id);
    porAtalho.set(cmd.keybinding, lista);
  }

  for (const [atalho, ids] of porAtalho) {
    if (ids.length === 1) continue;
    const conhecido = APELIDOS_CONHECIDOS.some(
      (par) => par.length === ids.length && par.every((id) => ids.includes(id))
    );
    assert.ok(
      conhecido,
      `"${atalho}" é dividido por ${ids.join(', ')}. Se forem apelidos, declare em ` +
        'APELIDOS_CONHECIDOS; se não, um deles nunca vai disparar.'
    );
  }
});

test('todo comando atendido pelo editor existe e não está pendente', () => {
  // Um id errado aqui produziria um item de menu habilitado e inerte — pior
  // que "em breve", porque promete e não cumpre.
  for (const id of ATENDIDOS_PELO_EDITOR) {
    const cmd = COMMANDS.find((c) => c.id === id);
    assert.ok(cmd !== undefined, `id inexistente em ATENDIDOS_PELO_EDITOR: ${id}`);
    assert.notEqual(cmd.pending, true, `${id} está atendido e pendente ao mesmo tempo`);
  }
});

// ---------------------------------------------------------------------------
// Atalhos que escapam do terminal (spec 014)
// ---------------------------------------------------------------------------

test('os atalhos de esconder painel e lateral escapam do terminal', () => {
  // Sem isto, com o foco no terminal, `Ctrl+J` só escrevia nova linha: o
  // emulador o consome porque no shell ele É nova linha.
  assert.equal(escapaDoTerminal('Ctrl+J'), true);
  assert.equal(escapaDoTerminal('Ctrl+B'), true);
  assert.equal(escapaDoTerminal('Ctrl+`'), true);
  assert.equal(escapaDoTerminal('Ctrl+Shift+P'), true);
});

test('Ctrl+C NÃO escapa — sem ele não há como interromper um programa', () => {
  // É o limite da lista: deixar tudo passar tiraria do terminal justamente o
  // que faz dele um terminal.
  for (const atalho of ['Ctrl+C', 'Ctrl+D', 'Ctrl+Z', 'Ctrl+A', 'Ctrl+L', 'Ctrl+R']) {
    assert.equal(escapaDoTerminal(atalho), false, atalho);
  }
});

test('todo atalho que escapa pertence a um comando declarado', () => {
  // Se um deles deixar de existir, escapar do terminal vira tecla morta.
  for (const atalho of ['Ctrl+J', 'Ctrl+B', 'Ctrl+`', 'Ctrl+Shift+P']) {
    assert.ok(
      COMMANDS.some((c) => c.keybinding === atalho),
      `nenhum comando declara ${atalho}`
    );
  }
});
