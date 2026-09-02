// Acessibilidade nas telas que se usa todo dia (T098).
//
// Roda o axe, mas **só as regras que esta IDE se cobra** — a lista e os motivos
// de cada dispensa moram em `shared/acessibilidade.ts`, onde são testados sem
// navegador. Passar todas as regras faria o teste reprovar coisas que ninguém
// vai consertar (contraste de um tema que ele escolheu, marcas de região numa
// grade de painéis), e um teste assim acaba desligado.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { abrirArquivo, esperarIdePronta, menu, painelLateral } from './fixtures';
import { relatorio, REGRAS_COBRADAS, type Violacao } from '../src/shared/acessibilidade';

async function violacoes(page: Page): Promise<readonly Violacao[]> {
  const r = await new AxeBuilder({ page }).withRules([...REGRAS_COBRADAS]).analyze();
  return r.violations.map((v) => ({
    regra: v.id,
    descricao: v.help,
    // O SELETOR, e não a contagem: é o que se cola no console para achar.
    alvos: v.nodes.map((n) => n.target.join(' ')),
  }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a tela principal, com um arquivo aberto (T098)', async ({ page }) => {
  await abrirArquivo(page, 'utils.ts');
  const v = await violacoes(page);
  expect(v, relatorio(v)).toEqual([]);
});

test('a barra de menus aberta (T098)', async ({ page }) => {
  await menu(page, 'File');
  const v = await violacoes(page);
  expect(v, relatorio(v)).toEqual([]);
});

test('o painel inferior, que é só ícone (T098)', async ({ page }) => {
  // A barra do painel é feita de botões de ícone — o caso em que "botão sem
  // nome" mais aparece, e em que o leitor de tela anuncia só "botão".
  //
  // `Ctrl+J` ALTERNA, então apertá-lo às cegas fecharia o painel se ele já
  // estivesse aberto. E ele continua no DOM quando escondido (a emenda
  // constitucional: esconder é `display: none`, nunca desmontar), então a
  // pergunta certa é se está VISÍVEL.
  const painel = page.locator('[data-painel-inferior]');
  if (!(await painel.isVisible())) await page.keyboard.press('Control+j');
  await expect(painel).toBeVisible();
  const v = await violacoes(page);
  expect(v, relatorio(v)).toEqual([]);
});

test('o painel de conexões, que é feito de campos (T098)', async ({ page }) => {
  // Campo sem rótulo é o segundo caso mais comum, e é aqui que há campos.
  await painelLateral(page, 'Database').click();
  const v = await violacoes(page);
  expect(v, relatorio(v)).toEqual([]);
});

test('o próprio verificador PEGA uma violação (T098)', async ({ page }) => {
  // Sem isto, os quatro testes acima poderiam estar passando à toa — um axe mal
  // ligado, uma lista de regras vazia, um seletor errado — e ninguém saberia.
  // Aqui se planta o defeito e se cobra que ele apareça.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'botao-sem-nome-de-proposito';
    document.body.appendChild(b);
  });

  const v = await violacoes(page);
  const achou = v.find((x) => x.regra === 'button-name');
  expect(achou, `o verificador não viu o botão sem nome. Achou: ${relatorio(v)}`).toBeDefined();
  // E o relatório aponta ONDE, que é o que deixa consertar.
  expect(achou?.alvos.join(' ')).toContain('botao-sem-nome-de-proposito');
});
