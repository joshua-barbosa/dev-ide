// O arquivo `.desktop` (T094).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  conteudoDoAtalho, escaparCampo, escaparExec, nomeDoExecutavel, precisaDeNoSandbox,
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

test('StartupWMClass vem do EXECUTÁVEL, e não do nome bonito', () => {
  // O Electron usa o nome do executável como WM_CLASS: "Braytech Code" abre uma
  // janela de classe `braytech-code`. Pôr o nome com espaço aqui faria o
  // ambiente não reconhecer a janela — e o sintoma é o de sempre: um segundo
  // ícone, genérico, ao lado do atalho.
  const t = conteudoDoAtalho({
    ...base,
    nome: 'Braytech Code',
    executavel: '/apps/braytech-code/braytech-code',
  });
  assert.match(t, /^Name=Braytech Code$/m);
  assert.match(t, /^StartupWMClass=braytech-code$/m);
});

test('a classe pode ser dita à mão quando o executável não bate', () => {
  const t = conteudoDoAtalho({ ...base, classeDaJanela: 'outra-coisa' });
  assert.match(t, /^StartupWMClass=outra-coisa$/m);
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

test('nomeDoExecutavel tira a pasta', () => {
  assert.equal(nomeDoExecutavel('/a/b/braytech-code'), 'braytech-code');
  assert.equal(nomeDoExecutavel('braytech-code'), 'braytech-code');
});
