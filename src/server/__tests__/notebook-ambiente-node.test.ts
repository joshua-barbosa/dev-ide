// De onde vem o Node do kernel JS/TS, e de onde vêm os pacotes.
//
// Um colega dele: *"quando é kernel Node ele não me deixa trocar… estava em
// uma pasta que tinha 2 projetos com node, sendo um frontend (next.js) e um
// backend (nestjs), não sei nem qual dos dois ele escolheu"*. São DUAS
// escolhas: a versão do Node e a pasta dos `node_modules`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidatosDeNode, pastasDePacotes } from '../notebook/ambiente-node';

const existe = (lista: string[]) => (p: string) => lista.includes(p);
/** Um disco de mentira: pasta → subpastas. */
const disco = (arvore: Record<string, string[]>) => (p: string) => arvore[p] ?? [];

test('pacotes: a pasta com node_modules mais próxima do notebook vem primeiro', () => {
  const pastas = pastasDePacotes('/ws/backend/notas', '/ws', 'linux',
    existe(['/ws/backend/package.json', '/ws/backend/node_modules']),
    disco({ '/ws': ['backend'], '/ws/backend': ['notas', 'node_modules', 'src'] }));
  assert.equal(pastas[0].caminho, '/ws/backend');
  assert.equal(pastas[0].rotulo, 'backend');
});

test('pacotes: os DOIS projetos do workspace aparecem para escolher', () => {
  const pastas = pastasDePacotes('/ws', '/ws', 'linux',
    existe(['/ws/frontend/package.json', '/ws/backend/package.json', '/ws/backend/node_modules']),
    disco({ '/ws': ['frontend', 'backend', '.git'], '/ws/frontend': ['node_modules', 'app'] }));
  assert.deepEqual(pastas.map((p) => p.rotulo).sort(), ['backend', 'frontend']);
});

test('pacotes: não desce em node_modules, .git nem .next', () => {
  const pastas = pastasDePacotes('/ws', '/ws', 'linux',
    existe(['/ws/node_modules/lib/package.json', '/ws/.next/package.json', '/ws/app/package.json']),
    disco({ '/ws': ['node_modules', '.next', 'app'], '/ws/node_modules': ['lib'] }));
  assert.deepEqual(pastas.map((p) => p.rotulo), ['app']);
});

test('pacotes: a raiz do workspace com package.json se chama "(raiz)"', () => {
  const pastas = pastasDePacotes('/ws', '/ws', 'linux', existe(['/ws/package.json']), disco({}));
  assert.deepEqual(pastas.map((p) => [p.caminho, p.rotulo]), [['/ws', '(raiz)']]);
});

test('pacotes: sem projeto node nenhum, a pasta do notebook', () => {
  const pastas = pastasDePacotes('/ws/notas', '/ws', 'linux', existe([]), disco({}));
  assert.deepEqual(pastas.map((p) => p.caminho), ['/ws/notas']);
});

test('pacotes: no Windows, com o path dele', () => {
  const pastas = pastasDePacotes('C:\\ws', 'C:\\ws', 'win32',
    existe(['C:\\ws\\api\\package.json']), disco({ 'C:\\ws': ['api'] }));
  assert.deepEqual(pastas.map((p) => [p.caminho, p.rotulo]), [['C:\\ws\\api', 'api']]);
});

test('node: o embutido primeiro, depois as versões do nvm (mais nova antes), depois o do PATH', () => {
  const c = candidatosDeNode('linux', '/usr/lib/cursor/cursor', '/casa', {},
    existe(['/casa/.nvm/versions/node/v18.19.0/bin/node', '/casa/.nvm/versions/node/v20.11.1/bin/node']),
    disco({ '/casa/.nvm/versions/node': ['v18.19.0', 'v20.11.1'] }));
  assert.deepEqual(c.map((i) => [i.origem, i.rotulo]), [
    ['embutido', 'Node do editor'],
    ['nvm', 'nvm v20.11.1'],
    ['nvm', 'nvm v18.19.0'],
    ['sistema', 'node do sistema (PATH)'],
  ]);
  assert.equal(c[1].caminho, '/casa/.nvm/versions/node/v20.11.1/bin/node');
});

test('node: v10 não passa na frente de v9 (ordem de versão, não de texto)', () => {
  const c = candidatosDeNode('linux', '/x/node', '/casa', {},
    existe(['/casa/.nvm/versions/node/v9.0.0/bin/node', '/casa/.nvm/versions/node/v10.0.0/bin/node']),
    disco({ '/casa/.nvm/versions/node': ['v9.0.0', 'v10.0.0'] }));
  assert.deepEqual(c.filter((i) => i.origem === 'nvm').map((i) => i.rotulo), ['nvm v10.0.0', 'nvm v9.0.0']);
});

test('node: NVM_DIR manda onde o nvm mora', () => {
  const c = candidatosDeNode('linux', '/x/node', '/casa', { NVM_DIR: '/opt/nvm' },
    existe(['/opt/nvm/versions/node/v22.1.0/bin/node']), disco({ '/opt/nvm/versions/node': ['v22.1.0'] }));
  assert.equal(c.find((i) => i.origem === 'nvm')?.caminho, '/opt/nvm/versions/node/v22.1.0/bin/node');
});

test('node: no Windows, o nvm-windows (NVM_HOME) e node.exe', () => {
  const c = candidatosDeNode('win32', 'C:\\Cursor\\Cursor.exe', 'C:\\Users\\ana',
    { NVM_HOME: 'C:\\Users\\ana\\AppData\\Roaming\\nvm' },
    existe(['C:\\Users\\ana\\AppData\\Roaming\\nvm\\v20.11.1\\node.exe']),
    disco({ 'C:\\Users\\ana\\AppData\\Roaming\\nvm': ['v20.11.1', 'nodejs'] }));
  assert.deepEqual(c.map((i) => i.caminho), [
    'C:\\Cursor\\Cursor.exe',
    'C:\\Users\\ana\\AppData\\Roaming\\nvm\\v20.11.1\\node.exe',
    'node',
  ]);
});
