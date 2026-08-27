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
import { SEM_CANCELAMENTO } from '../connections/drivers/cancelar';
import { varrerTabela } from '../connections/exportacao';
import {
  apagarSnippet, caminhoDosSnippets, guardarSnippet, lerSnippets,
} from '../snippets-de-terminal';
import { queryList, requireString, wrap } from '../http/handlers';
import type { LeitorDePreferencias } from '../prefs';
import { guardarFiltro, lerFiltros } from '../filtros-da-arvore';
import { normalizarFiltro } from '../../shared/tree/filtro-da-arvore';

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
    // Parar consulta em andamento (T005). Aqui, e não numa rota própria: este
    // objeto já é o lugar onde a sessão DECLARA e a interface OBEDECE, e uma
    // segunda fonte para a mesma pergunta é o defeito, não a feature.
    cancelaQuery: typeof session.cancelQuery === 'function',
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

  /**
   * Trocar a senha mestra (T100).
   *
   * A lembrança de 15 dias é APAGADA junto: ela guarda a chave cifrada, e a
   * chave acabou de mudar. Manter a antiga faria o próximo início destrancar o
   * cofre com uma chave que não abre mais nada — erro sem causa aparente.
   */
  router.post('/vault/password', wrap((req, res) => {
    vault.trocarSenhaMestra(
      requireString(req.body?.atual, 'atual'),
      requireString(req.body?.nova, 'nova')
    );
    remember.clear();
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

  /**
   * TESTAR a conexão sem salvar (T103).
   *
   * Antes só existia `Salvar e conectar`: se a senha estivesse errada, a conexão
   * já estava gravada no cofre quando o erro aparecia.
   *
   * Abre, pergunta a versão do servidor e fecha. NÃO passa pelo pool: uma sessão
   * de teste entrando lá ficaria viva depois, e o usuário teria uma conexão
   * aberta para algo que ele nem salvou.
   */
  router.post('/test', wrap(async (req, res) => {
    const input = readInput(req.body, registry);
    const driver = registry.get(input.type);

    /**
     * Segredo em branco numa conexão que JÁ EXISTE vem do cofre.
     *
     * No formulário de edição, campo de senha vazio significa "mantenha a
     * guardada" — é assim desde a spec 005. O teste mandava o vazio adiante e o
     * servidor respondia `using password: NO`, que é verdade e não é o que o
     * usuário queria saber.
     *
     * Achado NO NAVEGADOR, contra o MySQL dele. O e2e não pegou porque a
     * conexão de teste é SQLite, que não tem senha nenhuma.
     *
     * O segredo não passa pelo navegador para isso: quem completa é o servidor.
     */
    const campos = { ...input.fields };
    const id = typeof (req.body as Record<string, unknown>)?.id === 'string'
      ? String((req.body as Record<string, unknown>).id)
      : null;
    if (id !== null) {
      for (const campo of vault.camposSecretos(id)) {
        const atual = campos[campo];
        if (atual === undefined || atual === '') campos[campo] = vault.revelar(id, campo);
      }
    }
    // Um id de mentira: nada disto vai para o cofre. O `resolve()` normal
    // decifra do cofre, e aqui os valores vieram do FORMULÁRIO, em claro.
    const sessao = await driver.connect({
      id: 'teste', type: input.type, label: input.label,
      readOnly: input.readOnly, fields: campos,
    } as never);
    try {
      const descricao = typeof sessao.describe === 'function' ? await sessao.describe() : null;
      res.json(ok({ conectou: true, descricao }));
    } finally {
      await sessao.close().catch(() => undefined);
    }
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

  /**
   * VER a senha guardada de uma conexão (N001).
   *
   * Ele pediu: *"eu preciso pegar as senhas das conexões também"*. Até aqui o
   * segredo ia do cofre direto para o driver — `GET /api/connections` continua
   * sem devolvê-lo, e isso não muda.
   *
   * Três estreitamentos deliberados:
   *   1. UM campo por chamada. Um engano de uma linha não despeja tudo.
   *   2. Pedir campo que não é segredo é ERRO, não silêncio — senão esta rota
   *      viraria um jeito torto de ler campo comum.
   *   3. Exige o cofre destrancado, como tudo que decifra.
   *
   * Sem trava adicional além disso: foi a escolha dele, e o servidor escuta só
   * em `127.0.0.1` com token desde a spec 002.
   */
  router.get('/:id/secret/:field', wrap(async (req, res) => {
    res.json(ok({ valor: vault.revelar(req.params.id, req.params.field) }));
  }));

  /** Quais campos daquela conexão são segredo — para a tela saber onde pôr o olho. */
  router.get('/:id/secret-fields', wrap(async (req, res) => {
    res.json(ok({ campos: vault.camposSecretos(req.params.id) }));
  }));

  /**
   * TODAS as conexões, com as senhas, em JSON claro (N001).
   *
   * Ele escolheu claro, sabendo o que é: um arquivo com credencial de produção
   * legível. A IDE não decide onde ele fica — quem baixa é o navegador dele.
   */
  router.post('/export-all', wrap(async (_req, res) => {
    const conexoes = vault.list().map((c) => {
      const campos: Record<string, unknown> = { ...c.fields };
      for (const campo of vault.camposSecretos(c.id)) {
        campos[campo] = vault.revelar(c.id, campo);
      }
      return {
        type: c.type, label: c.label, group: c.group, readOnly: c.readOnly, fields: campos,
      };
    });
    res.json(ok({
      exportadoEm: new Date().toISOString(),
      aviso: 'Este arquivo contém SENHAS EM CLARO.',
      conexoes,
    }));
  }));

  /** Onde os snippets de terminal moram, para o `{}` abrir no editor (T085). */
  router.get('/terminal-snippets/file', wrap(async (_req, res) => {
    res.json(ok({ path: caminhoDosSnippets() }));
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

  /** Um parâmetro de texto da query, ou `null` quando ausente ou vazio. */
  const textoDaQuery = (bruto: unknown): string | null =>
    typeof bruto === 'string' && bruto !== '' ? bruto : null;

  router.get('/:id/children', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    // O padrão vem do usuário e desce até a consulta LIGADO — ver os drivers.
    const filtro = textoDaQuery(req.query.filter);
    // O tamanho chega já em BYTES: interpretar "10 MB" é lógica pura, e ela
    // mora no `shared`, testada. O servidor recebe número ou nada.
    const bytes = Number(req.query.minBytes);
    res.json(ok(await session.children(queryList(req.query.path), {
      filtro,
      dono: textoDaQuery(req.query.owner),
      minBytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null,
      desde: textoDaQuery(req.query.since),
    })));
  }));

  /**
   * Os filtros guardados desta conexão (T111).
   *
   * Vêm todos de uma vez, e não um por nó: a árvore precisa deles ANTES de
   * pedir os filhos, e um pedido por categoria expandida seria uma ida ao disco
   * por clique.
   */
  router.get('/:id/tree-filters', wrap(async (req, res) => {
    res.json(ok(lerFiltros(req.params.id)));
  }));

  router.put('/:id/tree-filters', wrap(async (req, res) => {
    const corpo = req.body as { path?: unknown; filtro?: unknown };
    if (!Array.isArray(corpo.path)) throw new Error('Falta o caminho do nó.');
    const caminho = corpo.path.filter((p): p is string => typeof p === 'string').join('\u0000');
    res.json(ok(guardarFiltro(req.params.id, caminho, normalizarFiltro(corpo.filtro))));
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
   * Parar a consulta em andamento (T005).
   *
   * Vem por uma requisição SEPARADA de propósito: a que está rodando a query
   * está parada esperando a resposta do banco, e é justamente ela que o usuário
   * quer interromper.
   */
  router.post('/:id/cancel', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.cancelQuery !== 'function') {
      throw new Error(SEM_CANCELAMENTO);
    }
    await session.cancelQuery();
    res.json(ok({ cancelado: true }));
  }));

  /**
   * O valor INTEIRO de uma célula (spec 062, fase D).
   *
   * A rota de tabela corta cada célula em `MAX_CELL_CHARS`, porque uma página
   * de 500 linhas com JSON de 40 KB seriam 20 MB atravessando a rede para caber
   * em colunas de 400 px. Esta traz uma célula só, e sem esse corte — é o que
   * a lupa promete, e o que ela não estava entregando.
   */
  router.post('/:id/table/cell', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.readCell !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não sabe ler uma célula isolada.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(ok(await session.readCell({
      nodePath: Array.isArray(body.nodePath) ? body.nodePath.map(String) : [],
      // A chave e a coluna são conferidas contra as colunas REAIS no driver:
      // é lá que o nome vira identificador citado.
      chave: (body.chave ?? {}) as never,
      coluna: String(body.coluna ?? ''),
    })));
  }));

  /**
   * Exportar a TABELA INTEIRA (T058).
   *
   * Varre em lotes usando o `readTable` que os três drivers já têm — nenhum
   * driver precisou de uma linha nova. Os filtros e a ordem da tela vão junto,
   * senão o arquivo não seria o que está na tela.
   */
  router.post('/:id/table/export', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.readTable !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não tem tabelas navegáveis.`);
    }
    const ler = session.readTable.bind(session);
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(ok(await varrerTabela(ler, {
      nodePath: Array.isArray(body.nodePath) ? body.nodePath.map(String) : [],
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
      // Paginação do resultado (T056). Negativo e fracionário são aparados no
      // driver; aqui só se repassa a forma.
      offset: typeof body.offset === 'number' ? body.offset : undefined,
      timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
    });
    res.json(ok(resultado));
  }));

  return router;
}
