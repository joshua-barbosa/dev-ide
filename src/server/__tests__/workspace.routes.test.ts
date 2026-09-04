import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { errorEnvelope } from '../http/handlers';
import { EstadoStore } from '../estado';
import { createWorkspaceRouter } from '../routes/workspace';

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

interface Retrato {
  readonly pasta: string | null;
  readonly recentes: readonly string[];
  readonly arvore: readonly { name: string }[];
  readonly truncated: boolean;
  readonly plataforma: string;
}

interface Simbolos {
  readonly simbolos: readonly { name: string }[];
}

interface Arquivo {
  readonly path: string;
  readonly label: string;
}

type Chamada = (method: string, rota: string, body?: unknown) => Promise<Envelope<unknown>>;

async function comServidor(
  fn: (call: Chamada, dados: string, projeto: string) => Promise<void>
): Promise<void> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-ws-')));
  const projeto = path.join(dir, 'projeto');
  fs.mkdirSync(projeto);
  fs.writeFileSync(path.join(projeto, 'utils.ts'), 'export const VERSAO = "1.0";\n');

  const app = express();
  app.use(express.json());
  app.use('/api', createWorkspaceRouter(new EstadoStore(path.join(dir, 'state.json')), dir));
  app.use(errorEnvelope);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  const call: Chamada = async (method, rota, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api${rota}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await r.json()) as Envelope<unknown>;
  };

  try {
    await fn(call, dir, projeto);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a rota de documentação aponta para o README da IDE', async () => {
  await comServidor(async (call, dados) => {
    fs.writeFileSync(path.join(dados, 'README.md'), '# dev-ide\n');
    const r = (await call('GET', '/docs')).data as { path: string };
    assert.equal(r.path, path.join(dados, 'README.md'));
  });
});

test('sem README, a rota diz o que faltou em vez de devolver caminho torto', async () => {
  await comServidor(async (call) => {
    const r = await call('GET', '/docs');
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /README/);
  });
});

test('a IDE começa sem pasta aberta', async () => {
  await comServidor(async (call) => {
    const r = (await call('GET', '/workspace')).data as Retrato;
    assert.equal(r.pasta, null);
    assert.deepEqual(r.arvore, []);
    assert.deepEqual(r.recentes, []);
  });
});

test('abrir uma pasta devolve a árvore, e NENHUM símbolo (D222)', async () => {
  await comServidor(async (call, _dados, projeto) => {
    const r = (await call('POST', '/workspace', { path: projeto })).data as Retrato;
    assert.equal(r.pasta, projeto);
    assert.deepEqual(r.arvore.map((n) => n.name), ['utils.ts']);
    // Os símbolos custavam 588 ms de event loop travado NUM REPOSITÓRIO
    // PEQUENO, e o retrato é pedido em toda criação, renomeação e exclusão.
    // Desenhar a árvore não pode depender de ler o projeto inteiro.
    assert.equal(
      'simbolos' in r, false,
      'o retrato não carrega mais símbolos — eles têm rota própria'
    );
  });
});

test('o retrato diz a PLATAFORMA — a interface separa caminho por `\\` no Windows (D223)', async () => {
  await comServidor(async (call) => {
    const r = (await call('GET', '/workspace')).data as Retrato;
    assert.ok(['win32', 'darwin', 'linux'].includes(r.plataforma), r.plataforma);
  });
});

test('os símbolos do projeto têm rota própria, pedida só quando a aba abre', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const s = (await call('GET', '/workspace/symbols')).data as Simbolos;
    assert.ok(s.simbolos.some((x) => x.name === 'VERSAO'));
  });
});

test('sem pasta aberta, a rota de símbolos devolve vazio em vez de erro', async () => {
  await comServidor(async (call) => {
    const s = (await call('GET', '/workspace/symbols')).data as Simbolos;
    assert.deepEqual(s.simbolos, []);
  });
});

test('os símbolos de UM arquivo — é o que a trilha do editor precisa', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const alvo = path.join(projeto, 'utils.ts');
    const s = (await call('GET', `/symbols?path=${encodeURIComponent(alvo)}`)).data as Simbolos;
    assert.deepEqual(s.simbolos.map((x) => x.name), ['VERSAO']);
  });
});

test('símbolos de arquivo fora das raízes abertas são recusados', async () => {
  await comServidor(async (call, dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const fora = path.join(dados, 'state.json');
    const r = await call('GET', `/symbols?path=${encodeURIComponent(fora)}`);
    assert.equal(r.success, false);
  });
});

