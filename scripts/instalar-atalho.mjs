// Instala o `.desktop` para a IDE aparecer no menu do sistema (T094).
//
// A conta mora em `shared/atalho-desktop.ts`, testada sem tocar no disco. Aqui
// fica só o que precisa do sistema: achar o executável, olhar o `chrome-sandbox`
// e gravar o arquivo.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { conteudoDoAtalho, precisaDeNoSandbox } from '../dist/shared/atalho-desktop.js';

const RAIZ = path.resolve(import.meta.dirname, '..');

/**
 * Onde está o aplicativo.
 *
 * O build empacotado primeiro, e só depois o `electron` do desenvolvimento: um
 * atalho no menu do sistema deve abrir o programa pronto, e não a árvore de
 * código — que pode nem estar compilada quando ele clicar.
 */
function acharExecutavel() {
  // O nome do binário vem do `package.json`: renomear o produto não pode
  // exigir lembrar de mudar este script também.
  const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  const empacotado = path.join(RAIZ, 'empacotado', 'linux-unpacked', pacote.name);
  if (fs.existsSync(empacotado)) return empacotado;
  console.error(
    'Não achei o aplicativo empacotado. Rode "npm run empacotar" antes — o ' +
      'atalho precisa apontar para um programa que exista.'
  );
  process.exit(1);
}

function olharAjudante(executavel) {
  const ajudante = path.join(path.dirname(executavel), 'chrome-sandbox');
  if (!fs.existsSync(ajudante)) return null;
  const s = fs.statSync(ajudante);
  return { existe: true, dono: s.uid, modo: s.mode };
}

/** O ícone, se ele já tiver posto um. Ausente é caso normal e previsto. */
function acharIcone() {
  for (const nome of ['icone.png', 'icon.png']) {
    const p = path.join(RAIZ, 'recursos', nome);
    if (fs.existsSync(p)) return p;
  }
  return '';
}

const executavel = acharExecutavel();
const semSandbox = precisaDeNoSandbox(olharAjudante(executavel));
const icone = acharIcone();

const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
const destino = path.join(
  os.homedir(), '.local', 'share', 'applications', `${pacote.name}.desktop`
);
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(
  destino,
  conteudoDoAtalho({
    nome: pacote.build?.productName ?? pacote.name,
    executavel,
    icone,
    semSandbox,
  }),
  { mode: 0o644 }
);

console.log(`Atalho criado: ${destino}`);
console.log(`  aponta para: ${executavel}`);
if (icone === '') {
  console.log('  sem ícone ainda — ponha um PNG em recursos/icone.png e rode de novo.');
}
if (semSandbox) {
  console.log(
    '  com --no-sandbox, porque o chrome-sandbox não está como root:root 4755.\n' +
      '  Para tirar isso: sudo chown root:root ' +
      path.join(path.dirname(executavel), 'chrome-sandbox') +
      ' && sudo chmod 4755 ' +
      path.join(path.dirname(executavel), 'chrome-sandbox') +
      '\n  e rode este comando de novo.'
  );
}
