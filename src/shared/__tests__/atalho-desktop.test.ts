// O arquivo `.desktop` (T094).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  conteudoDoAtalho, escaparCampo, escaparExec, precisaDeNoSandbox,
} from '../atalho-desktop';

const base = {
  nome: 'dev-ide',
  executavel: '/apps/dev-ide/dev-ide',
  icone: '/apps/dev-ide/icone.png',
  semSandbox: false,
};

test('caminho RELATIVO estoura em vez de gerar atalho que não abre', () => {
  // É o defeito silencioso do formato: o atalho aparece bonito e não faz nada.
  assert.throws(() => conteudoDoAtalho({ ...base, executavel: 'dev-ide' }), /ABSOLUTO/);
});

test('caminho com espaço fica entre aspas', () => {
  const t = conteudoDoAtalho({ ...base, executavel: '/home/ana/meus apps/dev-ide' });
  assert.match(t, /^Exec="\/home\/ana\/meus apps\/dev-ide" %U$/m);
});

test('aspas e barras no caminho são escapadas', () => {
  assert.equal(escaparExec('/a"b\\c'), '"/a\\"b\\\\c"');
});

test('o --no-sandbox entra SÓ quando pedido, e depois das aspas', () => {
  assert.match(conteudoDoAtalho({ ...base, semSandbox: true }), /^Exec=".*" --no-sandbox %U$/m);
  assert.equal(/--no-sandbox/.test(conteudoDoAtalho(base)), false);
});

test('sem ícone, a linha Icon NÃO existe', () => {
  // `Icon=` vazio faz alguns ambientes desenharem um quadrado quebrado.
  assert.equal(/^Icon=/m.test(conteudoDoAtalho({ ...base, icone: '' })), false);
  assert.match(conteudoDoAtalho(base), /^Icon=\/apps\/dev-ide\/icone\.png$/m);
});

test('StartupWMClass existe — é o que amarra a JANELA ao ícone', () => {
  // Sem ele, o ambiente abre um segundo lugar na barra, com ícone genérico.
  assert.match(conteudoDoAtalho(base), /^StartupWMClass=dev-ide$/m);
});

test('quebra de linha no nome não parte o arquivo em duas chaves', () => {
  assert.equal(escaparCampo('dev\nide'), 'dev ide');
});

// ---------------------------------------------------------------------------
// O ajudante de sandbox
// ---------------------------------------------------------------------------

test('ajudante certo (root, 4755) dispensa o --no-sandbox', () => {
  assert.equal(precisaDeNoSandbox({ existe: true, dono: 0, modo: 0o104755 & 0o7777 }), false);
});

test('modo 0755 NÃO serve: falta o bit SUID', () => {
  // Comparar só os últimos nove bits deixaria isto passar — e é justamente o
  // caso que não funciona.
  assert.equal(precisaDeNoSandbox({ existe: true, dono: 0, modo: 0o755 }), true);
});

test('dono que não é root não serve', () => {
  assert.equal(precisaDeNoSandbox({ existe: true, dono: 1000, modo: 0o4755 }), true);
});

test('sem ajudante nenhum, precisa', () => {
  assert.equal(precisaDeNoSandbox(null), true);
  assert.equal(precisaDeNoSandbox({ existe: false, dono: 0, modo: 0o4755 }), true);
});
