// Rotas /api/connections.
//
// Esta camada não conhece nenhum driver: ela só costura cofre, registro e pool.
// Regra que vale para todas as respostas daqui: segredo nunca sai. O cofre
// devolve `PublicConnection` (sem os campos secretos) e só o pool, do lado do
// servidor, chega a ver o valor decifrado.
import { Router } from 'express';
import { applyGroupRename, buildGroupTree, normalizeGroupPath } from '../connections/groups';
import type { DriverRegistry } from '../connections/registry';
import type { SessionPool } from '../connections/pool';
import type { Vault } from '../connections/vault';
import { diasDeLembranca, type RememberedKey } from '../connections/remember';
import type { ConnectionInput, FieldValue, Session, VaultState } from '../connections/types';
import { createRemoteFilesRouter } from './arquivos-remotos';
import { apagarSnippet, guardarSnippet, lerSnippets } from '../snippets-de-terminal';
import { queryList, requireString, wrap } from '../http/handlers';
import type { LeitorDePreferencias } from '../prefs';

export interface ConnectionsDeps {
  readonly registry: DriverRegistry;
  readonly vault: Vault;
  readonly pool: SessionPool;
  readonly remember: RememberedKey;
  readonly prefs: LeitorDePreferencias;
}

/** Capacidades da sessão — é o que liga as sub-abas (terminal, SFTP, monitor...) na UI. */
function capabilities(session: Session) {
  return {
    kind: session.kind,
    execute: typeof session.execute === 'function',
    files: session.files !== undefined,
    shell: session.shell !== undefined,
    monitor: session.monitor !== undefined,
    forwarding: session.forwarding !== undefined,
    // Onde a tabela SFTP abre (spec 055). `/` para quem não disser nada.
    rootPath: session.rootPath ?? '/',
    // O que a tela digita quando o prompt aparecer (spec 061).
    comandoDeTerminal: session.comandoDeTerminal ?? '',
  };
}

function readInput(body: unknown, registry: DriverRegistry): ConnectionInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const type = requireString(raw.type, 'type');
  const fields = (raw.fields ?? {}) as Record<string, FieldValue>;
  return {
    type,
    label: requireString(raw.label, 'label').trim(),
    group: normalizeGroupPath(typeof raw.group === 'string' ? raw.group : ''),
    readOnly: raw.readOnly === true,
    fields: registry.validate(type, fields),
  };
}

