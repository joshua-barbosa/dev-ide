import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanalSsh } from '../terminal/canal-ssh';
import type { ShellChannel } from '../connections/types';

/** Um canal do ssh2 de mentira, que deixa o teste disparar o fechamento. */
function canalFalso() {
  let aoFechar: ((code: number | null) => void) | null = null;
  const canal: ShellChannel = {
    write: () => undefined,
    resize: () => undefined,
    onData: () => undefined,
    onClose: (fn) => { aoFechar = fn; },
    // O ssh2 avisa o fechamento também quando quem fecha somos nós.
    close: () => aoFechar?.(0),
  };
  return { canal, servidorFechou: (code: number | null) => aoFechar?.(code) };
}

// O terminal segura a sessão SSH aberta (ver `SessionPool.reter`). Esquecer de
// soltar deixaria a conexão imortal depois de fechar a aba; soltar cedo
// demais deixaria a varredura matar o loop dele.

test('aba fechada: o canal avisa o fim UMA vez', () => {
  const { canal } = canalFalso();
  let avisos = 0;
  const c = new CanalSsh(canal, () => { avisos += 1; });
  c.close();
  c.close();
  assert.equal(avisos, 1);
});

test('o servidor encerrou o shell (exit, queda): o canal avisa o fim', () => {
  const { canal, servidorFechou } = canalFalso();
  let avisos = 0;
  new CanalSsh(canal, () => { avisos += 1; });
  servidorFechou(0);
  assert.equal(avisos, 1);
});

test('enquanto o canal vive, ninguém é avisado — nem com o tempo passando', () => {
  const { canal } = canalFalso();
  let avisos = 0;
  const c = new CanalSsh(canal, () => { avisos += 1; });
  c.write('while true; do date; sleep 1; done\r');
  assert.equal(avisos, 0);
});

test('sem aviso de fim, o canal funciona como antes', () => {
  const { canal } = canalFalso();
  const c = new CanalSsh(canal);
  assert.doesNotThrow(() => c.close());
});
