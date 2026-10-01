// Qual Python o notebook usa (spec 112, etapa 2).
//
// Ele: *"o 'kernel' pode ser da onde vem os pacotes… e onde está o python
// (tipo o .venv)"*. A plataforma vem por ARGUMENTO — Windows é uso real, e um
// padrão POSIX calado é como ele quebra lá.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidatosDePython } from '../notebook/ambiente';

const existe = (lista: string[]) => (p: string) => lista.includes(p);

test('.venv na pasta do notebook vem primeiro', () => {
  const c = candidatosDePython('/proj/analises', '/proj', 'linux',
    existe(['/proj/analises/.venv/bin/python', '/proj/.venv/bin/python']));
  assert.equal(c[0].caminho, '/proj/analises/.venv/bin/python');
  assert.equal(c[0].origem, 'venv');
});

test('sobe até a raiz do projeto procurando', () => {
  const c = candidatosDePython('/proj/a/b', '/proj', 'linux', existe(['/proj/.venv/bin/python']));
  assert.equal(c[0].caminho, '/proj/.venv/bin/python');
});

test('não sobe ACIMA da raiz do projeto', () => {
  // Um `.venv` na casa dele não é deste projeto.
  const c = candidatosDePython('/casa/proj/a', '/casa/proj', 'linux', existe(['/casa/.venv/bin/python']));
  assert.equal(c.find((i) => i.origem === 'venv'), undefined);
});

test('`venv` sem ponto também vale', () => {
  const c = candidatosDePython('/proj', '/proj', 'linux', existe(['/proj/venv/bin/python']));
  assert.equal(c[0].caminho, '/proj/venv/bin/python');
});

test('sem venv, o do sistema', () => {
  const c = candidatosDePython('/proj', '/proj', 'linux', existe([]));
  assert.deepEqual(c.map((i) => [i.caminho, i.origem]), [['python3', 'sistema']]);
});

test('no Windows: Scripts\\python.exe e `python` do sistema', () => {
  const c = candidatosDePython('C:\\proj\\notas', 'C:\\proj', 'win32',
    existe(['C:\\proj\\.venv\\Scripts\\python.exe']));
  assert.equal(c[0].caminho, 'C:\\proj\\.venv\\Scripts\\python.exe');
  assert.equal(c[c.length - 1].caminho, 'python');
});

test('o rótulo diz de onde veio, relativo ao projeto', () => {
  const c = candidatosDePython('/proj/a', '/proj', 'linux', existe(['/proj/.venv/bin/python']));
  assert.equal(c[0].rotulo, '.venv (projeto)');
  const d = candidatosDePython('/proj/a', '/proj', 'linux', existe(['/proj/a/.venv/bin/python']));
  assert.equal(d[0].rotulo, 'a/.venv');
});

test('sem projeto aberto, procura só na pasta do notebook', () => {
  const c = candidatosDePython('/tmp/x', null, 'linux', existe(['/tmp/.venv/bin/python']));
  assert.equal(c.find((i) => i.origem === 'venv'), undefined);
});

// ---- PHP (etapa 3) ----
import { ambientePhp } from '../notebook/ambiente';

test('PHP: o vendor mais próximo, subindo até a raiz', () => {
  const a = ambientePhp('/proj/notas', '/proj', 'linux', existe(['/proj/vendor/autoload.php']));
  assert.equal(a.autoload, '/proj/vendor/autoload.php');
  assert.equal(a.laravel, null, 'sem artisan, não é Laravel');
});

test('PHP: Laravel só com artisan E bootstrap/app.php', () => {
  const a = ambientePhp('/proj/notas', '/proj', 'linux',
    existe(['/proj/vendor/autoload.php', '/proj/artisan', '/proj/bootstrap/app.php']));
  assert.equal(a.laravel, '/proj/bootstrap/app.php');
});

test('PHP: vendor fora do projeto não conta', () => {
  const a = ambientePhp('/casa/proj', '/casa/proj', 'linux', existe(['/casa/vendor/autoload.php']));
  assert.equal(a.autoload, null);
});

test('PHP no Windows', () => {
  const a = ambientePhp('C:\\proj\\notas', 'C:\\proj', 'win32', existe(['C:\\proj\\vendor\\autoload.php']));
  assert.equal(a.autoload, 'C:\\proj\\vendor\\autoload.php');
});

// ---- "Outro interpretador…" com caminho relativo ----
// A pergunta: "O caminho do python eu preciso colocar desde a raiz? Ou posso
// colocar só a partir da pasta que estou?"
import { resolverInterpretador } from '../notebook/ambiente';

test('relativo: a partir da pasta do NOTEBOOK', () => {
  assert.equal(resolverInterpretador('.venv/bin/python', '/proj/notas', '/casa', 'linux'), '/proj/notas/.venv/bin/python');
  assert.equal(resolverInterpretador('../api/.venv/bin/python', '/proj/notas', '/casa', 'linux'), '/proj/api/.venv/bin/python');
});

test('~/ é a pasta do usuário', () => {
  assert.equal(resolverInterpretador('~/venvs/dados/bin/python', '/proj', '/casa/ana', 'linux'), '/casa/ana/venvs/dados/bin/python');
});