test('a pasta aberta sobrevive a uma nova leitura — é o que reabre a IDE onde estava', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    assert.equal(((await call('GET', '/workspace')).data as Retrato).pasta, projeto);
  });
});

test('abrir pasta inexistente é recusado e não entra no histórico', async () => {
  await comServidor(async (call, dados) => {
    const r = await call('POST', '/workspace', { path: path.join(dados, 'nao-existe') });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /não encontrada/);

    const depois = (await call('GET', '/workspace')).data as Retrato;
    assert.deepEqual(depois.recentes, []);
  });
});

test('pasta que sumiu desde a última sessão é esquecida, não insistida', async () => {
  await comServidor(async (call, dados) => {
    const temporaria = path.join(dados, 'some-depois');
    fs.mkdirSync(temporaria);
    await call('POST', '/workspace', { path: temporaria });
    fs.rmSync(temporaria, { recursive: true });

    const r = (await call('GET', '/workspace')).data as Retrato;
    assert.equal(r.pasta, null);
    assert.equal(r.recentes.includes(temporaria), false, 'sai do histórico junto');
  });
});

test('fechar solta a pasta e preserva o histórico', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = (await call('DELETE', '/workspace')).data as Retrato;
    assert.equal(r.pasta, null);
    assert.deepEqual(r.recentes, [projeto]);
  });
});

test('esquecer tira do histórico', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = (await call('DELETE', '/workspace/recent', { path: projeto })).data as Retrato;
    assert.deepEqual(r.recentes, []);
  });
});

// ---- navegador ----

test('o navegador lista subpastas e o pai', async () => {
  await comServidor(async (call, dados) => {
    const r = (await call('GET', `/folders?path=${encodeURIComponent(dados)}`)).data as {
      path: string; parent: string | null; dirs: { name: string }[];
    };
    assert.equal(r.path, dados);
    assert.equal(r.parent, path.dirname(dados));
    assert.deepEqual(r.dirs.map((d) => d.name), ['projeto']);
  });
});

test('sem caminho, o navegador começa na pasta pessoal', async () => {
  await comServidor(async (call) => {
    const r = (await call('GET', '/folders')).data as { path: string };
    assert.equal(r.path, path.resolve(os.homedir()));
  });
});

// ---- criar arquivo ----

test('criar arquivo sem pasta aberta é recusado com instrução', async () => {
  await comServidor(async (call) => {
    const r = await call('POST', '/workspace/file', { name: 'a.ts', content: '' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /Abra uma pasta/);
  });
});

test('criar arquivo grava dentro da pasta aberta', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = await call('POST', '/workspace/file', { name: 'sub/novo.ts', content: 'const a = 1;' });
    const criado = (r.data as { path: string }).path;
    assert.equal(criado, path.join(projeto, 'sub', 'novo.ts'));
    assert.equal(fs.readFileSync(criado, 'utf8'), 'const a = 1;');
  });
});

test('criar arquivo que escapa da pasta é recusado', async () => {
  await comServidor(async (call, dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = await call('POST', '/workspace/file', { name: '../fora.ts', content: 'x' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /dentro da pasta/);
    assert.equal(fs.existsSync(path.join(dados, 'fora.ts')), false);
  });
});

test('criar arquivo que já existe é recusado sem sobrescrever', async () => {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = await call('POST', '/workspace/file', { name: 'utils.ts', content: 'apagado!' });
    assert.equal(r.success, false);
    assert.match(fs.readFileSync(path.join(projeto, 'utils.ts'), 'utf8'), /VERSAO/);
  });
});

// ---------------------------------------------------------------------------
// Renomear, duplicar e excluir (T043, spec 073)
// ---------------------------------------------------------------------------
//
// As três guardas que cada uma repete, e por quê:
//   1. **dentro da pasta aberta** — sem isso a árvore vira um `rm` do disco
//      inteiro por uma URL;
//   2. **não sobrescreve** — renomear por cima de um arquivo existente perde o
//      que estava lá, e em silêncio;
//   3. **o que não existe dá erro** — mexer no nada é sempre engano de quem
//      chamou, e responder "ok" esconderia o engano.

async function comPastaAberta(
  fn: (call: Chamada, projeto: string) => Promise<void>
): Promise<void> {
  await comServidor(async (call, _dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    await fn(call, projeto);
  });
}

test('renomear troca o nome e devolve o caminho novo', async () => {
  await comPastaAberta(async (call, projeto) => {
    const r = await call('POST', '/workspace/rename', { path: 'utils.ts', name: 'ferramentas.ts' });
    assert.equal(r.success, true);
    assert.equal((r.data as { path: string }).path, path.join(projeto, 'ferramentas.ts'));
    assert.equal(fs.existsSync(path.join(projeto, 'utils.ts')), false);
    assert.match(fs.readFileSync(path.join(projeto, 'ferramentas.ts'), 'utf8'), /VERSAO/);
  });
});

