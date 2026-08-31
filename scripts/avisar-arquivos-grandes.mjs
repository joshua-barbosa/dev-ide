// Aviso: os arquivos desta IDE que passaram de 400 linhas (T034).
//
// O Artigo IV pede 200–400 linhas por arquivo e impõe 800 como teto absoluto. O
// teto tem teste que FALHA (`server/__tests__/fontes.test.ts`); as 400 nunca
// tiveram nada, e é por isso que elas eram só uma frase.
//
// **Aviso, e não erro** — foi a decisão dele na triagem. Arquivo que nasce
// grande por motivo legítimo existe, e um teste que se ignora não guarda nada:
// vira ruído e ensina a passar por cima do que está vermelho.
//
// **Só o código DESTA IDE.** Também foi ele, e com todas as letras: *"se for
// para os arquivos da IDE, ok; se for para os meus projetos, eu não quero"*. A
// varredura é dos diretórios deste repositório, e não da pasta que ele abre —
// não há caminho por onde isto alcance um projeto dele.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALVOS = ['src', 'e2e', 'scripts'];
const RECOMENDADO = 400;
/** O mesmo do teste que falha — aqui só para separar o que já é urgente. */
const TETO = 800;

function* arquivos(dir) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) yield* arquivos(caminho);
    else if (/\.(ts|tsx|mjs)$/.test(entrada.name)) yield caminho;
  }
}

const grandes = [];
for (const alvo of ALVOS.map((d) => path.join(RAIZ, d)).filter((d) => fs.existsSync(d))) {
  for (const arquivo of arquivos(alvo)) {
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').length;
    if (linhas > RECOMENDADO) grandes.push({ caminho: path.relative(RAIZ, arquivo), linhas });
  }
}

grandes.sort((a, b) => b.linhas - a.linhas);

if (grandes.length === 0) {
  console.log(`Artigo IV: nenhum arquivo acima de ${RECOMENDADO} linhas.`);
} else {
  console.log(
    `\nAVISO (Artigo IV) — ${grandes.length} arquivo(s) acima de ${RECOMENDADO} linhas:`
  );
  for (const { caminho, linhas } of grandes) {
    // O que já passou de 800 é outro assunto: aquele tem teste que falha.
    const marca = linhas > TETO ? '  ← passou do TETO de 800' : '';
    console.log(`  ${String(linhas).padStart(4)}  ${caminho}${marca}`);
  }
  console.log(
    'Não é erro: é a lista do que vale partir quando alguém encostar nesses ' +
      'arquivos.\n'
  );
}

// Sempre 0. Ver a nota do topo: transformar isto em erro é a maneira mais rápida
// de ensinar a ignorá-lo.
process.exit(0);
