// O arquivo temporário do driver não pode derrubar o kernel (Windows).
//
// O relato (01/10, no Windows, ao subir o kernel PHP): "ENOTEMPTY, Directory
// not empty: …\Temp\braytech-kernel-…". O PHP segura o arquivo do driver
// aberto; apagar a pasta logo depois de subir falhava — e a falha da LIMPEZA
// derrubava a SUBIDA, com o kernel já de pé.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { comDriver } from '../notebook/kernel-python';

type Sair = () => void;

function kernelFalso() {
  const aoSair: Sair[] = [];
  return { k: { depoisDeSair: (f: Sair) => aoSair.push(f) }, sair: () => aoSair.forEach((f) => f()) };
}

test('apagar a pasta falhou (arquivo preso): o kernel sobe mesmo assim', async () => {
  const { k } = kernelFalso();
  const r = await comDriver('d.php', '<?php', async () => k as never, () => {
    throw Object.assign(new Error('ENOTEMPTY, Directory not empty'), { code: 'ENOTEMPTY' });
  });
  assert.equal(r, k);
});

test('…e a pasta é apagada quando o kernel sair', async () => {
  const { k, sair } = kernelFalso();
  let tentativas = 0;
  let pasta = '';
  await comDriver('d.php', '<?php', async (arquivo) => {
    pasta = arquivo.replace(/[\\/]d\.php$/, '');
    return k as never;
  }, (p) => {
    tentativas += 1;
    if (tentativas === 1) throw new Error('ENOTEMPTY');
    fs.rmSync(p, { recursive: true, force: true });
  });
  assert.equal(fs.existsSync(pasta), true, 'ficou, enquanto o kernel vive');
  sair();
  assert.equal(fs.existsSync(pasta), false, 'saiu junto com o kernel');
});

test('kernel que não sobe: a pasta sai, e o erro que vale é o da subida', async () => {
  let pasta = '';
  await assert.rejects(
    comDriver('d.py', '', async (arquivo) => {
      pasta = arquivo.replace(/[\\/]d\.py$/, '');
      throw new Error('o kernel não subiu');
    }),
    /não subiu/
  );
  assert.equal(fs.existsSync(pasta), false);
});