test('renomear aceita mover para outra pasta de dentro do projeto', async () => {
  await comPastaAberta(async (call, projeto) => {
    fs.mkdirSync(path.join(projeto, 'src'));
    const r = await call('POST', '/workspace/rename', { path: 'utils.ts', name: 'src/utils.ts' });
    assert.equal(r.success, true);
    assert.equal(fs.existsSync(path.join(projeto, 'src', 'utils.ts')), true);
  });
});

test('renomear por cima de arquivo existente é recusado', async () => {
  await comPastaAberta(async (call, projeto) => {
    fs.writeFileSync(path.join(projeto, 'outro.ts'), 'nao me apague\n');
    const r = await call('POST', '/workspace/rename', { path: 'utils.ts', name: 'outro.ts' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /já existe/);
    assert.equal(fs.readFileSync(path.join(projeto, 'outro.ts'), 'utf8'), 'nao me apague\n');
  });
});

test('renomear para fora da pasta aberta é recusado', async () => {
  await comPastaAberta(async (call, projeto) => {
    const r = await call('POST', '/workspace/rename', { path: 'utils.ts', name: '../fugiu.ts' });
    assert.equal(r.success, false);
    assert.equal(fs.existsSync(path.join(projeto, 'utils.ts')), true);
  });
});

test('renomear o que não existe diz que não existe', async () => {
  await comPastaAberta(async (call) => {
    const r = await call('POST', '/workspace/rename', { path: 'fantasma.ts', name: 'x.ts' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /não existe/);
  });
});

test('renomear só a caixa do nome funciona', async () => {
  // `Utils.ts` sobre `utils.ts`: num sistema que diferencia maiúsculas é
  // renomear de verdade, e recusar por "já existe" seria recusar o próprio.
  await comPastaAberta(async (call, projeto) => {
    const r = await call('POST', '/workspace/rename', { path: 'utils.ts', name: 'Utils.ts' });
    assert.equal(r.success, true);
    assert.equal(fs.existsSync(path.join(projeto, 'Utils.ts')), true);
  });
});

test('duplicar cria uma cópia com sufixo, sem tocar no original', async () => {
  await comPastaAberta(async (call, projeto) => {
    const r = await call('POST', '/workspace/duplicate', { path: 'utils.ts' });
    assert.equal(r.success, true);
    assert.equal((r.data as { path: string }).path, path.join(projeto, 'utils copy.ts'));
    assert.match(fs.readFileSync(path.join(projeto, 'utils copy.ts'), 'utf8'), /VERSAO/);
    assert.equal(fs.existsSync(path.join(projeto, 'utils.ts')), true);
  });
});

test('duplicar duas vezes numera a partir da segunda', async () => {
  await comPastaAberta(async (call, projeto) => {
    await call('POST', '/workspace/duplicate', { path: 'utils.ts' });
    const r = await call('POST', '/workspace/duplicate', { path: 'utils.ts' });
    assert.equal((r.data as { path: string }).path, path.join(projeto, 'utils copy 2.ts'));
  });
});

test('duplicar uma PASTA leva o conteúdo junto', async () => {
  await comPastaAberta(async (call, projeto) => {
    fs.mkdirSync(path.join(projeto, 'src', 'dentro'), { recursive: true });
    fs.writeFileSync(path.join(projeto, 'src', 'dentro', 'a.ts'), 'oi\n');
    const r = await call('POST', '/workspace/duplicate', { path: 'src' });
    assert.equal(r.success, true);
    assert.equal(
      fs.readFileSync(path.join(projeto, 'src copy', 'dentro', 'a.ts'), 'utf8'),
      'oi\n'
    );
  });
});

test('excluir apaga o arquivo', async () => {
  await comPastaAberta(async (call, projeto) => {
    const r = await call('DELETE', '/workspace/entry', { path: 'utils.ts' });
    assert.equal(r.success, true);
    assert.equal(fs.existsSync(path.join(projeto, 'utils.ts')), false);
  });
});

test('excluir uma pasta leva o que há dentro', async () => {
  await comPastaAberta(async (call, projeto) => {
    fs.mkdirSync(path.join(projeto, 'lixo'));
    fs.writeFileSync(path.join(projeto, 'lixo', 'a.ts'), 'x\n');
    const r = await call('DELETE', '/workspace/entry', { path: 'lixo' });
    assert.equal(r.success, true);
    assert.equal(fs.existsSync(path.join(projeto, 'lixo')), false);
  });
});

test('excluir a própria pasta aberta é recusado', async () => {
  // Sem isto o botão direito na raiz apagaria o projeto e deixaria a IDE
  // apontando para o nada.
  await comPastaAberta(async (call, projeto) => {
    const r = await call('DELETE', '/workspace/entry', { path: '.' });
    assert.equal(r.success, false);
    assert.equal(fs.existsSync(projeto), true);
  });
});

test('excluir fora da pasta aberta é recusado', async () => {
  await comPastaAberta(async (call, _projeto) => {
    const r = await call('DELETE', '/workspace/entry', { path: '../projeto' });
    assert.equal(r.success, false);
  });
});

test('excluir o que não existe diz que não existe', async () => {
  await comPastaAberta(async (call) => {
    const r = await call('DELETE', '/workspace/entry', { path: 'fantasma.ts' });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /não existe/);
  });
});

test('criar arquivo DENTRO de uma pasta escolhida (T045)', async () => {
  await comPastaAberta(async (call, projeto) => {
    fs.mkdirSync(path.join(projeto, 'src'));
    const r = await call('POST', '/workspace/file', { name: 'src/novo.ts', content: '' });
    assert.equal(r.success, true);
    assert.equal((r.data as { path: string }).path, path.join(projeto, 'src', 'novo.ts'));
  });
});

// ---------------------------------------------------------------------------
// A lista de arquivos do `Ctrl+P` (T051, spec 073)
// ---------------------------------------------------------------------------

test('a lista de arquivos traz o caminho e o rótulo', async () => {
  await comPastaAberta(async (call, projeto) => {
    fs.mkdirSync(path.join(projeto, 'src'));
    fs.writeFileSync(path.join(projeto, 'src', 'a.ts'), 'x\n');
    const r = (await call('GET', '/workspace/files')).data as { files: Arquivo[] };
    // Com UMA raiz o rótulo é o relativo puro: pôr o nome da pasta em toda
    // linha seria o mesmo prefixo repetido, ocupando espaço e não informando.
    assert.deepEqual([...r.files].map((f) => f.label).sort(), ['src/a.ts', 'utils.ts']);
    assert.deepEqual(
      [...r.files].map((f) => f.path).sort(),
      [path.join(projeto, 'src', 'a.ts'), path.join(projeto, 'utils.ts')].sort()
    );
  });
});

test('a lista respeita o .gitignore', async () => {
  // Ninguém abre `node_modules/.../index.js` pelo Ctrl+P, e ter mil deles na
  // lista empurraria para baixo o arquivo que se procura.
  await comPastaAberta(async (call, projeto) => {
    fs.mkdirSync(path.join(projeto, 'node_modules'));
    fs.writeFileSync(path.join(projeto, 'node_modules', 'dep.js'), 'x\n');
    fs.writeFileSync(path.join(projeto, '.gitignore'), 'segredo.txt\n');
    fs.writeFileSync(path.join(projeto, 'segredo.txt'), 'x\n');

    const r = (await call('GET', '/workspace/files')).data as { files: Arquivo[] };
    assert.ok(!r.files.some((f) => f.label.startsWith('node_modules')));
    assert.ok(!r.files.some((f) => f.label === 'segredo.txt'));
  });
});

test('sem pasta aberta a lista vem vazia, e não com erro', async () => {
  // O `Ctrl+P` pode ser apertado antes de abrir pasta; erro ali seria ruído.
  await comServidor(async (call) => {
    const r = await call('GET', '/workspace/files');
    assert.equal(r.success, true);
    assert.deepEqual((r.data as { files: Arquivo[] }).files, []);
  });
});

// ---------------------------------------------------------------------------
// Mais de uma raiz (T004, spec 073)
// ---------------------------------------------------------------------------

interface Raiz {
  readonly pasta: string;
  readonly nome: string;
  readonly arvore: readonly { name: string }[];
}

/** Um segundo projeto ao lado do primeiro, com um arquivo dentro. */
function segundoProjeto(dados: string, nome = 'outro'): string {
  const dir = path.join(dados, nome);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'segundo.ts'), 'export const B = 2;\n');
  return dir;
}

