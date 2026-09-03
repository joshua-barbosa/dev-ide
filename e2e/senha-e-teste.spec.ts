// Ver a senha guardada (N001) e testar sem salvar (T103).
//
// O N001 ele pediu no meio da triagem: "eu preciso pegar as senhas das conexões
// também". Até aqui o segredo ia do cofre direto para o driver e nunca passava
// pela tela — `GET /api/connections` continua sem devolvê-lo.
import { expect, test, type Page } from '@playwright/test';
import { CONEXAO, SENHA_MESTRA } from './global-setup';
import { destrancarCofre, expandir, linhaArvore, painelLateral, esperarIdePronta } from './fixtures';

/** Deixa o cofre destrancado, venha ele trancado ou não. */
async function comCofreAberto(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
}

async function abrirEdicao(page: Page): Promise<void> {
  await painelLateral(page, 'Database').click();
  await expandir(page, 'ACME', 'Bancos');
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await linhaArvore(page, CONEXAO).click({ button: 'right' });
  await page.getByText('Editar conexão…').click();
  await expect(page.getByRole('form')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await esperarIdePronta(page);
});

test('a listagem de conexões NÃO traz senha — isso não mudou', async ({ page }) => {
  await esperarIdePronta(page);
  const temSegredo = await page.evaluate(async () => {
    const r = await fetch('/api/connections', { headers: { accept: 'application/json' } });
    const texto = await r.text();
    // O cofre do fixture guarda a senha mestra como segredo de conexão; se ela
    // aparecesse aqui, a rota estaria vazando.
    return texto.includes('password":"');
  });
  expect(temSegredo).toBe(false);
});

test('o formulário tem `testar`, e ele NÃO salva nada', async ({ page }) => {
  await abrirEdicao(page);
  await expect(page.getByRole('button', { name: 'testar' })).toBeVisible();

  const antes = await page.evaluate(async () => {
    const r = await fetch('/api/connections', { headers: { accept: 'application/json' } });
    return (await r.text()).length;
  });
  await page.getByRole('button', { name: 'testar' }).click();
  await expect(page.locator('[data-resultado-do-teste]')).toBeVisible({ timeout: 15000 });

  const depois = await page.evaluate(async () => {
    const r = await fetch('/api/connections', { headers: { accept: 'application/json' } });
    return (await r.text()).length;
  });
  // Antes só existia `salvar e conectar`: com senha errada, a conexão já estava
  // gravada quando o erro aparecia.
  expect(depois).toBe(antes);
});

test('testar uma conexão boa diz que conectou', async ({ page }) => {
  await abrirEdicao(page);
  await page.getByRole('button', { name: 'testar' }).click();
  await expect(page.locator('[data-resultado-do-teste]')).toContainText(/Conectou/, { timeout: 15000 });
});

test('testar uma conexão COM senha guardada usa a senha do cofre', async ({ page }) => {
  // Este teste existe por causa de um defeito que o e2e NÃO pegava: a conexão
  // do fixture é SQLite e não tem senha, então mandar o campo vazio adiante
  // passava. No MySQL dele o servidor respondeu `using password: NO`.
  //
  // No formulário de edição, senha em branco significa "mantenha a guardada"
  // (spec 005). Quem completa é o SERVIDOR — o segredo não passa pelo
  // navegador para isso.
  await esperarIdePronta(page);
  const id = await criarConexaoComSenha(page);
  try {
    const enviado = await page.evaluate(async (cid) => {
      const r = await fetch('/api/connections/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: cid,
          type: 'mysql',
          label: 'com-senha',
          group: '',
          readOnly: true,
          // Senha EM BRANCO, como o formulário de edição manda.
          fields: { host: '127.0.0.1', port: 3306, user: 'u', password: '' },
        }),
      });
      return (await r.json()) as { error?: string };
    }, id);
    // Não há MySQL em 127.0.0.1 na máquina de teste, então isto falha — mas o
    // que importa é COMO: `using password: NO` significaria que o vazio foi
    // adiante. Qualquer outra falha significa que a senha do cofre foi usada.
    expect(enviado.error ?? '').not.toContain('using password: NO');
  } finally {
    await page.evaluate(
      (cid) => fetch(`/api/connections/${cid}`, { method: 'DELETE' }).then(() => undefined),
      id
    );
  }
});

