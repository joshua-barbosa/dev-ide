import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pareceProntoParaComando } from '../terminal/prompt';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('o prompt comum é reconhecido', () => {
  assert.equal(pareceProntoParaComando('joshua@micro:~$ '), true);
  assert.equal(pareceProntoParaComando('root@srv:/opt# '), true);
  assert.equal(pareceProntoParaComando('user@mac ~ % '), true);
  assert.equal(pareceProntoParaComando('PS C:\\> '), true);
});

test('o BANNER de login NÃO é prompt — foi o defeito do servidor real', () => {
  // A heurística antiga era "a primeira saída é o prompt". No SSH a primeira
  // saída é isto, e o comando de abertura era enviado no meio dela: o TTY
  // ecoava e o shell não executava.
  const banner = [
    'Last login: Tue Aug 25 13:11:03 2026 from 187.32.48.211',
    'Welcome to Ubuntu 24.04.2 LTS',
    'nvm is not compatible with the "NPM_CONFIG_PREFIX" environment variable',
  ].join('\r\n');
  assert.equal(pareceProntoParaComando(banner), false);
});

test('`$` no MEIO do texto não conta', () => {
  assert.equal(pareceProntoParaComando('currently set to "$HOME/.npm-global"'), false);
  assert.equal(pareceProntoParaComando('Run `unset NPM_CONFIG_PREFIX` to unset it.'), false);
});

test('prompt COLORIDO é reconhecido — a cor de fechamento vem depois do `$`', () => {
  const colorido = `${ESC}[1;32mjoshua@micro${ESC}[0m:${ESC}[1;34m~${ESC}[0m$ `;
  assert.equal(pareceProntoParaComando(colorido), true);
});

test('prompt de DUAS LINHAS, com título de janela depois — o do usuário', () => {
  // Foi este que a primeira versão não reconheceu: o `starship` fecha com uma
  // sequência de título (OSC) DEPOIS do `$`, e o fim do texto deixava de ser o
  // `$`. O comando salvo da spec 039 nunca era digitado.
  const starship =
    `${ESC}]0;joshua@micro: /tmp/demo${BEL}` +
    `${ESC}[1;32mjoshua.barbosa${ESC}[0m at ${ESC}[1;33mmicro-3923${ESC}[0m in ` +
    `${ESC}[1;34m/tmp/dev-ide-e2e/projects/demo${ESC}[0m\r\n$ ${ESC}[?2004h`;
  assert.equal(pareceProntoParaComando(starship), true);
});

test('o prompt REAL desta máquina, capturado de um shell de verdade', () => {
  // Capturado com `node-pty` em 2026-08-25, e não deduzido: o que fazia a
  // heurística falhar era o `ESC ( B` (voltar ao conjunto ASCII) emitido DEPOIS
  // do `$` — não é CSI, e sobrava na limpeza.
  const real =
    `${ESC}[?2004h${ESC}]0;dev-ide${BEL}${ESC}[1m\r\r\n` +
    `${ESC}[38;5;166mjoshua.barbosa${ESC}[97m at ${ESC}[38;5;136mmicro-3923${ESC}[97m in ` +
    `${ESC}[38;5;64m~/Documentos/projetos${ESC}[97m on ${ESC}[38;5;61mmain\r\r\n` +
    `${ESC}[97m$ ${ESC}(B${ESC}[m`;
  assert.equal(pareceProntoParaComando(real), true);
});

test('linhas em branco DEPOIS do prompt não escondem o prompt', () => {
  assert.equal(pareceProntoParaComando('joshua@micro:~$ \r\n\r\n'), true);
});

test('saída que não terminou em prompt não conta', () => {
  assert.equal(pareceProntoParaComando('alguma saída qualquer\r\n'), false);
  assert.equal(pareceProntoParaComando(''), false);
  assert.equal(pareceProntoParaComando('\r\n'), false);
});
