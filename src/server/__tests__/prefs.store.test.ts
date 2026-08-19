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