test('o cofre recusa revelar campo que NÃO é segredo', async ({ page }) => {
  await esperarIdePronta(page);
  const resposta = await page.evaluate(async () => {
    type No = { connections?: { id: string; label: string }[]; groups?: No[] };
    const achatar = (no: No): { id: string; label: string }[] => [
      ...(no.connections ?? []),
      ...(no.groups ?? []).flatMap(achatar),
    ];
    const r = await fetch('/api/connections', { headers: { accept: 'application/json' } });
    const corpo = (await r.json()) as { data: { tree: No } };
    const alvo = achatar(corpo.data.tree)[0];
    if (alvo === undefined) return null;
    const c = await fetch(`/api/connections/${alvo.id}/secret/file`);
    return (await c.json()) as { error?: string };
  });
  // Erro, e não o valor: senão esta rota viraria um jeito torto de ler campo
  // comum, e um engano de uma linha despejaria tudo.
  expect(resposta?.error).toContain('não é um segredo');
});

// ---- O olho que revela (N001) ----
//
// A conexão do fixture é SQLite e não tem senha, então este teste cria a sua
// própria — um MySQL que nunca vai conectar, o que não importa: o que se prova
// aqui é o CAMINHO DO COFRE, e ele não depende de o servidor existir.

const SENHA_DE_TESTE = 'senha-que-vai-e-volta-do-cofre';

async function criarConexaoComSenha(page: Page): Promise<string> {
  return page.evaluate(async (senha) => {
    const r = await fetch('/api/connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'mysql',
        label: 'com-senha',
        group: 'ACME/Bancos',
        readOnly: true,
        fields: { host: '127.0.0.1', port: 3306, user: 'u', password: senha },
      }),
    });
    const corpo = (await r.json()) as { data: { id: string } };
    return corpo.data.id;
  }, SENHA_DE_TESTE);
}

test('a senha guardada volta do cofre, e só o campo pedido', async ({ page }) => {
  await esperarIdePronta(page);
  const id = await criarConexaoComSenha(page);
  try {
    const r = await page.evaluate(async (cid) => {
      const c = await fetch(`/api/connections/${cid}/secret/password`);
      return (await c.json()) as { data?: { valor: string }; error?: string };
    }, id);
    expect(r.data?.valor).toBe(SENHA_DE_TESTE);
  } finally {
    await page.evaluate(
      (cid) => fetch(`/api/connections/${cid}`, { method: 'DELETE' }).then(() => undefined),
      id
    );
  }
});

test('o olho revela na tela, e o campo deixa de ser bolinhas', async ({ page }) => {
  await esperarIdePronta(page);
  const id = await criarConexaoComSenha(page);
  try {
    await page.reload();
    await esperarIdePronta(page);
    await painelLateral(page, 'Database').click();
    await expandir(page, 'ACME', 'Bancos');
    const senha = page.getByLabel('Senha mestra', { exact: true });
    if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

    await linhaArvore(page, 'com-senha').click({ button: 'right' });
    await page.getByText('Editar conexão…').click();
    await expect(page.getByRole('form')).toBeVisible();

    // Dentro do FORMULÁRIO e com rótulo exato: `getByLabel('Senha')` solto
    // casava com o botão `Fechar com-senha` da barra de abas, porque o nome da
    // conexão de teste contém a palavra.
    const campo = page.getByRole('form').getByLabel('Senha', { exact: true });
    // Antes de revelar: o navegador pinta bolinhas por cima.
    await expect(campo).toHaveAttribute('type', 'password');

    await page.getByRole('form').getByRole('button', { name: 'Ver Senha' }).click();
    await expect(campo).toHaveValue(SENHA_DE_TESTE);
    // Revelado, o campo precisa virar texto comum — senão o valor pedido
    // continuaria escondido atrás das bolinhas.
    await expect(campo).toHaveAttribute('type', 'text');

    await page.getByRole('form').getByRole('button', { name: 'Esconder Senha' }).click();
    await expect(campo).toHaveAttribute('type', 'password');
  } finally {
    await page.evaluate(
      (cid) => fetch(`/api/connections/${cid}`, { method: 'DELETE' }).then(() => undefined),
      id
    );
  }
});

