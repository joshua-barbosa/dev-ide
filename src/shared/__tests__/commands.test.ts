import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMMANDS,
  MENUS,
  comandoDoAtalho,
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
};

const TUDO: ContextoDeComandos = {
  temEditor: true,
  temProjeto: true,
  abaSuja: true,
  temAba: true,
  temSelecao: true,
  temConexaoAtiva: true,
  cofreDestrancado: true,
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
  const validas = /^(Ctrl\+)?(Shift\+)?(Alt\+)?([A-Z]|Enter|Tab|Escape|\/|`)$/;
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