test('acrescentar soma uma raiz sem tirar a primeira', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    await call('POST', '/workspace', { path: projeto });
    const r = (await call('POST', '/workspace/add', { path: outro })).data as {
      raizes: Raiz[]; pasta: string;
    };

    assert.deepEqual(r.raizes.map((x) => x.pasta), [projeto, outro]);
    assert.deepEqual(r.raizes.map((x) => x.nome), ['projeto', 'outro']);
    // O campo antigo continua valendo a PRIMEIRA: quem só sabe lidar com uma
    // pasta — o `cwd` do terminal, por exemplo — não precisa saber das outras.
    assert.equal(r.pasta, projeto);
  });
});

test('cada raiz traz a árvore dela', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    await call('POST', '/workspace', { path: projeto });
    const r = (await call('POST', '/workspace/add', { path: outro })).data as { raizes: Raiz[] };

    assert.ok(r.raizes[0]?.arvore.some((n) => n.name === 'utils.ts'));
    assert.ok(r.raizes[1]?.arvore.some((n) => n.name === 'segundo.ts'));
  });
});

test('abrir SUBSTITUI as raízes — é trocar de projeto', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    await call('POST', '/workspace', { path: projeto });
    await call('POST', '/workspace/add', { path: outro });

    const r = (await call('POST', '/workspace', { path: outro })).data as { raizes: Raiz[] };
    assert.deepEqual(r.raizes.map((x) => x.pasta), [outro]);
  });
});

