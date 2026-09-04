// O que muda entre Windows, Linux e macOS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aceitaLembrancaEmArquivo, comandoDeShellScript, ehCaminhoAbsoluto,
  plataformaAtual, shellDoTerminal,
} from '../plataforma';

test('a plataforma se reduz a três, e o desconhecido conta como Linux', () => {
  assert.equal(plataformaAtual('win32'), 'win32');
  assert.equal(plataformaAtual('darwin'), 'darwin');
  assert.equal(plataformaAtual('linux'), 'linux');
  // FreeBSD, AIX e afins são Unix o bastante para o que decidimos aqui.
  assert.equal(plataformaAtual('freebsd'), 'linux');
});

test('no Windows o shell vem do ComSpec; no Unix, do SHELL', () => {
  assert.equal(shellDoTerminal('win32', { ComSpec: 'C:\\Windows\\cmd.exe' }), 'C:\\Windows\\cmd.exe');
  assert.equal(shellDoTerminal('linux', { SHELL: '/usr/bin/zsh' }), '/usr/bin/zsh');
});

test('sem a variável, cada plataforma cai no seu padrão', () => {
  assert.equal(shellDoTerminal('win32', {}), 'cmd.exe');
  assert.equal(shellDoTerminal('linux', {}), '/bin/bash');
  // `$SHELL` do Unix não pode vazar para o Windows: um `/bin/bash` lá não abre.
  assert.equal(shellDoTerminal('win32', { SHELL: '/bin/bash' }), 'cmd.exe');
});

test('o `.sh` no Windows AVISA que depende do bash do Git', () => {
  // Sem o aviso, a falha apareceria como "comando não encontrado" — que não
  // diz o que instalar.
  const win = comandoDeShellScript('win32');
  assert.equal(win.exec, 'bash');
  assert.match(win.aviso ?? '', /Git para Windows/);
  assert.equal(comandoDeShellScript('linux').aviso, null);
});

test('caminho absoluto: `/` no Unix, letra de unidade e rede no Windows', () => {
  assert.equal(ehCaminhoAbsoluto('/home/x', 'linux'), true);
  assert.equal(ehCaminhoAbsoluto('src/a.ts', 'linux'), false);

  assert.equal(ehCaminhoAbsoluto('C:\\Users\\x', 'win32'), true);
  assert.equal(ehCaminhoAbsoluto('c:/Users/x', 'win32'), true);
  assert.equal(ehCaminhoAbsoluto('\\\\servidor\\pasta', 'win32'), true);
  assert.equal(ehCaminhoAbsoluto('src\\a.ts', 'win32'), false);
  // `/x` NÃO é absoluto no Windows: é relativo à unidade corrente.
  assert.equal(ehCaminhoAbsoluto('/x', 'win32'), false);
});

test('vazio nunca é absoluto', () => {
  assert.equal(ehCaminhoAbsoluto('', 'linux'), false);
  assert.equal(ehCaminhoAbsoluto('', 'win32'), false);
});

test('no Windows a lembrança em ARQUIVO é recusada', () => {
  // As duas pernas do backend de máquina caem lá ao mesmo tempo: o modo 600 é
  // ignorado e `/etc/machine-id` não existe. O que sobraria seria a chave do
  // cofre legível por quem lesse o disco.
  assert.equal(aceitaLembrancaEmArquivo('win32'), false);
  assert.equal(aceitaLembrancaEmArquivo('linux'), true);
  assert.equal(aceitaLembrancaEmArquivo('darwin'), true);
});
