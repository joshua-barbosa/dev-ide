// Confere, uma por uma, se as mensagens da webview são MESMO atendidas.
//
// Ele perguntou: *"verifique se todas as rotas realmente estão funcionando"*.
// Não dá para dirigir o VS Code daqui — mas dá para rodar o CÓDIGO DO HOST em
// Node puro, com um `vscode` de mentira, contra um motor de verdade. É onde os
// defeitos da spec 103 moravam, e nenhum teste os alcançava: alcançar exigia
// abrir o editor.
//
// Sobe o próprio motor, com cofre e SQLite descartáveis. Não encosta em nada
// do usuário.
//
//   npm run conferir:extensao
import Module from 'node:module';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const PORTA_MOTOR = 4479;
const PORTA_ECO = 4489;
const SENHA = 'senha-de-teste-1234';

const require_ = createRequire(`${RAIZ}/package.json`);
const original = Module._resolveFilename;
Module._resolveFilename = function (p, ...r) {
  return p === 'vscode'
    ? require_.resolve(path.join(import.meta.dirname, 'vscode-de-mentira.cjs'))
    : original.call(this, p, ...r);
};

const linhas = [];
const marcar = (nome, ok, extra = '') =>
  linhas.push(`${ok ? '  ok  ' : 'FALHA '} ${nome.padEnd(40)} ${extra}`);

