// Copiar e colar no terminal (03/09/2026).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acaoDoTerminal, textoParaCopiar } from '../terminal-copiar';

const tecla = (over: Partial<Parameters<typeof acaoDoTerminal>[0]>) =>
  acaoDoTerminal({ key: 'c', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...over });

test('Ctrl+Shift+C copia, Ctrl+Shift+V cola', () => {
  assert.equal(tecla({ ctrlKey: true, shiftKey: true, key: 'C' }), 'copiar');
  assert.equal(tecla({ ctrlKey: true, shiftKey: true, key: 'v' }), 'colar');
});

test('Ctrl+C vai SEMPRE para o shell — é o SIGINT', () => {
  // Copiar com seleção é costume do Windows, e num terminal de Linux ele morde:
  // quem selecionou a saída para ler e precisa interromper apertaria Ctrl+C e o
  // programa continuaria rodando, sem nada explicando por quê.
  assert.equal(tecla({ ctrlKey: true, key: 'c' }), 'para-o-shell');
});

test('Ctrl+Alt+Shift+C não é a nossa tecla', () => {
  assert.equal(tecla({ ctrlKey: true, shiftKey: true, altKey: true, key: 'c' }), 'para-o-shell');
});

test('Shift+C sozinho é só uma letra maiúscula', () => {
  assert.equal(tecla({ shiftKey: true, key: 'C' }), 'para-o-shell');
});

test('Cmd+Shift+C também copia, para o mesmo atalho valer no Mac', () => {
  assert.equal(tecla({ metaKey: true, shiftKey: true, key: 'c' }), 'copiar');
});

// ---------------------------------------------------------------------------
// O texto copiado
// ---------------------------------------------------------------------------

test('o espaço até o fim da linha NÃO vai junto', () => {
  // Cada linha do terminal tem a largura da janela: colar isso num editor traz
  // dezenas de espaços invisíveis por linha.
  assert.equal(textoParaCopiar('ola      \nmundo   '), 'ola\nmundo');
});

test('o recuo do começo da linha FICA — é código', () => {
  assert.equal(textoParaCopiar('  if (x) {   \n    y();  '), '  if (x) {\n    y();');
});

test('sem seleção, não se mexe na área de transferência', () => {
  // Copiar vazio apagaria o que já estava lá.
  assert.equal(textoParaCopiar(''), null);
  assert.equal(textoParaCopiar('   \n  \n'), null);
});

test('linha em branco no meio sobrevive', () => {
  assert.equal(textoParaCopiar('a  \n   \nb  '), 'a\n\nb');
});
