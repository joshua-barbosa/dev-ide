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
const ALVOS = ['src', 'e2e', 'scripts', 'extensao'].map((d) => path.join(RAIZ, d));

/**
 * Pastas que a varredura NÃO desce.
 *
 * `extensao/` entrou nos alvos com a prova de conceito (spec 092), e ela tem
 * `node_modules`, `dist` e `webview` próprios. Sem isto, o teto de 800 linhas
 * reprovaria o `vscode.d.ts` — código de outra pessoa, que não é nosso para
 * encurtar — e a varredura de bytes de controle reprovaria o `painel.js`, que é
 * saída do Vite, não fonte.
 */
const NAO_DESCER = new Set(['node_modules', 'dist', 'webview']);
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
    if (entrada.isDirectory()) {
      if (NAO_DESCER.has(entrada.name)) continue;
      yield* arquivos(caminho);
    }
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

// ---------------------------------------------------------------------------
// Ícone pedido pela interface precisa estar empacotado
// ---------------------------------------------------------------------------
//
// `resolverIcone` devolve o genérico para o que não conhece — o que é a decisão
// certa em tempo de execução (driver mais novo que a interface não pode abrir
// buraco na tela), mas esconde erro de digitação nosso: o ícone some e vira um
// círculo, em silêncio.
//
// Aconteceu de verdade na spec 012: o navegador de pastas pediu `lucide:check` e
// `lucide:corner-left-up` sem acrescentá-los à lista, e os dois apareceram como
// círculo na tela. Este teste faz o mesmo erro falhar antes de chegar lá.

import { ICONE_GENERICO, ICONES_USADOS, resolverIcone } from '../../shared/icons';

/** Nomes qualificados escritos como literal na interface, ex.: `'lucide:x'`. */
function iconesLiteraisDaInterface(): ReadonlySet<string> {
  const achados = new Set<string>();
  const varrer = (dir: string): void => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const alvo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        varrer(alvo);
        continue;
      }
      if (!/\.tsx?$/.test(entrada.name)) continue;
      const conteudo = fs.readFileSync(alvo, 'utf8');
      // Aspas simples E duplas: atributo de JSX usa `icone="lucide:x"`, e a
      // versão anterior só via `'lucide:x'`. Três ícones da spec 041 passaram
      // pelo buraco e apareceram como bolinha na tela do usuário.
      for (const casamento of conteudo.matchAll(/['"]([a-z0-9-]+:[a-z0-9-]+)['"]/g)) {
        const nome = casamento[1];
        // Só conjuntos de ícone; `data:`, `http:` e afins não contam.
        if (nome !== undefined && /^(lucide|devicon|vscode-icons|logos):/.test(nome)) {
          achados.add(nome);
        }
      }
    }
  };
  varrer(path.join(RAIZ, 'src', 'ui'));
  return achados;
}

test('todo ícone pedido por nome na interface está empacotado', () => {
  const declarados = new Set(ICONES_USADOS);
  const faltando = [...iconesLiteraisDaInterface()].filter((n) => !declarados.has(n));
  assert.deepEqual(
    faltando,
    [],
    `ícones pedidos pela interface e ausentes de ICONES_USADOS: ${faltando.join(', ')}`
  );
});

/**
 * Nomes CURTOS passados ao `Icon`, como `name="chevron-right"`.
 *
 * O teste acima só via os qualificados (`lucide:x`). O curto passa por `MAPA` e,
 * quando não está lá, `resolverIcone` devolve o genérico — em silêncio, e o que
 * aparece na tela é um círculo. Aconteceu no painel de busca: os dois chevrons
 * do agrupamento por arquivo saíram como círculo.
 */
function iconesCurtosDaInterface(): ReadonlySet<string> {
  const achados = new Set<string>();
  const varrer = (dir: string): void => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const alvo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        varrer(alvo);
        continue;
      }
      if (!/\.tsx?$/.test(entrada.name)) continue;
      // Só literal entre aspas: `name={variavel}` é decidido em tempo de
      // execução e não dá para conferir aqui.
      for (const casamento of fs.readFileSync(alvo, 'utf8').matchAll(/name=\{?["']([a-z0-9-]+)["']\}?/g)) {
        const nome = casamento[1];
        if (nome !== undefined && !nome.includes(':')) achados.add(nome);
      }
    }
  };
  varrer(path.join(RAIZ, 'src', 'ui'));
  return achados;
}

test('todo ícone pedido por nome CURTO resolve para um empacotado', () => {
  const faltando = [...iconesCurtosDaInterface()].filter(
    (nome) => resolverIcone(nome) === ICONE_GENERICO
  );
  assert.deepEqual(
    faltando,
    [],
    `nomes curtos que caem no ícone genérico (viram círculo na tela): ${faltando.join(', ')}`
  );
});

/**
 * O teto de tamanho do Artigo IV: 800 linhas, absoluto.
 *
 * Estava escrito na constituição e em lugar nenhum que falhasse — e dois
 * arquivos o ultrapassaram durante o lote da parte 1 sem nada apitar. É o mesmo
 * buraco do typecheck da interface: garantia no papel, não no portão.
 *
 * O limite "na prática" (400) NÃO entra aqui de propósito: seria ruído em
 * arquivo que já nasce grande por motivo legítimo, e um teste que se ignora não
 * guarda nada. O que este teste protege é o teto que não se negocia.
 */
const MAX_LINHAS = 800;

test('nenhum arquivo-fonte passa do teto de 800 linhas', () => {
  const grandes: string[] = [];
  for (const alvo of ALVOS.filter((d) => fs.existsSync(d))) {
    for (const arquivo of arquivos(alvo)) {
      if (!/\.tsx?$/.test(arquivo)) continue;
      const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').length;
      if (linhas > MAX_LINHAS) grandes.push(`${path.relative(RAIZ, arquivo)}: ${linhas}`);
    }
  }
  assert.deepEqual(
    grandes,
    [],
    `passaram do teto absoluto do Artigo IV (${MAX_LINHAS} linhas):\n  ${grandes.join('\n  ')}`
  );
});