test('absoluto fica como está; nome solto continua sendo do PATH', () => {
  assert.equal(resolverInterpretador('/usr/bin/python3', '/proj', '/casa', 'linux'), '/usr/bin/python3');
  assert.equal(resolverInterpretador('python3', '/proj', '/casa', 'linux'), 'python3');
});

test('no Windows: barra invertida, unidade e ~\\', () => {
  assert.equal(resolverInterpretador('.venv\\Scripts\\python.exe', 'C:\\proj\\notas', 'C:\\Users\\ana', 'win32'),
    'C:\\proj\\notas\\.venv\\Scripts\\python.exe');
  assert.equal(resolverInterpretador('D:\\py\\python.exe', 'C:\\proj', 'C:\\Users\\ana', 'win32'), 'D:\\py\\python.exe');
  assert.equal(resolverInterpretador('~\\py\\python.exe', 'C:\\proj', 'C:\\Users\\ana', 'win32'), 'C:\\Users\\ana\\py\\python.exe');
  assert.equal(resolverInterpretador('python', 'C:\\proj', 'C:\\Users\\ana', 'win32'), 'python');
});

// ---- "Outro…" apontando uma PASTA (relato de 01/10) ----
// "spawn …/backend/vendor EACCES"; e depois: "PHP e vendor são coisas bem
// diferentes" — o "Outro PHP…" é só o PROGRAMA; o vendor tem a opção dele.
import { lerEscolhaDePasta, lerPastaDePacotes } from '../notebook/ambiente';

const pastas = (lista: string[]) => (p: string) => lista.includes(p);

test('"Outro PHP…": a PASTA onde o php está vira o php de dentro dela (Linux e Windows)', () => {
  assert.deepEqual(
    lerEscolhaDePasta('/opt/php8.3/bin', 'php', 'linux', existe(['/opt/php8.3/bin/php']), pastas(['/opt/php8.3/bin'])),
    { interpretador: '/opt/php8.3/bin/php' }
  );
  assert.deepEqual(
    lerEscolhaDePasta('C:\\php', 'php', 'win32', existe(['C:\\php\\php.exe']), pastas(['C:\\php'])),
    { interpretador: 'C:\\php\\php.exe' }
  );
});

test('"Outro PHP…" com a pasta do vendor: recado apontando a opção certa (não vira vendor por mágica)', () => {
  const r = lerEscolhaDePasta('/ws/backend/vendor', 'php', 'linux', existe(['/ws/backend/vendor/autoload.php']), pastas(['/ws/backend/vendor']));
  assert.ok('erro' in r && /Outra pasta de vendor/.test(r.erro));
});

test('Python: a pasta do .venv vira o python de dentro dela (Linux e Windows)', () => {
  assert.deepEqual(
    lerEscolhaDePasta('/ws/.venv', 'python', 'linux', existe(['/ws/.venv/bin/python']), pastas(['/ws/.venv'])),
    { interpretador: '/ws/.venv/bin/python' }
  );
  assert.deepEqual(
    lerEscolhaDePasta('C:\\ws\\.venv', 'python', 'win32', existe(['C:\\ws\\.venv\\Scripts\\python.exe']), pastas(['C:\\ws\\.venv'])),
    { interpretador: 'C:\\ws\\.venv\\Scripts\\python.exe' }
  );
});

test('outra pasta qualquer: recado claro, e não um EACCES', () => {
  const r = lerEscolhaDePasta('/ws/docs', 'php', 'linux', existe([]), pastas(['/ws/docs']));
  assert.ok('erro' in r && /é uma pasta/.test(r.erro));
});

test('um executável (não pasta) segue como interpretador', () => {
  assert.deepEqual(lerEscolhaDePasta('/usr/bin/php8.3', 'php', 'linux', existe([]), pastas([])), { interpretador: '/usr/bin/php8.3' });
});

// ---- "Outra pasta de vendor…" / "Outra pasta de pacotes…" ----
test('vendor: a pasta do projeto OU a própria vendor/ — vale a do projeto', () => {
  const ex = existe(['/ws/backend/vendor/autoload.php']);
  assert.deepEqual(lerPastaDePacotes('/ws/backend', 'php', 'linux', ex, pastas(['/ws/backend'])), { pacotes: '/ws/backend' });
  assert.deepEqual(lerPastaDePacotes('/ws/backend/vendor', 'php', 'linux', ex, pastas(['/ws/backend/vendor'])), { pacotes: '/ws/backend' });
});

test('pacotes do Node: a pasta do projeto ou a node_modules/', () => {
  const ex = existe(['/ws/api/node_modules']);
  assert.deepEqual(lerPastaDePacotes('/ws/api/node_modules', 'javascript', 'linux', ex, pastas(['/ws/api/node_modules'])), { pacotes: '/ws/api' });
});

test('pasta sem vendor (ou que não existe): recado', () => {
  const r = lerPastaDePacotes('/ws/docs', 'php', 'linux', existe([]), pastas(['/ws/docs']));
  assert.ok('erro' in r && /vendor\/autoload\.php/.test(r.erro));
  const n = lerPastaDePacotes('/ws/nao-existe', 'php', 'linux', existe([]), pastas([]));
  assert.ok('erro' in n && /não existe/.test(n.erro));
});