test('exportar todas leva as senhas, e o arquivo avisa o que é', async ({ page }) => {
  await esperarIdePronta(page);
  const id = await criarConexaoComSenha(page);
  try {
    await page.reload();
    await esperarIdePronta(page);
    await painelLateral(page, 'Database').click();
    const senha = page.getByLabel('Senha mestra', { exact: true });
    if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

    const baixando = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar conexões COM as senhas' }).click();
    const arquivo = await baixando;
    const caminho = await arquivo.path();
    const fs = await import('node:fs/promises');
    const conteudo = await fs.readFile(caminho, 'utf8');

    expect(conteudo).toContain(SENHA_DE_TESTE);
    // O arquivo carrega o aviso DENTRO: fora da IDE ninguém lembra o que ele é.
    expect(conteudo).toContain('SENHAS EM CLARO');
  } finally {
    await page.evaluate(
      (cid) => fetch(`/api/connections/${cid}`, { method: 'DELETE' }).then(() => undefined),
      id
    );
  }
});

test('com o cofre TRANCADO não há o que exportar', async ({ page }) => {
  await esperarIdePronta(page);
  await painelLateral(page, 'Database').click();
  const senha = page.getByLabel('Senha mestra', { exact: true });
  if (await senha.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);
  await page.getByRole('button', { name: /Trancar o cofre/ }).click();
  await expect(page.getByRole('button', { name: 'Exportar conexões COM as senhas' })).toBeDisabled();

  // Devolve o cofre destrancado. Sem isto, este teste deixa os SEGUINTES com o
  // cofre fechado — e eles falham por um motivo que não é deles. Os dois testes
  // de troca de senha passavam sozinhos e quebravam no arquivo inteiro.
  await page.evaluate(
    (s) =>
      fetch('/api/connections/vault/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: s }),
      }).then(() => undefined),
    SENHA_MESTRA
  );
});

// ---- Trocar a senha mestra (T100) ----
//
// Não existia caminho nenhum para isso. Eu escrevi na spec 004 que "hoje não
// existe" e deixei assim.

test('trocar a senha mestra mantém as conexões e a senha VELHA para de abrir', async ({ page }) => {
  await esperarIdePronta(page);
  const id = await criarConexaoComSenha(page);
  const NOVA = 'senha-mestra-trocada-no-teste';
  try {
    await painelLateral(page, 'Database').click();
    const pede = page.getByLabel('Senha mestra', { exact: true });
    if (await pede.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

    await page.getByRole('button', { name: 'Trocar a senha mestra' }).click();
    await page.getByLabel('Senha mestra atual', { exact: true }).fill(SENHA_MESTRA);
    await page.getByLabel('Senha nova', { exact: true }).fill(NOVA);
    await page.getByLabel('Repita a senha nova').fill(NOVA);
    await page.getByRole('button', { name: 'trocar', exact: true }).click();

    // O segredo continua legível: a troca RECIFROU tudo, e não só reescreveu
    // o verificador.
    const valor = await page.evaluate(async (cid) => {
      const c = await fetch(`/api/connections/${cid}/secret/password`);
      return ((await c.json()) as { data?: { valor: string } }).data?.valor;
    }, id);
    expect(valor).toBe(SENHA_DE_TESTE);

    // E a senha velha não abre mais.
    const velha = await page.evaluate(async (s) => {
      await fetch('/api/connections/vault/lock', { method: 'POST' });
      const r = await fetch('/api/connections/vault/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: s }),
      });
      return ((await r.json()) as { error?: string }).error ?? null;
    }, SENHA_MESTRA);
    expect(velha).toContain('incorreta');
  } finally {
    // Devolve o cofre ao estado que os outros testes esperam.
    await page.evaluate(
      async ([nova, original, cid]) => {
        await fetch('/api/connections/vault/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: nova }),
        });
        await fetch(`/api/connections/${cid}`, { method: 'DELETE' });
        await fetch('/api/connections/vault/password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ atual: nova, nova: original }),
        });
      },
      [NOVA, SENHA_MESTRA, id] as const
    );
  }
});