export function createConnectionsRouter(
  { registry, vault, pool, remember, prefs }: ConnectionsDeps
): Router {
  const router = Router();

  const ok = (data: unknown) => ({ success: true, data, error: null });

  const estadoDoCofre = (): VaultState => ({
    exists: vault.exists(),
    unlocked: vault.isUnlocked(),
    rememberedUntil: remember.validUntil(),
    canRemember: remember.available(),
  });

  /**
   * Guarda a chave se o usuário pediu para lembrar.
   *
   * Falhar aqui não pode derrubar o destrancamento: o cofre já abriu, e não
   * conseguir lembrar é um aborrecimento, não um erro que valha recusar a
   * operação que o usuário pediu.
   */
  const talvezLembrar = (pedido: unknown): void => {
    if (pedido !== true) return;
    try {
      const dias = diasDeLembranca(process.env, prefs.ler()['vault.rememberDays']);
      remember.save(vault.exportKey(), dias);
    } catch {
      remember.clear();
    }
  };

  // ---- catálogo e cofre (antes de /:id, para não colidir) ----

  router.get('/drivers', wrap((_req, res) => {
    res.json(ok(registry.list()));
  }));

  router.post('/vault', wrap((req, res) => {
    vault.create(requireString(req.body?.password, 'password'));
    talvezLembrar(req.body?.remember);
    res.status(201).json(ok(estadoDoCofre()));
  }));

  router.post('/vault/unlock', wrap((req, res) => {
    vault.unlock(requireString(req.body?.password, 'password'));
    talvezLembrar(req.body?.remember);
    res.json(ok(estadoDoCofre()));
  }));

  router.post('/vault/lock', wrap(async (_req, res) => {
    vault.lock();
    // Trancar é um pedido explícito de fechar: a lembrança some junto, senão o
    // próximo início desfaria o que o usuário acabou de mandar fazer.
    remember.clear();
    // Sessões abertas seguram credenciais resolvidas: trancar o cofre fecha tudo.
    await pool.closeAll();
    res.json(ok(estadoDoCofre()));
  }));

  // ---- CRUD de conexões ----

  router.get('/', wrap((_req, res) => {
    const estado = estadoDoCofre();
    // Cofre ainda não criado é estado normal no primeiro uso, não erro.
    const conexoes = estado.exists ? vault.list() : [];
    res.json(ok({ vault: estado, tree: buildGroupTree(conexoes), openIds: pool.openIds() }));
  }));

  router.post('/', wrap((req, res) => {
    const input = readInput(req.body, registry);
    const criada = vault.add(input, registry.secretFields(input.type));
    res.status(201).json(ok(criada));
  }));

  router.patch('/:id', wrap((req, res) => {
    const atual = vault.get(req.params.id);
    const raw = (req.body ?? {}) as Record<string, unknown>;

    const patch: Partial<ConnectionInput> = {
      ...(typeof raw.label === 'string' ? { label: raw.label.trim() } : {}),
      ...(typeof raw.group === 'string' ? { group: normalizeGroupPath(raw.group) } : {}),
      ...(typeof raw.readOnly === 'boolean' ? { readOnly: raw.readOnly } : {}),
      ...(raw.fields !== undefined
        ? { fields: registry.validate(atual.type, raw.fields as Record<string, FieldValue>) }
        : {}),
    };

    res.json(ok(vault.update(atual.id, patch, registry.secretFields(atual.type))));
  }));

  router.delete('/:id', wrap(async (req, res) => {
    await pool.close(req.params.id);
    vault.remove(req.params.id);
    res.json(ok({ id: req.params.id }));
  }));

  router.post('/groups/rename', wrap((req, res) => {
    const from = normalizeGroupPath(requireString(req.body?.from, 'from'));
    const to = normalizeGroupPath(requireString(req.body?.to, 'to'));

    let renomeadas = 0;
    for (const conexao of vault.list()) {
      const novo = applyGroupRename(conexao.group, from, to);
      if (novo === normalizeGroupPath(conexao.group)) continue;
      // Patch sem `fields`: os segredos são preservados como estão e nada é
      // recifrado, então isto funciona mesmo com o cofre trancado.
      vault.update(conexao.id, { group: novo }, []);
      renomeadas += 1;
    }
    res.json(ok({ from, to, renomeadas }));
  }));

  // ---- sessão viva ----

  router.post('/:id/connect', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    res.json(ok(capabilities(session)));
  }));

  router.post('/:id/disconnect', wrap(async (req, res) => {
    await pool.close(req.params.id);
    res.json(ok({ id: req.params.id, connected: false }));
  }));

  router.get('/:id/children', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    // O padrão vem do usuário e desce até a consulta LIGADO — ver os drivers.
    const filtro = typeof req.query.filter === 'string' && req.query.filter !== ''
      ? req.query.filter
      : null;
    res.json(ok(await session.children(queryList(req.query.path), { filtro })));
  }));

  /**
   * Uma linha sobre o que há do outro lado (spec 052, AC-11).
   *
   * Separada de `children` porque o custo é outro: a árvore recarrega a cada
   * expansão, e perguntar "que servidor é este" a cada pasta aberta seria um
   * comando remoto por clique. Aqui a resposta é buscada uma vez.
   */
  // O sistema de arquivos do outro lado mora num roteador próprio (spec 053).
  router.use('/:id/files', createRemoteFilesRouter(pool));

  /**
   * Uma amostra de saúde do servidor (spec 056).
   *
   * `GET` e não socket: a tela pede quando quer, e uma aba escondida
   * simplesmente para de pedir. Um fluxo empurrado do servidor continuaria
   * medindo para uma tela que ninguém está olhando.
   */
  // Os snippets de terminal (spec 058). Não passam pelo pool: são do CADASTRO,
  // e ler a lista não pode exigir que a conexão esteja de pé.
  router.get('/:id/snippets', wrap((req, res) => {
    res.json(ok(lerSnippets(req.params.id)));
  }));

  router.post('/:id/snippets', wrap((req, res) => {
    res.json(ok(guardarSnippet(req.params.id, req.body)));
  }));

  router.delete('/:id/snippets/:snippet', wrap((req, res) => {
    res.json(ok(apagarSnippet(req.params.id, req.params.snippet)));
  }));

  // Encaminhamento de portas (spec 059).
  router.get('/:id/forwards', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    res.json(ok(session.forwarding === undefined ? [] : await session.forwarding.list()));
  }));

  router.post('/:id/forwards', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (session.forwarding === undefined) {
      throw new Error(`A conexão "${req.params.id}" não encaminha portas.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const remoteHost = requireString(body.remoteHost, 'remoteHost');
    const remotePort = Number(body.remotePort);
    const localPort = Number(body.localPort);
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65_535) {
      throw new Error('A porta remota precisa estar entre 1 e 65535.');
    }
    // Porta local ausente, zero ou inválida: o SO escolhe uma livre. Recusar
    // aqui faria o usuário adivinhar qual porta da máquina dele está livre.
    const local = Number.isInteger(localPort) && localPort > 0 && localPort < 65_536
      ? localPort
      : undefined;
    res.json(ok(await session.forwarding.open(remoteHost, remotePort, local)));
  }));

  router.delete('/:id/forwards/:forward', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (session.forwarding !== undefined) await session.forwarding.close(req.params.forward);
    res.json(ok({ id: req.params.forward }));
  }));

  router.get('/:id/metrics', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (session.monitor === undefined) {
      throw new Error(`A conexão "${req.params.id}" não sabe se medir.`);
    }
    res.json(ok(await session.monitor.sample()));
  }));

  router.get('/:id/describe', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    res.json(ok(typeof session.describe === 'function' ? await session.describe() : null));
  }));

  router.post('/:id/action', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.runAction !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não tem ações de menu.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const resultado = await session.runAction({
      nodePath: Array.isArray(body.nodePath) ? body.nodePath.map(String) : [],
      actionId: requireString(body.actionId, 'actionId'),
    });
    res.json(ok(resultado));
  }));

  /**
   * Uma página de uma TABELA (spec 041).
   *
   * Rota própria, e não `execute` com SQL montado no cliente: quem monta
   * `ORDER BY` e `WHERE` é o driver, porque nome de coluna não se parametriza e
   * a citação é dialeto. O cliente manda a INTENÇÃO — coluna, sentido, valor.
   */
  router.post('/:id/table', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.readTable !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não tem tabelas navegáveis.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(ok(await session.readTable({
      nodePath: Array.isArray(body.nodePath) ? body.nodePath.map(String) : [],
      pagina: typeof body.pagina === 'number' ? body.pagina : 1,
      porPagina: typeof body.porPagina === 'number' ? body.porPagina : 0,
      // `ordenar` e `filtros` são conferidos contra as colunas REAIS dentro do
      // driver — aqui só se repassa a forma.
      ordenar: (body.ordenar ?? null) as never,
      filtros: (Array.isArray(body.filtros) ? body.filtros : []) as never,
    })));
  }));

  /**
   * Escrever pela grade (spec 044).
   *
   * `simular: true` devolve o SQL sem executar — é o que a confirmação mostra.
   * O caminho é o MESMO da gravação; a bandeira é a única diferença.
   */
  router.post('/:id/table/write', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.writeTable !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não aceita escrita pela grade.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(ok(await session.writeTable({
      nodePath: Array.isArray(body.nodePath) ? body.nodePath.map(String) : [],
      // O conteúdo é conferido contra as colunas REAIS dentro do driver.
      insercoes: (body.insercoes ?? []) as never,
      alteracoes: (body.alteracoes ?? []) as never,
      remocoes: (body.remocoes ?? []) as never,
      simular: body.simular === true,
    })));
  }));

  /** A estrutura de uma tabela ou view (spec 045). Só leitura. */
  router.get('/:id/structure', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.tableStructure !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não expõe estrutura de tabela.`);
    }
    res.json(ok(await session.tableStructure(queryList(req.query.path))));
  }));

  /**
   * O comando de uma alteração de estrutura (spec 046).
   *
   * Devolve SQL e **não executa**. Esconder o botão não basta: a rota também
   * recusa o que o dialeto não faz — a conferência está no `montarAlteracao`.
   */
  router.post('/:id/alter', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.alterStructure !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não altera estrutura.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(ok(await session.alterStructure({
      nodePath: Array.isArray(body.nodePath) ? body.nodePath.map(String) : [],
      operacao: (body.operacao ?? {}) as Record<string, unknown>,
    })));
  }));

  /** O que este banco sabe alterar. A interface só oferece o que vier aqui. */
  router.get('/:id/alter/capabilities', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.alterCapabilities !== 'function') {
      res.json(ok({ dialeto: '', operacoes: [] }));
      return;
    }
    res.json(ok(session.alterCapabilities()));
  }));

  /** Os processos do servidor (spec 047). `null` = o banco não tem o conceito. */
  router.get('/:id/processes', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.processList !== 'function') {
      res.json(ok(null));
      return;
    }
    res.json(ok(await session.processList()));
  }));

  router.post('/:id/processes/:pid/kill', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.killProcess !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não mata processos.`);
    }
    // A marca de somente-leitura vale aqui: matar um processo MUDA o servidor,
    // e o sentido da marca é "esta conexão não muda nada".
    if (vault.list().find((c) => c.id === req.params.id)?.readOnly === true) {
      throw new Error('Esta conexão está marcada como somente-leitura.');
    }
    await session.killProcess(req.params.pid);
    res.json(ok({ morto: req.params.pid }));
  }));

  router.post('/:id/execute', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.execute !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não executa comandos.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const resultado = await session.execute({
      statement: requireString(body.statement, 'statement'),
      database: typeof body.database === 'string' && body.database !== '' ? body.database : undefined,
      nodePath: Array.isArray(body.nodePath) ? body.nodePath.map(String) : undefined,
      rowLimit: typeof body.rowLimit === 'number' ? body.rowLimit : undefined,
      timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
    });
    res.json(ok(resultado));
  }));

  return router;
}
