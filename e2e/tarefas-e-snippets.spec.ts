// Tarefas do projeto, snippets do VS Code e Emmet configurável (lote K).
//
// A desculpa que eu tinha escrito para o `tasks.json` estava no cabeçalho de
// `comandos-salvos.ts`: *"tarefas compostas, de fundo e grupos são máquina
// demais para um projeto de uma pessoa"*. Era palpite meu sobre o trabalho
// dele.
//
// O plano de execução é testado sem navegador (`shared/__tests__/tarefas.ts`).
// Aqui se prova o caminho: o arquivo do projeto vira lista, e a lista roda.
import { expect, test, type Page } from '@playwright/test';
import { entradaRapida, esperarIdePronta, menu, painelLateral } from './fixtures';

/** Escreve um arquivo dentro da pasta aberta, pela própria IDE. */
async function gravarNoProjeto(page: Page, relativo: string, conteudo: unknown): Promise<void> {
  await page.evaluate(
    async ([caminho, texto]) => {
      const r = await fetch('/api/workspace');
      const { pasta } = (await r.json()).data as { pasta: string };
      await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: caminho, content: '' }),
      }).catch(() => undefined);
      await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${pasta}/${caminho}`, content: texto }),
      });
    },
    [relativo, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2)] as const
  );
}

async function apagarDoProjeto(page: Page, relativo: string): Promise<void> {
  await page.evaluate(async (caminho) => {
    const r = await fetch('/api/workspace');
    const { pasta } = (await r.json()).data as { pasta: string };
    await fetch('/api/workspace/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${pasta}/${caminho}` }),
    });
  }, relativo);
}

const TAREFAS = {
  version: '2.0.0',
  tasks: [
    { label: 'limpar', type: 'shell', command: 'echo limpando' },
    { label: 'compilar', type: 'shell', command: 'echo compilando', dependsOn: 'limpar',
      group: { kind: 'build', isDefault: true } },
    { label: 'testar', type: 'shell', command: 'echo testando', group: 'test' },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test.afterEach(async ({ page }) => {
  // `.vscode` é estado do DISCO na pasta compartilhada da suíte.
  await apagarDoProjeto(page, '.vscode');
});

test('as tarefas do tasks.json aparecem na caixa de comandos (T015)', async ({ page }) => {
  await gravarNoProjeto(page, '.vscode/tasks.json', TAREFAS);

  await page.keyboard.press('Control+Shift+r');
  const caixa = page.getByRole('dialog', { name: 'Comandos' });

  // As do projeto vêm primeiro: são as do repositório em que ele está.
  await expect(caixa.getByRole('option').first()).toContainText('limpar');
  await expect(caixa.getByRole('option', { name: /compilar/ })).toContainText('build');
  await expect(caixa.getByRole('option', { name: /testar/ })).toContainText('test');
});

test('rodar uma tarefa composta roda a DEPENDÊNCIA antes (T015)', async ({ page }) => {
  await gravarNoProjeto(page, '.vscode/tasks.json', TAREFAS);

  await page.keyboard.press('Control+Shift+r');
  await entradaRapida(page).fill('compilar');
  await entradaRapida(page).press('Enter');

  // Dois terminais: um por passo do plano.
  const terminais = page.locator('[data-terminal]');
  await expect(terminais).toHaveCount(2, { timeout: 15_000 });
  // O da dependência é o PRIMEIRO da lista, e está escondido — terminal
  // escondido não desenha texto. Trocar para ele é o que revela o que rodou.
  await page.locator('[data-terminal-item]').first().click();
  await expect(page.locator('[data-terminal]:visible').first()).toContainText('limpando', {
    timeout: 15_000,
  });
});

test('Run Build Task roda a marcada como padrão, sem perguntar (T016)', async ({ page }) => {
  await gravarNoProjeto(page, '.vscode/tasks.json', TAREFAS);

  await page.keyboard.press('Control+Shift+b');
  // Sem caixa nenhuma: a tarefa padrão é conhecida.
  await expect(page.getByRole('dialog', { name: 'Comandos' })).toHaveCount(0);
  await expect(page.locator('[data-terminal]').last()).toContainText('compilando', {
    timeout: 15_000,
  });
});

test('sem tarefa nenhuma, Run Build Task DIZ o que falta (T016)', async ({ page }) => {
  await page.keyboard.press('Control+Shift+b');
  const caixa = page.getByRole('dialog');
  await expect(caixa).toContainText('tasks.json');
  await expect(caixa).toContainText('isDefault');
});

test('tasks.json com dependência inexistente falha DIZENDO qual (T015)', async ({ page }) => {
  await gravarNoProjeto(page, '.vscode/tasks.json', {
    version: '2.0.0',
    tasks: [{ label: 'solta', command: 'echo x', dependsOn: 'fantasma' }],
  });

  await page.keyboard.press('Control+Shift+r');
  await entradaRapida(page).fill('solta');
  await entradaRapida(page).press('Enter');

  // Silenciar transformaria um label digitado errado em "rodou sem o build".
  await expect(page.getByRole('dialog')).toContainText('fantasma', { timeout: 10_000 });
});

test('os snippets do PROJETO aparecem na caixa (T018)', async ({ page }) => {
  await gravarNoProjeto(page, '.vscode/meus.code-snippets', {
    'Do repositório': { prefix: 'zorbaxproj', body: ['linha $1'] },
  });
  await page.reload();
  await esperarIdePronta(page);

  await page.keyboard.press('Control+Shift+j');
  const caixa = page.getByRole('dialog', { name: 'Snippets' });
  await expect(caixa.getByRole('option', { name: /zorbaxproj/ })).toBeVisible();
});

test('importar snippets do VS Code diz QUANTOS entraram (T017)', async ({ page }) => {
  // `.code-snippets` para o snippet valer em TODAS as linguagens: a caixa
  // filtra pela linguagem do editor, e sem arquivo aberto um snippet de SQL
  // não apareceria — o que seria o comportamento certo, e não o que este teste
  // quer provar.
  await gravarNoProjeto(page, '.vscode/importar-daqui/meus.code-snippets', {
    Select: { prefix: 'zorbaxsel', body: 'SELECT * FROM $1' },
  });

  const pasta = await page.evaluate(async () => {
    const r = await fetch('/api/workspace');
    return `${((await r.json()).data as { pasta: string }).pasta}/.vscode/importar-daqui`;
  });

  await page.keyboard.press('Control+Shift+j');
  await page.getByRole('option', { name: /Importar snippets do VS Code/ }).click();
  await entradaRapida(page).fill(pasta);
  await entradaRapida(page).press('Enter');

  // Importar em silêncio deixaria quem importou sem saber se funcionou.
  await expect(page.getByRole('dialog')).toContainText('1 snippet');

  await page.getByRole('button', { name: /ok|fechar|confirmar/i }).first().click();
  await page.keyboard.press('Control+Shift+j');
  await expect(
    page.getByRole('dialog', { name: 'Snippets' }).getByRole('option', { name: /zorbaxsel/ })
  ).toBeVisible();
});
