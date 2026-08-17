// Higiene do código-fonte.
//
// Nasceu de um defeito real: um byte NUL literal em `useConnections.ts` (corrigido
// em `67f48aa`) fazia o `file` classificar o arquivo como binário. Consequência
// prática: `grep` pulava o arquivo EM SILÊNCIO e o git o tratava como binário nos
// diffs — uma busca voltava vazia com o termo presente, que é o tipo de coisa que
// faz concluir o contrário do que é verdade.
//
// A forma escapada resolve sem perder semântica; este teste impede a volta.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Compilado, este arquivo mora em `dist/server/__tests__` — daí três níveis até a
// raiz. O alvo é o CÓDIGO-FONTE: varrer `dist/` não pegaria nada, porque o `tsc`
// já teria transformado o byte cru na saída.
const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ALVOS = ['src', 'e2e', 'scripts'].map((d) => path.join(RAIZ, d));
const EXTENSOES = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.html', '.css', '.md']);

/** Tudo abaixo de 0x20 exceto tab, LF e CR — o que torna o arquivo "binário". */
function bytesDeControle(conteudo: Buffer): readonly number[] {
  const achados = new Set<number>();
  for (const b of conteudo) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) achados.add(b);
  }
  return [...achados];
}

function* arquivos(dir: string): Generator<string> {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) yield* arquivos(caminho);
    else if (EXTENSOES.has(path.extname(entrada.name))) yield caminho;
  }
}

test('nenhum arquivo-fonte tem byte de controle cru', () => {
  const culpados: string[] = [];
  let varridos = 0;
  for (const alvo of ALVOS.filter((d) => fs.existsSync(d))) {
    for (const arquivo of arquivos(alvo)) {
      varridos += 1;
      const achados = bytesDeControle(fs.readFileSync(arquivo));
      if (achados.length > 0) {
        const hex = achados.map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ');
        culpados.push(`${path.relative(RAIZ, arquivo)}: ${hex}`);
      }
    }
  }

  // Sem isto, um caminho errado passaria como "nenhum problema encontrado" —
  // que é exatamente a falha silenciosa que este teste existe para impedir.
  assert.ok(varridos > 30, `varreu só ${varridos} arquivos; o caminho deve estar errado`);

  assert.deepEqual(
    culpados,
    [],
    'Use a forma escapada (por exemplo "\\u0000") em vez do byte literal.\n' +
      culpados.join('\n')
  );
});
