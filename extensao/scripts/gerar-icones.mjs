// Gera os SVG da árvore da extensão a partir da MESMA fonte que a IDE usa.
//
// A primeira versão traduzia `lucide:table` para o `ThemeIcon` mais parecido do
// VS Code, à mão. Ele viu na hora: *"os ícones que representam, não carrega
// quase corretamente"*. E tinha razão — um mapa escrito à mão contra um conjunto
// que ele não controla envelhece no primeiro driver novo, e nunca fica igual.
//
// Aqui não há tradução: `shared/icons.ts` resolve o nome lógico (`matview`) para
// o ícone real (`lucide:layers`), e o `@iconify/json` dá o desenho. É a mesma
// cadeia da IDE, então os dois desenham a MESMA coisa por construção.
//
// Duas cópias de cada, clara e escura: o VS Code não recolore SVG de árvore, e
// um traço escuro some no tema escuro.
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const SAIDA = path.join(AQUI, '..', 'recursos', 'icones');
const COMPILADO = path.join(RAIZ, 'dist', 'shared', 'icons.js');

if (!fs.existsSync(COMPILADO)) {
  console.error('Faltou compilar o motor: rode "npm run build:server" na raiz.');
  process.exit(1);
}

const { NODE_ICONS, ICONES_DE_SERVICO, ICONE_DE_SSH, ICONE_DE_FTP, resolverIcone } =
  require(COMPILADO);

/** A cor do traço em cada tema. O VS Code não recolore SVG na árvore. */
const COR = { light: '#424242', dark: '#c5c5c5' };

/** Nomes lógicos que a árvore pode receber, mais os de marca dos serviços. */
const logicos = new Set([...NODE_ICONS, 'query', 'folder', 'file', 'link', 'terminal']);
const completos = new Set([
  ...[...logicos].map((n) => resolverIcone(n)),
  ...Object.values(ICONES_DE_SERVICO ?? {}),
  ICONE_DE_SSH,
  ICONE_DE_FTP,
]);

/** Agrupa por conjunto: cada um é um arquivo do `@iconify/json`. */
const porConjunto = new Map();
for (const completo of completos) {
  if (typeof completo !== 'string' || !completo.includes(':')) continue;
  const [prefixo, nome] = completo.split(':');
  if (!porConjunto.has(prefixo)) porConjunto.set(prefixo, new Set());
  porConjunto.get(prefixo).add(nome);
}

fs.rmSync(SAIDA, { recursive: true, force: true });
fs.mkdirSync(SAIDA, { recursive: true });

let escritos = 0;
for (const [prefixo, nomes] of porConjunto) {
  const arquivo = require.resolve(`@iconify/json/json/${prefixo}.json`);
  const colecao = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const lado = colecao.width ?? 24;

  for (const nome of nomes) {
    const icone = colecao.icons[nome];
    if (icone === undefined) {
      console.warn(`  ! ${prefixo}:${nome} não existe no conjunto — fica o genérico`);
      continue;
    }
    const caixa = `0 0 ${icone.width ?? lado} ${icone.height ?? lado}`;
    for (const [tema, cor] of Object.entries(COR)) {
      // O `devicon` já vem colorido e com preenchimento próprio: recolorir
      // apagaria a marca. O `lucide` é traço, e é ele que precisa de cor.
      const pintura = prefixo === 'lucide'
        ? `fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`
        : '';
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${caixa}" ${pintura}>${icone.body}</svg>`;
      fs.writeFileSync(path.join(SAIDA, `${prefixo}-${nome}-${tema}.svg`), svg);
      escritos += 1;
    }
  }
}

console.log(`  ${escritos} arquivos em recursos/icones (${completos.size} ícones × 2 temas)`);
