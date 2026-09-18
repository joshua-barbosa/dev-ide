import test from 'node:test';
import assert from 'node:assert/strict';
import { gestoDaArea } from '../editor/gesto-da-area';

const tecla = (key: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
  key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods,
});

test('as três teclas de sempre', () => {
  assert.equal(gestoDaArea(tecla('c', { ctrlKey: true })), 'copiar');
  assert.equal(gestoDaArea(tecla('x', { ctrlKey: true })), 'recortar');
  assert.equal(gestoDaArea(tecla('v', { ctrlKey: true })), 'colar');
});

test('maiúscula não muda o gesto: Ctrl+Shift+C não é copiar', () => {
  assert.equal(gestoDaArea(tecla('C', { ctrlKey: true })), 'copiar');
  assert.equal(gestoDaArea(tecla('C', { ctrlKey: true, shiftKey: true })), null);
});

test('no Mac o Command vale como Ctrl', () => {
  assert.equal(gestoDaArea(tecla('c', { metaKey: true })), 'copiar');
});

test('AltGr NÃO é copiar: em teclado ABNT2 ele chega como Ctrl+Alt', () => {
  // Sem isso, `AltGr+C` copiaria — e pior, engoliria o caractere que ele digita.
  assert.equal(gestoDaArea(tecla('c', { ctrlKey: true, altKey: true })), null);
});

test('as teclas antigas do X11 continuam valendo', () => {
  assert.equal(gestoDaArea(tecla('Insert', { shiftKey: true })), 'colar');
  assert.equal(gestoDaArea(tecla('Insert', { ctrlKey: true })), 'copiar');
  assert.equal(gestoDaArea(tecla('Delete', { shiftKey: true })), 'recortar');
});

test('tecla comum não é gesto nenhum', () => {
  assert.equal(gestoDaArea(tecla('c')), null);
  assert.equal(gestoDaArea(tecla('a', { ctrlKey: true })), null);
});
