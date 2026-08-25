import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  lerCarga,
  lerCpu,
  lerDisco,
  lerMemoria,
  lerProcessos,
  lerRede,
  lerUptime,
  usoDeCpu,
} from '../connections/drivers/ssh-metricas';

// Os textos abaixo têm a FORMA do que um Debian 13 devolve — conferida contra
// um servidor real em 2026-08-24. Os números foram trocados onde faziam conta.

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

test('a linha `cpu ` é lida, e `iowait` conta como OCIOSO', () => {
  // Somar `iowait` ao trabalho faria um servidor parado esperando disco
  // aparecer com 100% de uso.
  const a = lerCpu('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4 5');
  assert.notEqual(a, null);
  assert.equal(a?.total, 1000);
  assert.equal(a?.ocioso, 850);
});

test('sem a linha `cpu `, devolve null em vez de zero', () => {
  assert.equal(lerCpu('intr 1 2 3\nctxt 999'), null);
});

test('a porcentagem sai da DIFERENÇA entre duas amostras', () => {
  // Uma leitura só daria a média desde o boot — num servidor de 37 dias, sempre
  // perto de zero.
  const antes = lerCpu('cpu  100 0 50 800 50 0 0 0 0 0');
  const agora = lerCpu('cpu  200 0 100 1600 100 0 0 0 0 0');
  assert.notEqual(antes, null);
  assert.notEqual(agora, null);
  const uso = usoDeCpu(antes!, agora!);
  // Andou 1000 no total, 850 disso ocioso → 15% de uso.
  assert.equal(uso?.total, 15);
  assert.equal(uso?.usuario, 10);
  assert.equal(uso?.sistema, 5);
});

test('contador que não andou (ou andou para trás) devolve null', () => {
  const a = lerCpu('cpu  100 0 50 800 50 0 0 0 0 0');
  assert.equal(usoDeCpu(a!, a!), null, 'mesma amostra');
  const menor = lerCpu('cpu  10 0 5 80 5 0 0 0 0 0');
  assert.equal(usoDeCpu(a!, menor!), null, 'reboot');
});

// ---------------------------------------------------------------------------
// Memória
// ---------------------------------------------------------------------------

const MEMINFO = [
  'MemTotal:       16382136 kB',
  'MemFree:         3960252 kB',
  'MemAvailable:   12574792 kB',
  'Buffers:          123456 kB',
].join('\n');

test('a memória usada sai de MemAvailable, e NÃO de MemFree', () => {
  // A diferença é enorme: `MemFree` diz 3,9 GB livres e `MemAvailable` diz
  // 12,5 GB — e é o segundo que responde "cabe mais alguma coisa aqui?".
  // 23,2% é exatamente o que a ferramenta de referência mostra neste servidor.
  const m = lerMemoria(MEMINFO);
  assert.equal(m?.porcentagem, 23.2);
  assert.equal(m?.totalBytes, 16_382_136 * 1024);
});

test('sem MemAvailable (kernel antigo), cai em MemFree em vez de falhar', () => {
  const m = lerMemoria('MemTotal: 1000 kB\nMemFree: 250 kB');
  assert.equal(m?.porcentagem, 75);
});

test('meminfo ilegível devolve null', () => {
  assert.equal(lerMemoria('qualquer coisa'), null);
  assert.equal(lerMemoria('MemTotal: 0 kB\nMemAvailable: 0 kB'), null);
});

// ---------------------------------------------------------------------------
// Disco
// ---------------------------------------------------------------------------

test('a linha do `df -P -k` vira bytes e porcentagem', () => {
  const d = lerDisco('/dev/sda1         97341748 40306880  52043944      44% /');
  assert.equal(d?.totalBytes, 97_341_748 * 1024);
  assert.equal(d?.usadoBytes, 40_306_880 * 1024);
  assert.equal(d?.livreBytes, 52_043_944 * 1024);
  // 43.6%, que o `df` arredonda para 44% — e é o número que a ferramenta de
  // referência mostra neste servidor. `usado / total` daria 41,4%, e a IDE
  // discordaria do `df` que o usuário roda no terminal ao lado.
  assert.equal(d?.porcentagem, 43.6);
});

test('o cabeçalho do `df` é ignorado', () => {
  const com = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 40 60 40% /';
  assert.equal(lerDisco(com)?.usadoBytes, 40 * 1024);
  assert.equal(lerDisco(com)?.porcentagem, 40);
});

test('df sem nada útil devolve null', () => {
  assert.equal(lerDisco(''), null);
  assert.equal(lerDisco('Filesystem 1024-blocks Used Available Capacity Mounted on'), null);
});

// ---------------------------------------------------------------------------
// Uptime e carga
// ---------------------------------------------------------------------------

test('uptime é o PRIMEIRO número, arredondado', () => {
  // O segundo é ocioso somado por núcleo, e é maior que o tempo de pé.
  assert.equal(lerUptime('3237497.67 23265110.91'), 3_237_498);
  assert.equal(lerUptime('lixo'), null);
});

test('carga são as três primeiras, e o resto da linha não entra', () => {
  assert.deepEqual(lerCarga('0.09 0.06 0.01 1/703 846497'), [0.09, 0.06, 0.01]);
  assert.equal(lerCarga('0.09 0.06'), null);
});

// ---------------------------------------------------------------------------
// Processos
// ---------------------------------------------------------------------------

const PS = [
  '    PID USER                 %CPU %MEM   RSS COMMAND',
  ' 326466 ana.silva             0.1  4.3 719396 node /mnt/apl/n8n/node_modules/.bin/n8n start',
  ' 641633 bruno.costa           0.0  1.6 271812 next-server (v16.2.12)',
  '    839 root                  0.0  0.9 145100 /usr/bin/dockerd -H fd:// --containerd=/run/x.sock',
].join('\n');

test('o comando é o RESTO da linha, com espaços e tudo', () => {
  // `comm` daria só `node`, e há quatro processos chamados `node` — a linha
  // inteira é o que distingue um do outro.
  const p = lerProcessos(PS);
  assert.equal(p.length, 3);
  assert.equal(p[0]?.comando, 'node /mnt/apl/n8n/node_modules/.bin/n8n start');
  assert.equal(p[1]?.comando, 'next-server (v16.2.12)');
  assert.equal(p[0]?.usuario, 'ana.silva');
  assert.equal(p[0]?.rssBytes, 719_396 * 1024);
});

test('o cabeçalho e o lixo são pulados, e o limite vale', () => {
  assert.equal(lerProcessos(PS, 2).length, 2);
  assert.deepEqual(lerProcessos('PID USER\nlinha torta'), []);
});

// ---------------------------------------------------------------------------
// Rede
// ---------------------------------------------------------------------------

const NETDEV = [
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets',
  '    lo: 999999999 1000    0    0    0     0          0         0 999999999 1000',
  '  ens18: 1000 480894189    0   76    0     0          0         0 2000 15251071',
  'veth0c4a0f5: 500 6774    0    0    0     0          0         0 700 6515',
].join('\n');

test('soma as interfaces de verdade, e ignora `lo` e as de contêiner', () => {
  // Num servidor com Docker as `veth` duplicam o que já passou pela física, e
  // o gráfico mostraria o dobro. `lo` é tráfego consigo mesmo.
  const r = lerRede(NETDEV);
  assert.equal(r?.recebidoBytes, 1000);
  assert.equal(r?.enviadoBytes, 2000);
});

test('sem interface nenhuma, devolve null', () => {
  assert.equal(lerRede('lo: 1 2 3 4 5 6 7 8 9 10'), null);
  assert.equal(lerRede(''), null);
});
