// Os interruptores de categoria no cadastro (03/09/2026, ele).
//
// O que se prova aqui é o Artigo III de ponta a ponta: o DRIVER declara os
// campos, a tela os desenha sem saber o que significam, e a árvore obedece ao
// que ficou gravado. Nada disso está escrito no frontend.
import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SENHA_MESTRA } from './global-setup';
import {
  aba, confirmar, destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta,
} from './fixtures';

/** Um banco com tabela, índice e GATILHO — um de cada categoria opcional. */
function bancoComGatilho(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'braytech-cat-')), 'loja.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE pedidos (id INTEGER PRIMARY KEY, total REAL, visto TEXT)');
  db.exec('CREATE INDEX idx_total ON pedidos(total)');
  db.exec(
    'CREATE TRIGGER marca_visto AFTER INSERT ON pedidos '
    + "BEGIN UPDATE pedidos SET visto = datetime('now') WHERE id = NEW.id; END"
  );
  db.close();
  return file;
}

function formulario(page: import('@playwright/test').Page) {
  return page.getByRole('form', { name: 'Formulário de conexão' });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
  await painelLateral(page, 'Database').click();
  const destrancar = page.getByRole('button', { name: 'Destrancar o cofre' });
  if (await destrancar.isVisible()) {
    await destrancar.click();
    await destrancarCofre(page, SENHA_MESTRA);
  }
  await expect(page.getByRole('button', { name: 'Nova conexão', exact: true })).toBeVisible();
});

/** Cria a conexão e devolve uma função que a apaga. */
async function criar(
  page: import('@playwright/test').Page,
  nome: string,
  desligar: readonly string[]
): Promise<void> {
  await page.getByRole('button', { name: 'Nova conexão', exact: true }).click();
  await expect(aba(page, 'Nova conexão')).toBeVisible();
  await formulario(page).getByLabel('Nome', { exact: true }).fill(nome);
  await formulario(page).getByLabel('Grupo').fill('ACME/Bancos');
  await formulario(page).getByRole('button', { name: 'SQLite', exact: true }).click();
  await formulario(page).getByLabel('Arquivo').fill(bancoComGatilho());

  if (desligar.length > 0) {
    // A seção `Árvore` vem RECOLHIDA — só a principal abre sozinha. Abrir aqui
    // é o mesmo clique que ele daria.
    await formulario(page).getByRole('button', { name: 'Árvore' }).click();
  }

  for (const rotulo of desligar) {
    const caixa = formulario(page).getByLabel(rotulo, { exact: true });
    await expect(caixa, `o interruptor "${rotulo}" tem de existir no cadastro`).toBeVisible();
    await caixa.uncheck();
  }

  await formulario(page).getByRole('button', { name: 'salvar', exact: true }).click();
  await expect(aba(page, 'Nova conexão')).toHaveCount(0);
}

async function apagar(page: import('@playwright/test').Page, nome: string): Promise<void> {
  const linha = linhaArvore(page, nome);
  await linha.hover();
  await linha.getByRole('button', { name: 'Excluir conexão' }).click();
  await confirmar(page, true);
  await expect(linhaArvore(page, nome)).toHaveCount(0);
}

test('o cadastro do SQLite oferece os interruptores, e a árvore mostra Triggers', async ({ page }) => {
  await criar(page, 'com-tudo', []);
  await expandir(page, 'ACME', 'Bancos');
  await expandir(page, 'com-tudo', 'loja.db');

  await expect(linhaArvore(page, 'Tables')).toBeVisible();
  await expect(linhaArvore(page, 'Indexes')).toBeVisible();
  // A categoria que nasceu hoje, a pedido dele.
  await expect(linhaArvore(page, 'Triggers')).toBeVisible();

  await expandir(page, 'Triggers');
  await expect(linhaArvore(page, 'marca_visto')).toBeVisible();

  await apagar(page, 'com-tudo');
});

test('desmarcar o interruptor tira a categoria daquela conexão', async ({ page }) => {
  await criar(page, 'sem-gatilho', ['Mostrar Triggers', 'Mostrar Indexes']);
  await expandir(page, 'ACME', 'Bancos');
  await expandir(page, 'sem-gatilho', 'loja.db');

  await expect(linhaArvore(page, 'Tables')).toBeVisible();
  await expect(linhaArvore(page, 'Views')).toBeVisible();
  await expect(linhaArvore(page, 'Triggers')).toHaveCount(0);
  await expect(linhaArvore(page, 'Indexes')).toHaveCount(0);

  await apagar(page, 'sem-gatilho');
});

test('nome longo de detalhe NÃO come o nome da linha', async ({ page }) => {
  // Ele viu em 03/09/2026: nos `Procedures` do PostgreSQL, cujo detalhe são os
  // argumentos, a linha mostrava só a descrição — sem dizer de que coisa era.
  //
  // Aqui o detalhe é forjado na própria linha renderizada, porque o defeito é
  // do layout e não do driver: é a MESMA linha que os dois painéis usam.
  await criar(page, 'medida', []);
  await expandir(page, 'ACME', 'Bancos');
  await expandir(page, 'medida', 'loja.db');
  await expandir(page, 'Tables');

  const linha = linhaArvore(page, 'pedidos');
  await expect(linha).toBeVisible();

  const medida = await linha.evaluate((el) => {
    const caixas = [...el.children] as HTMLElement[];
    // O rótulo é a caixa cujo texto é o nome; o detalhe é a última.
    const rotulo = caixas.find((c) => c.textContent?.trim() === 'pedidos');
    const detalhe = caixas[caixas.length - 1];
    if (rotulo === undefined) return null;

    // Espreme a linha e alonga o detalhe: é o estado em que o defeito aparecia.
    (el as HTMLElement).style.width = '220px';
    detalhe.textContent = 'IN hypertable regclass, IN after "any", IN chunk regclass';

    return {
      larguraDoRotulo: rotulo.getBoundingClientRect().width,
      textoCabe: rotulo.scrollWidth <= rotulo.clientWidth,
      larguraDoDetalhe: detalhe.getBoundingClientRect().width,
      larguraDaLinha: el.getBoundingClientRect().width,
    };
  });

  expect(medida, 'a caixa do rótulo tem de existir na linha').not.toBeNull();
  expect(medida!.larguraDoRotulo, 'o nome não pode desaparecer').toBeGreaterThan(0);
  expect(medida!.textoCabe, 'o nome curto não pode ser cortado por causa do detalhe').toBe(true);
  expect(
    medida!.larguraDoDetalhe,
    'o detalhe não pode passar de metade da linha'
  ).toBeLessThanOrEqual(medida!.larguraDaLinha / 2 + 1);

  await apagar(page, 'medida');
});