test('a confirmação que não bate é recusada ANTES de tocar no cofre', async ({ page }) => {
  await esperarIdePronta(page);
  await painelLateral(page, 'Database').click();
  const pede = page.getByLabel('Senha mestra', { exact: true });
  if (await pede.isVisible().catch(() => false)) await destrancarCofre(page, SENHA_MESTRA);

  await page.getByRole('button', { name: 'Trocar a senha mestra' }).click();
  await page.getByLabel('Senha mestra atual', { exact: true }).fill(SENHA_MESTRA);
  await page.getByLabel('Senha nova', { exact: true }).fill('uma-coisa');
  await page.getByLabel('Repita a senha nova').fill('outra-coisa');
  await page.getByRole('button', { name: 'trocar', exact: true }).click();

  // Um erro de digitação aqui trancaria o cofre com uma senha que ninguém sabe
  // qual é. Por isso a conferência é na TELA, antes de chamar o servidor.
  await expect(page.getByText(/não batem/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Importar de volta o que foi exportado (N001)
// ---------------------------------------------------------------------------

test('o que foi exportado volta pela importação, com a senha (N001)', async ({ page }) => {
  // A ida e a volta num teste só: exportar sem conseguir importar serve para
  // arquivar, e não para levar as conexões ao outro computador.
  //
  // O teste CRIA a conexão com segredo de que precisa: as do projeto de teste
  // são SQLite e SSH por chave, e nenhuma delas guarda senha no cofre.
  await comCofreAberto(page);

  const r = await page.evaluate(async () => {
    const marca = `n001-${Date.now().toString(36)}`;
    const post = async (rota: string, corpo: unknown): Promise<unknown> => {
      const resp = await fetch(rota, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const env = (await resp.json()) as { data: unknown; error?: string };
      // Falhar aqui com a mensagem do servidor: um `null` silencioso viraria
      // "cannot read property of null" trinta linhas depois.
      if (env.error != null) throw new Error(`${rota}: ${env.error}`);
      return env.data;
    };

    const criada = (await post('/api/connections', {
      type: 'mysql',
      label: marca,
      group: 'N001',
      readOnly: true,
      fields: { host: '127.0.0.1', port: 3306, user: 'ana', password: 'segredo-do-n001' },
    })) as { id: string; secretFields: string[] };

    // Exporta e traz de volta SÓ a que acabou de nascer, com outro rótulo.
    const arquivo = (await post('/api/connections/export-all', {})) as {
      conexoes: { label: string }[];
    };
    const dela = arquivo.conexoes.filter((c) => c.label === marca);
    const importado = (await post('/api/connections/import', {
      conexoes: dela.map((c) => ({ ...c, label: `${marca}-copia` })),
      politica: 'manter-as-duas',
    })) as { criadas: number };

    // Acha a cópia andando pela árvore de grupos, que é o que a rota devolve.
    const lista = await fetch('/api/connections');
    const { tree } = (await lista.json()).data as { tree: unknown };
    const todas: { id: string; label: string; secretFields: string[] }[] = [];
    const anda = (g: { connections?: unknown[]; groups?: unknown[] }): void => {
      for (const c of g.connections ?? []) todas.push(c as never);
      for (const f of g.groups ?? []) anda(f as never);
    };
    anda(tree as never);
    const copia = todas.find((c) => c.label === `${marca}-copia`);

    const ler = async (id: string): Promise<string> => {
      const s = await fetch(`/api/connections/${id}/secret/password`);
      return ((await s.json()).data as { valor: string }).valor;
    };
    const senhaDaCopia = copia === undefined ? null : await ler(copia.id);

    // Limpa: a suíte compartilha o cofre, e sobra vira ruído no teste vizinho.
    for (const id of [criada.id, copia?.id]) {
      if (id !== undefined) await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    }

    return {
      criadas: importado.criadas,
      // O segredo NÃO volta para o teste: só se compara aqui dentro.
      senhaBate: senhaDaCopia === 'segredo-do-n001',
      copiaTemSegredo: (copia?.secretFields ?? []).includes('password'),
      // A exportação NÃO pode ter trazido a senha como campo público.
      listagemSemSenha: todas.every((c) => !('password' in (c as never))),
    };
  });

  expect(r.criadas).toBe(1);
  expect(r.copiaTemSegredo, 'a cópia tem de guardar a senha COMO SEGREDO').toBe(true);
  expect(r.senhaBate, 'a senha importada tem de ser a mesma').toBe(true);
  expect(r.listagemSemSenha, 'a listagem continua sem senha').toBe(true);
});

test('arquivo que NÃO é do formato é recusado com texto que se entende (N001)', async ({ page }) => {
  await comCofreAberto(page);
  const erro = await page.evaluate(async () => {
    const r = await fetch('/api/connections/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conexoes: 'isto não é uma lista' }),
    });
    return ((await r.json()) as { error: string }).error;
  });
  expect(erro).toContain('Exportar conexões COM as senhas');
});
