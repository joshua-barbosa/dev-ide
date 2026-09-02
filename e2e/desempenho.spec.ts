// Orçamento de desempenho (T098).
//
// Três medidas, e nenhuma delas é uma nota: são tetos que pegam crescimento que
// ninguém viu acontecer. A conta e os motivos moram em `shared/orcamento.ts`,
// para o número e a razão andarem juntos.
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  dentroDoOrcamento, emPalavras, mensagemDeEstouro, orcamentoDe,
} from '../src/shared/orcamento';
import { esperarIdePronta } from './fixtures';

const ASSETS = path.join(process.cwd(), 'dist', 'ui', 'assets');

function tamanhoDaPasta(dir: string): number {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .reduce(
      (soma, e) =>
        soma +
        (e.isDirectory()
          ? tamanhoDaPasta(path.join(dir, e.name))
          : fs.statSync(path.join(dir, e.name)).size),
      0
    );
}

test('o bundle principal cabe no orçamento (T098)', () => {
  // O `index` é o que atrasa a PRIMEIRA pintura — os workers do Monaco vêm
  // depois e só quando a linguagem entra.
  const arquivo = fs.readdirSync(ASSETS).find((n) => /^index-.*\.js$/.test(n));
  expect(arquivo, 'o build precisa existir: rode `npm run build`').toBeDefined();

  const medido = fs.statSync(path.join(ASSETS, arquivo as string)).size;
  const o = orcamentoDe('index');
  expect(dentroDoOrcamento(o, medido), mensagemDeEstouro(o, medido)).toBe(true);
  console.log(`index: ${emPalavras(medido, 'bytes')} / ${emPalavras(o.limite, 'bytes')}`);
});

test('o conjunto de assets cabe no orçamento (T098)', () => {
  // Pega uma dependência pesada entrando de carona — que é como o peso cresce
  // de verdade: nunca de uma vez, sempre de pouquinho.
  const medido = tamanhoDaPasta(ASSETS);
  const o = orcamentoDe('assets');
  expect(dentroDoOrcamento(o, medido), mensagemDeEstouro(o, medido)).toBe(true);
  console.log(`assets: ${emPalavras(medido, 'bytes')} / ${emPalavras(o.limite, 'bytes')}`);
});

test('a IDE fica pronta dentro do orçamento (T098)', async ({ page }) => {
  const comeco = Date.now();
  await page.goto('/');
  await esperarIdePronta(page);
  const medido = Date.now() - comeco;

  const o = orcamentoDe('ide-pronta');
  expect(dentroDoOrcamento(o, medido), mensagemDeEstouro(o, medido)).toBe(true);
  console.log(`ide-pronta: ${emPalavras(medido, 'ms')} / ${emPalavras(o.limite, 'ms')}`);
});

test('abrir um arquivo NÃO recarrega o bundle inteiro (T098)', async ({ page }) => {
  // Um defeito de desempenho que já aconteceu em IDE de verdade: cada abertura
  // rebuscando o mesmo recurso. Aqui se mede o que o navegador PEDIU.
  await page.goto('/');
  await esperarIdePronta(page);

  await page.evaluate(() => performance.clearResourceTimings());
  await page.locator('[data-tree-row="utils.ts"]').click();
  await expect(page.locator('[data-tab="utils.ts"]')).toBeVisible();

  const baixado = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((r) => r.name.endsWith('.js'))
      .reduce((s, r) => s + (r as PerformanceResourceTiming).transferSize, 0)
  );

  // Um worker do Monaco pode nascer aqui — é legítimo. O que não pode é o
  // bundle inteiro voltar pela rede.
  expect(baixado).toBeLessThan(2 * 1024 * 1024);
});
