import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PreferencesStore } from '../prefs';
import { padroes } from '../../shared/prefs';

function comStore(fn: (store: PreferencesStore, arquivo: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-prefs-'));
  const arquivo = path.join(dir, 'config.json');
  try {
    fn(new PreferencesStore(arquivo), arquivo);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('arquivo ausente devolve os padrões e não cria nada', () => {
  comStore((store, arquivo) => {
    assert.deepEqual(store.ler(), padroes());
    assert.equal(fs.existsSync(arquivo), false, 'ler não pode criar o arquivo');
  });
});

test('JSON quebrado devolve os padrões e preserva o arquivo do usuário', () => {
  comStore((store, arquivo) => {
    fs.writeFileSync(arquivo, '{ "editor.fontSize": 18,,, }');
    assert.deepEqual(store.ler(), padroes());
    assert.match(fs.readFileSync(arquivo, 'utf8'), /18/, 'o arquivo não pode ser apagado');
  });
});

test('grava e relê', () => {
  comStore((store) => {
    const depois = store.gravar({ 'editor.fontSize': 20 });
    assert.equal(depois['editor.fontSize'], 20);
    assert.equal(store.ler()['editor.fontSize'], 20);
    assert.equal(store.ler()['editor.tabSize'], 4, 'o resto fica no padrão');
  });
});

test('gravar preserva chave desconhecida — a configuração de uma versão futura', () => {
  comStore((store, arquivo) => {
    fs.writeFileSync(arquivo, JSON.stringify({ 'algo.do.futuro': { a: 1 } }));
    store.gravar({ 'editor.fontSize': 20 });
    const cru = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(cru['algo.do.futuro'], { a: 1 });
    assert.equal(cru['editor.fontSize'], 20);
  });
});

test('o arquivo gravado é 600 e a pasta 700', () => {
  comStore((store, arquivo) => {
    store.gravar({ 'editor.tabSize': 2 });
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(arquivo)).mode & 0o777, 0o700);
  });
});

test('não sobra arquivo temporário depois de gravar', () => {
  comStore((store, arquivo) => {
    store.gravar({ 'editor.tabSize': 2 });
    assert.equal(fs.existsSync(`${arquivo}.tmp`), false);
  });
});

test('garantirArquivo cria com os padrões e não sobrescreve o que existe', () => {
  comStore((store, arquivo) => {
    store.garantirArquivo();
    assert.deepEqual(JSON.parse(fs.readFileSync(arquivo, 'utf8')), padroes());

    store.gravar({ 'editor.fontSize': 22 });
    store.garantirArquivo();
    assert.equal(store.ler()['editor.fontSize'], 22);
  });
});

test('valor fora da faixa em disco não contamina a leitura', () => {
  comStore((store, arquivo) => {
    fs.writeFileSync(arquivo, JSON.stringify({ 'editor.fontSize': 900, 'editor.tabSize': 2 }));
    assert.equal(store.ler()['editor.fontSize'], 13);
    assert.equal(store.ler()['editor.tabSize'], 2);
  });
});

// ---------------------------------------------------------------------------
// Preferências por projeto (T002, spec 075)
// ---------------------------------------------------------------------------

test('o .vscode/settings.json do projeto sobrescreve o do usuário', () => {
  comStore((_store, arquivo) => {
    const projeto = path.join(path.dirname(arquivo), 'projeto');
    fs.mkdirSync(path.join(projeto, '.vscode'), { recursive: true });
    fs.writeFileSync(
      path.join(projeto, '.vscode', 'settings.json'),
      JSON.stringify({ 'editor.tabSize': 2 })
    );

    const comProjeto = new PreferencesStore(arquivo, () => projeto);
    comProjeto.gravar({ 'editor.tabSize': 8, 'editor.fontSize': 20 });

    assert.equal(comProjeto.ler()['editor.tabSize'], 2, 'o projeto manda');
    assert.equal(comProjeto.ler()['editor.fontSize'], 20, 'no resto, o usuário');
    // O que foi GRAVADO continua sendo o do usuário: a tela nunca escreve no
    // arquivo do projeto, que é versionado.
    assert.equal(comProjeto.lerDoUsuario()['editor.tabSize'], 8);
    assert.deepEqual([...comProjeto.chavesSobrescritas()], ['editor.tabSize']);
  });
});

test('sem projeto aberto, as preferências são só as do usuário', () => {
  comStore((store) => {
    store.gravar({ 'editor.tabSize': 8 });
    assert.equal(store.ler()['editor.tabSize'], 8);
    assert.equal(store.caminhoDoProjeto(), null);
    assert.deepEqual([...store.chavesSobrescritas()], []);
  });
});

test('settings.json do projeto estragado não derruba nada', () => {
  comStore((_store, arquivo) => {
    const projeto = path.join(path.dirname(arquivo), 'projeto');
    fs.mkdirSync(path.join(projeto, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(projeto, '.vscode', 'settings.json'), '{ isto nao e json');

    const comProjeto = new PreferencesStore(arquivo, () => projeto);
    comProjeto.gravar({ 'editor.fontSize': 17 });
    assert.equal(comProjeto.ler()['editor.fontSize'], 17);
  });
});

test('o arquivo do projeto nasce VAZIO, e não com os padrões', () => {
  // Um arquivo cheio de valores iguais aos do usuário sobrescreveria tudo sem
  // ninguém pedir — e o primeiro commit levaria isso para os outros.
  comStore((_store, arquivo) => {
    const projeto = path.join(path.dirname(arquivo), 'projeto');
    fs.mkdirSync(projeto, { recursive: true });
    const comProjeto = new PreferencesStore(arquivo, () => projeto);

    const criado = comProjeto.garantirArquivoDoProjeto();
    assert.equal(criado, path.join(projeto, '.vscode', 'settings.json'));
    assert.deepEqual(JSON.parse(fs.readFileSync(criado, 'utf8')), {});
    assert.deepEqual([...comProjeto.chavesSobrescritas()], []);
  });
});
