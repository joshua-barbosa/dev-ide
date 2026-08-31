import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EstadoStore } from '../estado';

function comStore(fn: (store: EstadoStore, arquivo: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-estado-'));
  const arquivo = path.join(dir, 'state.json');
  try {
    fn(new EstadoStore(arquivo), arquivo);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('sem arquivo, a IDE não tem pasta aberta', () => {
  comStore((store, arquivo) => {
    assert.deepEqual(store.ler(), { pastas: [], recentes: [] });
    assert.equal(fs.existsSync(arquivo), false, 'ler não pode criar o arquivo');
  });
});

test('estado corrompido não impede a IDE de subir', () => {
  comStore((store, arquivo) => {
    fs.writeFileSync(arquivo, 'isto não é json');
    assert.deepEqual(store.ler(), { pastas: [], recentes: [] });
  });
});

test('abrir persiste e sobrevive a reler', () => {
  comStore((store, arquivo) => {
    store.abrir('/casa/projeto');
    assert.deepEqual(new EstadoStore(arquivo).ler().pastas, ['/casa/projeto']);
  });
});

test('o histórico atravessa fechar', () => {
  comStore((store) => {
    store.abrir('/a');
    store.abrir('/b');
    const depois = store.fechar();
    assert.deepEqual(depois.pastas, []);
    assert.deepEqual(depois.recentes, ['/b', '/a']);
  });
});

test('esquecer remove do histórico em disco', () => {
  comStore((store, arquivo) => {
    store.abrir('/a');
    store.abrir('/b');
    store.esquecer('/a');
    assert.deepEqual(new EstadoStore(arquivo).ler().recentes, ['/b']);
  });
});

test('o arquivo de estado também é 600', () => {
  comStore((store, arquivo) => {
    store.abrir('/a');
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
  });
});

test('acrescentar e remover raiz sobrevivem a reler (T004)', () => {
  comStore((store, arquivo) => {
    store.abrir('/a');
    store.acrescentar('/b');
    assert.deepEqual(new EstadoStore(arquivo).ler().pastas, ['/a', '/b']);

    store.remover('/a');
    assert.deepEqual(new EstadoStore(arquivo).ler().pastas, ['/b']);
    assert.ok(new EstadoStore(arquivo).ler().recentes.includes('/a'), 'sai do espaço, fica no histórico');
  });
});