const esperarPorta = async (porta, rota = '/api/workspace') => {
  for (let i = 0; i < 120; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${porta}${rota}`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
};

const pasta = await mkdtemp(path.join(tmpdir(), 'braytech-conferir-'));
const filhos = [];
const encerrar = async () => {
  for (const p of filhos) p.kill('SIGTERM');
  await rm(pasta, { recursive: true, force: true });
};

try {
  // ---- o motor de teste, com dado inventado ----
  const banco = path.join(pasta, 'acme.db');
  const db = new DatabaseSync(banco);
  db.exec(
    `CREATE TABLE materias(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, carga INTEGER, obs TEXT);
     INSERT INTO materias(nome, carga, obs)
     VALUES ('Redação', 4, NULL), ('Álgebra', 6, 'turma piloto'), ('História', 3, NULL);
     -- Mais tabelas para o FILTRO ter o que descartar: com uma só, filtrar e
     -- não filtrar dão o mesmo número, e a verificação não prova nada.
     CREATE TABLE turmas(id INTEGER PRIMARY KEY, nome TEXT);
     CREATE TABLE salas(id INTEGER PRIMARY KEY, andar INTEGER);`
  );
  db.close();

  filhos.push(
    spawn(process.execPath, [`${RAIZ}/dist/server/index.js`], {
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(PORTA_MOTOR),
        // **`DEV_IDE_HOME` move o estado INTEIRO.** Sem ele o motor de teste
        // grava as queries em `~/.dev-ide` — a pasta de verdade dele. Foi o que
        // aconteceu na primeira execução da verificação 8: um `.sqlbook` de
        // teste apareceu no diretório real. Nunca mais.
        DEV_IDE_HOME: path.join(pasta, 'casa'),
        DEV_IDE_VAULT: path.join(pasta, 'vault.json'),
        DEV_IDE_SESSION: path.join(pasta, 'sessao.json'),
      },
    })
  );
  if (!(await esperarPorta(PORTA_MOTOR))) throw new Error('o motor de teste não subiu');

  const api = async (rota, corpo) =>
    (await fetch(`http://127.0.0.1:${PORTA_MOTOR}${rota}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      ...(corpo === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }),
    }).then((r) => r.json())).data;

  await api('/api/connections/vault', { password: SENHA });
  const conexao = await api('/api/connections', {
    type: 'sqlite', label: 'ACME local', group: 'ACME/Bancos', readOnly: false,
    fields: { file: banco },
  });

  // ---- o eco binário: prova a SUBIDA, que o SQLite não exercita ----
  filhos.push(
    spawn(process.execPath, [path.join(import.meta.dirname, 'eco-binario.mjs'), String(PORTA_ECO)], {
      stdio: 'ignore',
    })
  );
  if (!(await esperarPorta(PORTA_ECO, '/api/connections/drivers'))) {
    throw new Error('o eco binário não subiu');
  }

  const { PonteDoHost } = require_(`${RAIZ}/extensao/dist/ponteDoHost.js`);
  const { ligarMotor } = require_(`${RAIZ}/extensao/dist/motor.js`);

  /** Uma ponte ligada a um motor, com uma webview de mentira. */
  const montar = async (porta) => {
    const motor = await ligarMotor(porta, '');
    const respostas = [];
    const web = {
      onDidReceiveMessage(fn) { this._fn = fn; },
      postMessage(m) { respostas.push(m); return Promise.resolve(true); },
    };
    const deps = {
      motor, extensionUri: { fsPath: `${RAIZ}/extensao` },
      definirConexaoAtiva() {}, abrirQuery: async () => {}, abrirAbaDaIde() {},
      abrirFormulario() {}, abrirDialogo() {}, abrirDiagrama() {},
      recarregarPaineis() {}, abrirTerminal() {},
    };
    new PonteDoHost(deps, () => {}).ligar(web);

    let proximo = 1;
    return async (msg, esperaResposta = true) => {
      const id = proximo++;
      const antes = respostas.length;
      web._fn({ ...msg, ...(esperaResposta ? { id } : {}) });
      if (!esperaResposta) {
        await new Promise((r) => setTimeout(r, 120));
        return null;
      }
      for (let i = 0; i < 200; i += 1) {
        const achada = respostas.slice(antes).find((r) => r.id === id);
        if (achada !== undefined) return achada;
        await new Promise((r) => setTimeout(r, 50));
      }
      return { ok: false, erro: 'sem resposta em 10s' };
    };
  };

  const mandar = await montar(PORTA_MOTOR);
  const id = conexao.id;

  // ---- 1. as rotas de DADO ----
  for (const [nome, msg, medir] of [
    ['GET /connections', { metodo: 'GET', rota: '/api/connections' }],
    ['POST /connect', { metodo: 'POST', rota: `/api/connections/${id}/connect` }],
    ['GET /children', { metodo: 'GET', rota: `/api/connections/${id}/children` }, (d) => `${d.length} nós`],
    ['POST /execute', {
      metodo: 'POST', rota: `/api/connections/${id}/execute`,
      corpo: { statement: 'SELECT id, nome, obs FROM materias', database: 'main', rowLimit: 500 },
    }, (d) => `${d.rows.length} linhas`],
    ['GET /codebase', { metodo: 'GET', rota: `/api/connections/${id}/codebase?database=main` }],
    ['GET /prefs', { metodo: 'GET', rota: '/api/prefs' }],
    ['GET /workspace', { metodo: 'GET', rota: '/api/workspace' }],
  ]) {
    const r = await mandar({ tipo: 'api', ...msg });
    marcar(`api ${nome}`, r.ok === true, r.ok ? (medir?.(r.data) ?? '') : r.erro);
  }

  // ---- 2. a rota BINÁRIA de leitura ----
  const arquivo = path.join(pasta, 'enviado.txt');
  await writeFile(arquivo, 'bytes de teste\n');
  const cru = await mandar({
    tipo: 'apiBytes', metodo: 'GET', rota: `/api/file/raw?path=${encodeURIComponent(arquivo)}`,
  });
  marcar('apiBytes GET /file/raw', cru.ok === true, cru.ok ? `${Buffer.from(cru.data, 'base64').length} bytes` : cru.erro);
  marcar(
    'os bytes voltaram intactos',
    cru.ok && Buffer.from(cru.data, 'base64').toString('utf8') === 'bytes de teste\n'
  );

  // ---- 3. as chamadas ao host ----
  global.__RESPOSTAS = { showInputBox: 'nome-digitado' };
  for (const [nome, acao, args] of [
    ['pedirTexto', 'pedirTexto', { titulo: 't' }],
    ['pedirSenha', 'pedirSenha', { titulo: 't' }],
    ['escreverNaSaida', 'escreverNaSaida', { texto: 'oi', erro: false }],
    ['mostrarSaida', 'mostrarSaida', {}],
  ]) {
    const r = await mandar({ tipo: 'hostChamada', acao, args });
    marcar(`host ${nome}`, r.ok === true, r.ok ? '' : r.erro);
  }

  global.__RESPOSTAS = { showQuickPick: { valor: 'sim', rotulo: 'Sim' } };
  const escolha = await mandar({
    tipo: 'hostChamada', acao: 'escolher',
    args: { titulo: 't', opcoes: [{ valor: 'sim', rotulo: 'Sim' }] },
  });
  marcar('host escolher', escolha.ok === true, escolha.ok ? String(escolha.data) : escolha.erro);

  const salvo = path.join(pasta, 'salvo.txt');
  global.__RESPOSTAS = { showSaveDialog: { fsPath: salvo, path: salvo, scheme: 'file' } };
  const sv = await mandar({
    tipo: 'hostChamada', acao: 'salvarArquivo',
    args: { nome: 'salvo.txt', carga: Buffer.from('conteúdo salvo\n').toString('base64') },
  });
  marcar('host salvarArquivo', sv.ok === true, sv.ok ? '' : sv.erro);
  marcar('o arquivo salvo bate', sv.ok && (await readFile(salvo, 'utf8')) === 'conteúdo salvo\n');

  global.__RESPOSTAS = { showOpenDialog: [{ fsPath: arquivo, path: arquivo, scheme: 'file' }] };
  const um = await mandar({ tipo: 'hostChamada', acao: 'escolherArquivo', args: { extensoes: ['txt'] } });
  marcar('host escolherArquivo', um.ok && um.data?.nome === 'enviado.txt', um.ok ? um.data?.nome : um.erro);
  const varios = await mandar({
    tipo: 'hostChamada', acao: 'escolherArquivo', args: { extensoes: [], varios: true },
  });
  marcar('host escolherArquivo (vários)', varios.ok && Array.isArray(varios.data),
    varios.ok ? JSON.stringify(varios.data?.map?.((a) => a.nome)) : varios.erro);

  const inventada = await mandar({ tipo: 'hostChamada', acao: 'inventada', args: {} });
  marcar('ação desconhecida é RECUSADA', inventada.ok === false, String(inventada.erro));

  // ---- 4. os pedidos sem resposta: nenhum pode virar erro na tela ----
  for (const [nome, msg] of [
    ['abrirTabela', { tipo: 'abrirTabela', connectionId: id, nodePath: ['main', 'materias'], titulo: 'materias', database: 'main', somenteLeitura: false }],
    ['abrirServidor', { tipo: 'abrirServidor', connectionId: id, rotulo: 'ACME', somenteLeitura: false }],
    ['abrirProcessos', { tipo: 'abrirProcessos', connectionId: id, rotulo: 'ACME', somenteLeitura: false }],
    ['abrirChave', { tipo: 'abrirChave', connectionId: id, chave: 'k', somenteLeitura: false }],
    ['abrirTerminal', { tipo: 'abrirTerminal', connectionId: id, rotulo: 'ACME' }],
    ['abrirDiagrama', { tipo: 'abrirDiagrama', titulo: 'd', markdown: '# d' }],
    ['abrirFormulario', { tipo: 'abrirFormulario', conexaoId: id, grupo: '', rotulo: 'x' }],
    ['abrirQuery', { tipo: 'abrirQuery', connectionId: id, database: 'main', titulo: 'q.sql', conteudo: 'SELECT 1' }],
    ['abrirSemTitulo', { tipo: 'abrirSemTitulo', conteudo: 'x', linguagem: 'sql' }],
    ['conexoesMudaram', { tipo: 'conexoesMudaram' }],
    ['avisar', { tipo: 'avisar', mensagem: 'oi' }],
    ['copiar', { tipo: 'copiar', texto: 'copiado' }],
  ]) {
    global.__CHAMADAS.length = 0;
    await mandar(msg, false);
    const erros = global.__CHAMADAS.filter((c) => c.o === 'erro').map((c) => c.m);
    marcar(nome, erros.length === 0,
      erros.join(' | ') || global.__CHAMADAS.map((c) => c.o).join(', ') || '(só repassa)');
  }

  // ---- 5. a SUBIDA binária, contra o eco ----
  const mandarAoEco = await montar(PORTA_ECO);
  const carga = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0a, 0x7b]);
  const ida = await mandarAoEco({
    tipo: 'apiBytes', metodo: 'POST', rota: '/api/x/files/upload', carga: carga.toString('base64'),
  });
  marcar('POST binário volta intacto',
    ida.ok && Buffer.from(ida.data, 'base64').equals(carga),
    ida.ok ? Buffer.from(ida.data, 'base64').toString('hex') : ida.erro);

  const grande = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < grande.length; i += 1) grande[i] = i % 256;
  const g = await mandarAoEco({
    tipo: 'apiBytes', metodo: 'POST', rota: '/api/x/files/upload', carga: grande.toString('base64'),
  });
  marcar('3 MB atravessam sem corromper',
    g.ok && Buffer.from(g.data, 'base64').equals(grande), g.ok ? `${grande.length} bytes` : g.erro);

  const sucessoJson = await mandarAoEco({
    tipo: 'apiBytes', metodo: 'POST', rota: '/api/x/files/upload?sucessoJson=1',
    carga: carga.toString('base64'),
  });
  marcar('sucesso em JSON NÃO vira erro', sucessoJson.ok === true, sucessoJson.ok ? '' : sucessoJson.erro);

  const recusa = await mandarAoEco({ tipo: 'apiBytes', metodo: 'GET', rota: '/api/x/files/bytes?erro=1' });
  marcar('erro do motor chega com a mensagem',
    recusa.ok === false && String(recusa.erro).includes('o motor recusou'), String(recusa.erro));
  // ---- 6. a ÁRVORE NATIVA (spec 104) ----
  //
  // Aqui está o buraco que a webview deixava: a lateral nunca foi exercitada
  // fora do editor. Agora ela é código que roda em Node puro, e um `TreeItem`
  // errado FALHA aqui em vez de aparecer torto na tela dele.
  const { ArvoreDeConexoes, definirRecursos } = require_(`${RAIZ}/extensao/dist/arvore.js`);
  const { codiconDe } = require_(`${RAIZ}/extensao/dist/icones-do-editor.js`);
  const { ACOES_DO_MENU } = require_(`${RAIZ}/extensao/dist/acoesDoMenu.js`);
  const vsc = require_(path.join(import.meta.dirname, 'vscode-de-mentira.cjs'));

  definirRecursos(vsc.Uri.file(`${RAIZ}/extensao/recursos`));
  const motorDaArvore = await ligarMotor(PORTA_MOTOR, '');
  const arvore = new ArvoreDeConexoes(motorDaArvore, 'database');

  const raizes = await arvore.getChildren(undefined);
  marcar('a árvore abre no grupo do cofre',
    raizes.length === 1 && raizes[0].especie === 'grupo' && raizes[0].label === 'ACME',
    raizes.map((r) => `${r.especie}:${r.label}`).join(', '));

  // O grupo é `ACME/Bancos`: a conexão está um nível abaixo, e descer é o que
  // prova que grupo ANINHADO desenha. (Eu tinha suposto um nível só, e o arnês
  // pegou — que é para isso que ele existe.)
  const primeiraConexao = async (itens, fundo = 0) => {
    const direta = itens.find((i) => i.especie === 'conexao');
    if (direta !== undefined) return direta;
    if (fundo >= 4) return null;
    for (const grupo of itens.filter((i) => i.especie === 'grupo')) {
      const achada = await primeiraConexao(await arvore.getChildren(grupo), fundo + 1);
      if (achada !== null) return achada;
    }
    return null;
  };
  const aConexao = await primeiraConexao(raizes);
  marcar('a conexão aparece no grupo ANINHADO',
    aConexao !== null && aConexao.conexao === conexao.id,
    aConexao === null ? 'nenhuma' : String(aConexao.label));

  // O ícone da conexão vem do DRIVER: `devicon:sqlite`, que temos em SVG.
  marcar('a conexão usa o SVG de marca do driver',
    aConexao?.iconPath?.dark !== undefined &&
      String(aConexao.iconPath.dark).includes('devicon-sqlite-dark.svg'),
    String(aConexao?.iconPath?.dark ?? aConexao?.iconPath?.id));

  const dentroDaConexao = aConexao === null ? [] : await arvore.getChildren(aConexao);
  marcar('abrir a conexão lista os filhos do driver', dentroDaConexao.length > 0,
    `${dentroDaConexao.length} nó(s)`);

  // Desce até achar a tabela inventada, para conferir ícone, ação e comando.
  const achar = async (itens, alvoLabel, fundo = 0) => {
    for (const item of itens) {
      if (item.label === alvoLabel) return item;
      if (fundo >= 3 || item.collapsibleState === 0) continue;
      const achado = await achar(await arvore.getChildren(item), alvoLabel, fundo + 1);
      if (achado !== null) return achado;
    }
    return null;
  };
  const materias = await achar(dentroDaConexao, 'materias');
  marcar('a tabela inventada é achada na árvore', materias !== null,
    materias === null ? 'não achei' : materias.nodePath.join('/'));

  if (materias !== null) {
    marcar('o ícone do nó é ThemeIcon, e segue o tema DELE',
      materias.iconPath?.id === codiconDe('table'), String(materias.iconPath?.id));
    marcar('clicar na tabela abre a grade da IDE',
      materias.command?.command === 'braytech.abrirNo', String(materias.command?.command));

    // **O guarda contra a lista envelhecer.** Toda ação que o driver declara
    // tem de ter item de menu; sem isto ela some da tela sem avisar.
    const declaradas = materias.acoes.map((a) => a.id);
    const semItem = declaradas.filter((id) => !ACOES_DO_MENU.some((a) => a.id === id));
    marcar('toda ação declarada tem item de menu', semItem.length === 0,
      semItem.length === 0 ? declaradas.join(', ') : `sem item: ${semItem.join(', ')}`);

    const contexto = materias.contextValue ?? '';
    marcar('o contextValue carrega as ações, com colchetes',
      declaradas.every((id) => contexto.includes(`[${id}]`)), contexto);
    // `drop` não pode casar em `drop-view`: era o menu com dois "Apagar".
    marcar('`[drop]` não casa com `[drop-view]`',
      !/\[drop\]/.test('braytech.no[drop-view]'), 'delimitado');
  }

  // Soltura: o alvo tem de ser uma PASTA remota, e o SQLite não tem nenhuma.
  const semPasta = await arvore.handleDrop(materias, { get: () => undefined }, {});
  const ultimoAviso = [...global.__CHAMADAS].reverse().find((c) => c.o === 'warn');
  marcar('soltar fora de uma pasta AVISA, em vez de sumir',
    semPasta === undefined && String(ultimoAviso?.m).includes('PASTA'), String(ultimoAviso?.m));

  marcar('a árvore declara `files` como tipo de soltura',
    arvore.dropMimeTypes.length === 1 && arvore.dropMimeTypes[0] === 'files',
    arvore.dropMimeTypes.join(', '));

  // Cofre trancado não pode virar árvore vazia sem motivo.
  await api('/api/connections/vault/lock', {});
  arvore.recarregar();
  const trancada = await arvore.getChildren(undefined);
  marcar('cofre trancado vira uma linha que se clica',
    trancada.length === 1 && trancada[0].command?.command === 'braytech.destrancarCofre',
    String(trancada[0]?.label));

  // ---- 7. o MENU: item sem comando é item que não faz nada ----
  const pacote = JSON.parse(
    await import('node:fs/promises').then((fs) =>
      fs.readFile(`${RAIZ}/extensao/package.json`, 'utf8')
    )
  );
  const declarados = new Set(pacote.contributes.commands.map((c) => c.command));
  const itens = pacote.contributes.menus['view/item/context'] ?? [];
  const orfaos = itens.filter((m) => !declarados.has(m.command)).map((m) => m.command);
  marcar('todo item de menu tem comando declarado', orfaos.length === 0,
    orfaos.length === 0 ? `${itens.length} itens` : orfaos.join(', '));

  // Comando declarado que ninguém registra = clique que não faz nada. Foi
  // exatamente o sintoma que ele descreveu.
  const fonteExt = await import('node:fs/promises').then((fs) =>
    fs.readFile(`${RAIZ}/extensao/dist/extension.js`, 'utf8')
  );
  const fonteCmd = await import('node:fs/promises').then((fs) =>
    fs.readFile(`${RAIZ}/extensao/dist/comandosDaArvore.js`, 'utf8')
  );
  const fontes = fonteExt + fonteCmd + ACOES_DO_MENU.map((a) => a.id).join(' ');
  const semRegistro = [...declarados].filter((c) => {
    if (c.startsWith('braytech.acao.')) return false; // registrados em laço
    return !fontes.includes(`'${c}'`) && !fontes.includes(`"${c}"`);
  });
  marcar('todo comando declarado é registrado no host', semRegistro.length === 0,
    semRegistro.length === 0 ? `${declarados.size} comandos` : semRegistro.join(', '));

  const inline = itens.filter((m) => m.group === 'inline');
  const naBarra = pacote.contributes.menus['view/title'] ?? [];

  // **O guarda contra o gotejamento.** Ele disse *"estou falando com um disco
  // travado"* porque eu vinha achando uma família de opções por vez, com ele
  // olhando a tela. O painel da IDE é a fonte: cada `<Acao*>` dele é uma
  // afordância que a extensão deve ter. Contar é grosseiro de propósito —
  // pega o SUMIÇO, que é o defeito que ele viu, sem fingir que sabe casar
  // ícone a ícone.
  const fs2 = await import('node:fs/promises');
  const doPainel = (
    await Promise.all(
      [
        'src/ui/connections/ConnectionsPanel.tsx',
        'src/ui/connections/AcoesDaLinhaRemota.tsx',
        'src/ui/connections/AcaoDoImportar.tsx',
      ].map((f) => fs2.readFile(`${RAIZ}/${f}`, 'utf8'))
    )
  )
    .join('\n')
    .match(/<(Acao|AcaoDaLinha|AcaoDoPainel)\b/g) ?? [];

  // `Recolher tudo` do painel corresponde ao `showCollapseAll` da TreeView, que
  // não é declarado: por isso o -1.
  const esperadas = doPainel.length - 1;
  const temos = inline.length + naBarra.length;
  marcar('a extensão tem tantas afordâncias quanto o painel', temos >= esperadas,
    `painel ${esperadas} · extensão ${temos} (hover ${inline.length} + barra ${naBarra.length})`);

  // **Item de hover sem `icon` é desenhado com o TÍTULO INTEIRO.** Foi o
  // "Braytech: Excluir conexão" por extenso na linha, no lugar da lixeira. O
  // defeito não é visível em nenhum outro lugar: o `package.json` fica válido,
  // o comando funciona, e só a tela dele mostra.
  const porNome = new Map(pacote.contributes.commands.map((c) => [c.command, c]));
  const semIcone = [...inline, ...naBarra]
    .filter((m) => porNome.get(m.command)?.icon === undefined)
    .map((m) => m.command.replace('braytech.', ''));
  marcar('todo ícone de barra e de hover tem `icon`', semIcone.length === 0,
    semIcone.length === 0 ? `${inline.length + naBarra.length} com ícone` : semIcone.join(', '));

  marcar('a barra do topo está declarada', naBarra.length >= 6,
    naBarra.map((m) => m.command.replace('braytech.', '')).join(', '));

  // O contextValue da conexão precisa dizer se ela está aberta: é o que separa
  // `Conectar` de `Desconectar`. Aqui ela ESTÁ aberta — o arnês já a usou —, e
  // é isso que prova que o `openIds` do motor está sendo lido. (Eu tinha
  // escrito `fechada` e o arnês me corrigiu.)
  marcar('a conexão diz se está aberta ou fechada',
    aConexao?.contextValue === 'braytech.conexao.aberta', String(aConexao?.contextValue));

  // ---- 8. os comandos EXECUTADOS de verdade (spec 104, D305) ----
  //
  // Ele: *"o Diagrama ER não está funcionando, só na outra versão"*,
  // *".sqlbook abre como JSON"*, *"as outras opções também estão dando o mesmo
  // problema"*. A causa era uma só: eu escrevi os payloads DE CABEÇA, e quase
  // todos estavam errados — `{current,next}` no lugar de `{atual,nova}`,
  // `name` no lugar de `nome`, `r.markdown` num objeto que não tem markdown.
  //
  // Nenhum guarda anterior pegava isso: o comando existia, o item aparecia, e a
  // rota respondia erro que sumia. Só EXECUTAR pega.
  const { registrarComandos } = require_(`${RAIZ}/extensao/dist/comandosDaArvore.js`);

  const feitos = [];
  const contextoFalso = { subscriptions: [] };
  const registrados = new Map();
  const cmdOriginal = vsc.commands.registerCommand;
  vsc.commands.registerCommand = (nome, fn) => {
    registrados.set(nome, fn);
    return { dispose() {} };
  };
  const pedirDeVerdade = async (metodo, rotaApi, corpo) => {
    const r = await fetch(`http://127.0.0.1:${PORTA_MOTOR}${rotaApi}`, {
      method: metodo,
      ...(corpo === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }),
    }).then((x) => x.json());
    feitos.push({ metodo, rota: rotaApi, ok: r.success === true, erro: r.error });
    return r.success === true ? r.data : null;
  };
  registrarComandos(
    contextoFalso,
    {
      motor: motorDaArvore,
      pedir: pedirDeVerdade,
      abrirFormulario() {}, abrirAbaDaIde: (t, titulo, d) => feitos.push({ aba: t, d }),
      abrirDiagrama: (t, md) => feitos.push({ diagrama: t, markdown: md }),
      abrirDialogo() {}, abrirTerminal() {}, salvarArquivo: async () => {},
      abrirQuery: async () => {}, definirConexaoAtiva() {}, recarregarTudo() {},
    },
    [arvore]
  );
  vsc.commands.registerCommand = cmdOriginal;

  // O cofre foi trancado na verificação 6: destranca para os comandos rodarem.
  await api('/api/connections/vault/unlock', { password: SENHA });
  arvore.recarregar();
  const raizes2 = await arvore.getChildren(undefined);
  const conexao2 = await primeiraConexao(raizes2);
  const dentro2 = await arvore.getChildren(conexao2);
  const main = dentro2.find((i) => typeof i.meta.database === 'string') ?? dentro2[0];

  // (a) Diagrama ER — o que ele disse que não funciona.
  global.__RESPOSTAS = {};
  await registrados.get('braytech.diagramaEr')?.(main);
  const oDiagrama = feitos.find((f) => f.diagrama !== undefined);
  marcar('Diagrama ER produz o markdown do Mermaid',
    typeof oDiagrama?.markdown === 'string' && oDiagrama.markdown.includes('erDiagram'),
    oDiagrama === undefined ? 'não abriu' : `${oDiagrama.markdown.length} caracteres`);

  // (b) criar query com os campos certos, e o `.sqlbook` indo para o CADERNO.
  global.__RESPOSTAS = { showInputBox: 'do-teste.sqlbook' };
  await registrados.get('braytech.novoQueryBook')?.(main);
  const criou = feitos.find((f) => f.rota === '/api/queries' && f.metodo === 'POST');
  marcar('criar query usa os campos que a rota espera', criou?.ok === true, criou?.erro ?? 'ok');
  const oCaderno = feitos.find((f) => f.aba === 'caderno');
  marcar('criar `.sqlbook` abre como CADERNO', oCaderno !== undefined,
    oCaderno === undefined ? 'abriu como texto' : String(oCaderno.d.caminho));

  // **O CLIQUE, que é o caminho que ele usa.**
  //
  // Eu tinha consertado só a criação e dito que estava resolvido — o clique
  // passava por outro comando, registrado noutro arquivo, que abria tudo como
  // texto. O arnês checava a criação e passava. Agora ele CLICA.
  arvore.recarregar();
  const raizes3 = await arvore.getChildren(undefined);
  const conexao3 = await primeiraConexao(raizes3);
  const dentro3 = await arvore.getChildren(conexao3);
  const comDatabase = dentro3.find((i) => typeof i.meta.database === 'string');
  const filhos3 = comDatabase === undefined ? [] : await arvore.getChildren(comDatabase);
  const pastaQuery = filhos3.find((i) => i.especie === 'query');
  marcar('a pasta `Query` existe no database', pastaQuery !== undefined,
    filhos3.map((i) => String(i.label)).slice(0, 4).join(', '));

  const arquivos3 = pastaQuery === undefined ? [] : await arvore.getChildren(pastaQuery);
  const oSqlbook = arquivos3.find((i) => String(i.label).endsWith('.sqlbook'));
  marcar('o `.sqlbook` criado aparece na pasta Query', oSqlbook !== undefined,
    arquivos3.map((i) => String(i.label)).join(', '));

  const antesDoClique = feitos.length;
  if (oSqlbook !== undefined) {
    marcar('o clique no `.sqlbook` chama o comando certo',
      oSqlbook.command?.command === 'braytech.abrirArquivoDeQuery',
      String(oSqlbook.command?.command));
    await registrados.get(String(oSqlbook.command?.command))?.(oSqlbook);
  }
  const cadernoDoClique = feitos.slice(antesDoClique).find((f) => f.aba === 'caderno');
  marcar('CLICAR no `.sqlbook` abre o caderno, e não texto',
    cadernoDoClique !== undefined,
    cadernoDoClique === undefined
      ? 'abriu como texto — é o JSON cru que ele viu'
      : String(cadernoDoClique.d.caminho));

  // (c) a troca de senha-mestra, com os nomes certos.
  global.__RESPOSTAS = { showInputBox: SENHA };
  await registrados.get('braytech.trocarSenhaMestra')?.({});
  const senha = feitos.find((f) => f.rota === '/api/connections/vault/password');
  marcar('trocar a senha-mestra chega com `atual` e `nova`', senha?.ok === true,
    senha === undefined ? 'nem chamou' : (senha.erro ?? 'ok'));

  // (d) exportar: a rota tem de aceitar, senão o arquivo sai vazio.
  await registrados.get('braytech.exportarConexoes')?.({});
  const exportou = feitos.find((f) => f.rota === '/api/connections/export-all');
  marcar('exportar conexões responde com sucesso', exportou?.ok === true,
    exportou === undefined ? 'nem chamou' : (exportou.erro ?? 'ok'));

  // (e) recarregar metadados e conectar.
  await registrados.get('braytech.recarregarConexao')?.(conexao2);
  // `f.rota?.` — nem toda entrada de `feitos` é uma chamada de rota: algumas
  // são `{aba}` e `{diagrama}`. Sem o `?.` isto lançava, e o arnês morria aqui
  // levando junto tudo o que vinha depois.
  const reconectou = feitos.find((f) => f.rota?.endsWith('/connect') === true);
  marcar('recarregar metadados chama `connect`', reconectou?.ok === true,
    reconectou?.erro ?? 'ok');

  // (f) o `+` da pasta Query PERGUNTA o tipo, e os diálogos recebem o pedido
  //     que eles realmente leem.
  const perguntas = [];
  const quickOriginal = vsc.window.showQuickPick;
  vsc.window.showQuickPick = async (itens, o) => {
    perguntas.push({ itens, o });
    return itens?.[1];  // escolhe "Caderno", para o caminho do .sqlbook
  };
  global.__RESPOSTAS = { showInputBox: 'perguntado.sqlbook' };
  await registrados.get('braytech.novaQuery')?.(pastaQuery);
  vsc.window.showQuickPick = quickOriginal;
  const aPergunta = perguntas.find((p) => (p.itens ?? []).some((i) => i.valor === 'sqlbook'));
  marcar('o `+` da Query pergunta SQL ou Query Book', aPergunta !== undefined,
    aPergunta === undefined
      ? 'não perguntou — criou direto'
      : aPergunta.itens.map((i) => i.label).join(' / '));

  // (g) os DIÁLOGOS recebem o pedido que o webview realmente lê.
  //
  // Eu mandava `{connectionId, nodePath}` e o diálogo lê `{id, caminho, ...}`:
  // abria vazio, e clicar não fazia nada. Aqui os campos são conferidos pelo
  // NOME, que é o que estava errado.
  const pedidos = [];
  const registradosComDialogo = new Map();
  vsc.commands.registerCommand = (nome, fn) => {
    registradosComDialogo.set(nome, fn);
    return { dispose() {} };
  };
  registrarComandos(
    { subscriptions: [] },
    {
      motor: motorDaArvore, pedir: pedirDeVerdade,
      abrirFormulario() {}, abrirAbaDaIde() {}, abrirDiagrama() {},
      abrirDialogo: (qual, pedido) => pedidos.push({ qual, pedido }),
      abrirTerminal() {}, salvarArquivo: async () => {}, abrirQuery: async () => {},
      definirConexaoAtiva() {}, recarregarTudo() {},
    },
    [arvore]
  );
  vsc.commands.registerCommand = cmdOriginal;

  const filhosDoDb = await arvore.getChildren(comDatabase);
  const categoria = filhosDoDb.find((i) => i.meta.categoria === true);
  const comTemplate = filhosDoDb.find((i) => typeof i.meta.template === 'string');
  marcar('existe categoria com filtro na árvore', categoria !== undefined,
    categoria === undefined ? 'nenhuma' : String(categoria.label));

  if (categoria !== undefined) {
    await registradosComDialogo.get('braytech.filtrarCategoria')?.(categoria);
    const oFiltro = pedidos.find((p) => p.qual === 'filtro');
    const faltam = ['id', 'caminho', 'rotulo', 'criterios'].filter(
      (c) => oFiltro?.pedido?.[c] === undefined
    );
    marcar('o diálogo de FILTRO recebe os campos que lê', oFiltro !== undefined && faltam.length === 0,
      oFiltro === undefined ? 'não abriu' : (faltam.length === 0 ? 'id, caminho, rotulo, criterios' : `faltam: ${faltam.join(', ')}`));
  }

  if (comTemplate !== undefined) {
    await registradosComDialogo.get('braytech.criarObjeto')?.(comTemplate);
    const aCriacao = pedidos.find((p) => p.qual === 'criacao');
    const faltam = ['id', 'caminho', 'rotulo', 'nomeBase', 'esqueleto'].filter(
      (c) => aCriacao?.pedido?.[c] === undefined
    );
    marcar('o diálogo de CRIAÇÃO recebe o esqueleto', aCriacao !== undefined && faltam.length === 0,
      aCriacao === undefined ? 'não abriu' : (faltam.length === 0 ? String(aCriacao.pedido.nomeBase) : `faltam: ${faltam.join(', ')}`));
  }

  // (h1) o detalhe da conexão é a DISTRO + `RO`, não o tipo.
  marcar('o detalhe da conexão não é o tipo do driver',
    conexao3?.description !== 'sqlite',
    `"${String(conexao3?.description ?? '(vazio)')}"`);

  // (h) o FILTRO chega ao servidor.
  //
  // Ele: *"Filtro de tables não está sendo aplicada"*. O diálogo funcionava e
  // ninguém escutava a resposta — e mesmo escutando, o `children` da árvore ia
  // sem parâmetro nenhum. Quem filtra é o SERVIDOR, e o filtro viaja na URL.
  //
  // Aqui a URL é ESPIONADA: é o único lugar onde o defeito aparece.
  if (categoria !== undefined) {
    const antes = (await arvore.getChildren(categoria)).length;
    await arvore.aplicarFiltro(categoria.conexao, categoria.nodePath, {
      nome: 'materias', dono: '', tamanho: '', desde: '',
    });

    const urls = [];
    const pedirOriginal = motorDaArvore.pedir.bind(motorDaArvore);
    motorDaArvore.pedir = (metodo, rotaApi, corpo) => {
      urls.push(rotaApi);
      return pedirOriginal(metodo, rotaApi, corpo);
    };
    const depois = (await arvore.getChildren(categoria)).length;
    motorDaArvore.pedir = pedirOriginal;

    const aUrl = urls.find((u) => u.includes('/children'));
    marcar('o filtro VIAJA na URL do `children`',
      aUrl !== undefined && aUrl.includes('filter='),
      aUrl === undefined ? 'não pediu filhos' : aUrl.slice(aUrl.indexOf('?')));

    // E o efeito de verdade: a lista encolhe.
    marcar('o filtro ENCOLHE a lista', depois < antes,
      `${antes} tabela(s) -> ${depois}`);

    // Limpa, senão as verificações seguintes veem a árvore filtrada.
    await arvore.aplicarFiltro(categoria.conexao, categoria.nodePath, {
      nome: '', dono: '', tamanho: '', desde: '',
    });
    const semFiltro = (await arvore.getChildren(categoria)).length;
    marcar('limpar o filtro devolve a lista inteira', semFiltro === antes,
      `${semFiltro} de ${antes}`);
  }

  // ---- 9. os ícones que CADA LINHA ganha (D308) ----
  //
  // Ele: *"você adicionou o botão Adicionar quando coloca o mouse em cima dos
  // .sqlbook e .sql, eles não têm isso"*. Os guardas anteriores contavam os
  // itens e conferiam ícone — nenhum perguntava QUAIS aparecem em QUAL linha.
  //
  // Aqui os `when` são APLICADOS ao `contextValue` de itens de verdade, e o
  // resultado é comparado com a lista esperada. Ícone a mais é tão defeito
  // quanto ícone a menos.
  const iconesDe = (contextValue) =>
    inline
      .filter((m) => {
        const re = /viewItem =~ \/(.+)\/$/.exec(m.when);
        return re === null ? false : new RegExp(re[1]).test(contextValue ?? '');
      })
      .map((m) => m.command.replace('braytech.', ''))
      .sort();

  const conferirLinha = (nome, item, esperado) => {
    const tem = iconesDe(item?.contextValue);
    const sobrando = tem.filter((x) => !esperado.includes(x));
    const faltando = esperado.filter((x) => !tem.includes(x));
    marcar(`ícones da linha: ${nome}`, sobrando.length === 0 && faltando.length === 0,
      sobrando.length === 0 && faltando.length === 0
        ? tem.join(', ') || '(nenhum)'
        : `sobrando [${sobrando.join(', ')}] faltando [${faltando.join(', ')}]`);
  };

  conferirLinha('arquivo .sqlbook', oSqlbook, ['renomearQuery', 'apagarQuery']);
  conferirLinha('pasta Query', pastaQuery, ['novaQuery']);
  conferirLinha('grupo', raizes3[0], ['renomearGrupo', 'novaConexaoNoGrupo']);
  // SQLite não tem terminal nem arquivos: `abrirServidor` e `abrirTerminal`
  // NÃO podem aparecer aqui — foi o outro defeito que ele viu.
  conferirLinha('conexão de banco (SQLite)', conexao3,
    ['recarregarConexao', 'excluirConexao']);

  // **Nenhuma rota pode ter respondido erro.** É o guarda de verdade: qualquer
  // payload que eu escreva de cabeça cai aqui.
  const comErro = feitos.filter((f) => f.ok === false);
  marcar('nenhum comando executado deu erro no motor', comErro.length === 0,
    comErro.length === 0
      ? `${feitos.filter((f) => f.ok !== undefined).length} chamadas`
      : comErro.map((f) => `${f.rota}: ${f.erro}`).join(' | '));

} catch (erro) {
  // **Sem este `catch` o arnês MENTIA.** O `process.exit` do `finally` engolia
  // a exceção inteira: uma verificação que quebrasse no meio levava junto todas
  // as seguintes, e o resumo dizia "0 falhas". Foi assim que quatro
  // verificações novas simplesmente não apareceram.
  marcar('o arnês rodou até o fim', false, erro instanceof Error ? erro.message : String(erro));
  if (erro instanceof Error && erro.stack !== undefined) {
    linhas.push(erro.stack.split('\n').slice(0, 4).join('\n'));
  }
} finally {
  console.log(linhas.join('\n'));
  const falhas = linhas.filter((l) => l.startsWith('FALHA')).length;
  console.log(`\n${linhas.length - falhas} de ${linhas.length} atendidas · ${falhas} falha(s)`);
  await encerrar();
  process.exit(falhas === 0 ? 0 : 1);
}
