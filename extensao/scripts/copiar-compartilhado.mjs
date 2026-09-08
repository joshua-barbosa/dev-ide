// Os arquivos PUROS do `src/shared` que a extensão também usa.
//
// A extensão compila com `rootDir: extensao/src` e não alcança `src/shared` —
// então eles são copiados. Copiar à mão é como as cópias divergem, e divergir
// aqui significa: o mesmo diagrama desenhado de dois jeitos, o mesmo ícone com
// dois nomes. Por isso a cópia é GERADA, e um teste exige as duas idênticas
// byte a byte.
//
// **Só entra aqui arquivo sem `import` nenhum.** Um `import` obrigaria a
// arrastar a cadeia inteira, e aí a cópia deixa de ser cópia.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const COMPARTILHADOS = [
  { de: 'src/shared/icones-do-editor.ts', para: 'extensao/src/icones-do-editor.ts' },
  { de: 'src/shared/sql/diagrama-er.ts', para: 'extensao/src/diagrama-er.ts' },
];

let mudou = 0;
for (const { de, para } of COMPARTILHADOS) {
  const origem = readFileSync(path.join(RAIZ, de), 'utf8');
  if (/^\s*import\s/m.test(origem)) {
    console.error(`copiar-compartilhado: ${de} tem \`import\` — não pode ser copiado assim.`);
    process.exit(1);
  }
  const destino = path.join(RAIZ, para);
  mkdirSync(path.dirname(destino), { recursive: true });
  let atual = null;
  try {
    atual = readFileSync(destino, 'utf8');
  } catch {
    atual = null;
  }
  if (atual !== origem) {
    writeFileSync(destino, origem);
    mudou += 1;
  }
}
console.log(
  `copiar-compartilhado: ${COMPARTILHADOS.length} arquivo(s), ${mudou} atualizado(s)`
);
