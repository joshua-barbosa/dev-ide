// Gera o pacote de ícones offline.
//
// A IDE se prende ao loopback justamente para guardar credenciais; buscar ícone
// em servidor de terceiro em tempo de execução contradiria isso, além de não
// funcionar sem rede. Este script extrai do @iconify/json apenas os ícones que
// a interface usa e grava um pacote local, registrado com addCollection().
//
// A lista de ícones vem de src/shared/icons.ts (compilado), que é a mesma fonte
// que a interface consulta — não há como as duas divergirem.
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerIconesProprios } from './icones-proprios.mjs';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = path.join(RAIZ, 'src', 'ui', 'generated', 'icons.json');
const COMPILADO = path.join(RAIZ, 'dist', 'shared', 'icons.js');

if (!fs.existsSync(COMPILADO)) {
  console.error('Faltou compilar o servidor: rode "npm run build:server" antes.');
  process.exit(1);
}

const { ICONES_USADOS, NODE_ICONS, TAB_ICONS, ICONES_DE_SERVICO } = require(COMPILADO);

/** Agrupa "lucide:database" por prefixo, porque cada conjunto é um arquivo. */
const porConjunto = new Map();
for (const completo of ICONES_USADOS) {
  const [prefixo, nome] = completo.split(':');
  if (prefixo === undefined || nome === undefined) {
    console.error(`Nome de ícone inválido: "${completo}" (esperado "conjunto:nome").`);
    process.exit(1);
  }
  if (!porConjunto.has(prefixo)) porConjunto.set(prefixo, []);
  porConjunto.get(prefixo).push(nome);
}

const pacotes = [];
const ausentes = [];

for (const [prefixo, nomes] of porConjunto) {
  const conjunto = require(`@iconify/json/json/${prefixo}.json`);
  const icons = {};

  for (const nome of nomes) {
    // Um alias aponta para outro ícone; resolve-se até o corpo de verdade.
    const alias = conjunto.aliases?.[nome];
    const alvo = alias === undefined ? nome : alias.parent;
    const icone = conjunto.icons[alvo];

    if (icone === undefined) {
      ausentes.push(`${prefixo}:${nome}`);
      continue;
    }
    icons[nome] = icone;
  }

  pacotes.push({
    prefix: prefixo,
    icons,
    width: conjunto.width,
    height: conjunto.height,
  });
}

if (ausentes.length > 0) {
  // Falhar aqui é melhor que descobrir o buraco na tela depois.
  console.error(`Ícones inexistentes no conjunto: ${ausentes.join(', ')}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, JSON.stringify(pacotes));

// **Os ícones dele ganham do catálogo.** Vão num arquivo à parte, como texto
// SVG: o `Icon` desenha o que estiver aqui em vez de pedir ao Iconify.
const validos = new Set([
  ...NODE_ICONS,
  ...TAB_ICONS,
  ...Object.keys(ICONES_DE_SERVICO ?? {}),
]);
const proprios = lerIconesProprios(validos);
const SAIDA_PROPRIOS = path.join(RAIZ, 'src', 'ui', 'generated', 'icones-proprios.json');
fs.writeFileSync(
  SAIDA_PROPRIOS,
  JSON.stringify(Object.fromEntries([...proprios].map(([n, p]) => [n, p.claro])))
);
if (proprios.size > 0) {
  console.log(`${proprios.size} ícone(s) próprio(s) de icones/ ganham do catálogo`);
}

const total = pacotes.reduce((n, p) => n + Object.keys(p.icons).length, 0);
const kb = (fs.statSync(SAIDA).size / 1024).toFixed(1);
console.log(`${total} ícones empacotados em ${path.relative(RAIZ, SAIDA)} (${kb} kB)`);