test('remover tira UMA raiz e deixa as outras', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    await call('POST', '/workspace', { path: projeto });
    await call('POST', '/workspace/add', { path: outro });

    const r = (await call('DELETE', '/workspace/folder', { path: projeto })).data as {
      raizes: Raiz[];
    };
    assert.deepEqual(r.raizes.map((x) => x.pasta), [outro]);
  });
});

test('acrescentar pasta que não existe é recusado', async () => {
  await comServidor(async (call, dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = await call('POST', '/workspace/add', { path: path.join(dados, 'fantasma') });
    assert.equal(r.success, false);
  });
});

test('a mesma pasta acrescentada duas vezes entra uma vez só', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    await call('POST', '/workspace', { path: projeto });
    await call('POST', '/workspace/add', { path: outro });
    const r = (await call('POST', '/workspace/add', { path: outro })).data as { raizes: Raiz[] };
    assert.equal(r.raizes.length, 2);
  });
});

test('o Ctrl+P cobre TODAS as raízes, com o nome de cada uma no rótulo', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    await call('POST', '/workspace', { path: projeto });
    await call('POST', '/workspace/add', { path: outro });

    const r = (await call('GET', '/workspace/files')).data as { files: Arquivo[] };
    const rotulos = r.files.map((f) => f.label).sort();
    // Com DUAS raízes o nome entra: dois `index.ts` de projetos diferentes
    // seriam a mesma linha sem ele.
    assert.deepEqual(rotulos, ['outro/segundo.ts', 'projeto/utils.ts']);
  });
});

test('a árvore expande pasta de QUALQUER raiz', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    fs.mkdirSync(path.join(outro, 'dentro'));
    fs.writeFileSync(path.join(outro, 'dentro', 'fundo.ts'), 'x\n');
    await call('POST', '/workspace', { path: projeto });
    await call('POST', '/workspace/add', { path: outro });

    const r = await call('GET', `/files/children?path=${encodeURIComponent(path.join(outro, 'dentro'))}`);
    assert.equal(r.success, true);
    assert.ok((r.data as { nodes: { name: string }[] }).nodes.some((n) => n.name === 'fundo.ts'));
  });
});

test('a árvore continua recusando caminho de FORA de todas as raízes', async () => {
  await comServidor(async (call, dados, projeto) => {
    await call('POST', '/workspace', { path: projeto });
    const r = await call('GET', `/files/children?path=${encodeURIComponent(dados)}`);
    assert.equal(r.success, false);
  });
});

test('criar com o nome da raiz na frente cai NA raiz certa', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    await call('POST', '/workspace', { path: projeto });
    await call('POST', '/workspace/add', { path: outro });

    const r = (await call('POST', '/workspace/file', { name: 'outro/novo.ts', content: '' }))
      .data as { path: string };
    assert.equal(r.path, path.join(outro, 'novo.ts'));
  });
});

test('raiz que sumiu do disco não impede as outras de abrirem', async () => {
  await comServidor(async (call, dados, projeto) => {
    const outro = segundoProjeto(dados);
    await call('POST', '/workspace', { path: projeto });
    await call('POST', '/workspace/add', { path: outro });
    fs.rmSync(outro, { recursive: true, force: true });

    const r = (await call('GET', '/workspace')).data as { raizes: Raiz[] };
    assert.deepEqual(r.raizes.map((x) => x.pasta), [projeto]);
  });
});
