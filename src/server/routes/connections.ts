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
import type { ConnectionInput, FieldValue, Session } from '../connections/types';
import { queryList, requireString, wrap } from '../http/handlers';

export interface ConnectionsDeps {
  readonly registry: DriverRegistry;
  readonly vault: Vault;
  readonly pool: SessionPool;
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

export function createConnectionsRouter({ registry, vault, pool }: ConnectionsDeps): Router {
  const router = Router();

  const ok = (data: unknown) => ({ success: true, data, error: null });

  // ---- catálogo e cofre (antes de /:id, para não colidir) ----

  router.get('/drivers', wrap((_req, res) => {
    res.json(ok(registry.list()));
  }));

  router.post('/vault', wrap((req, res) => {
    vault.create(requireString(req.body?.password, 'password'));
    res.status(201).json(ok({ exists: true, unlocked: true }));
  }));

  router.post('/vault/unlock', wrap((req, res) => {
    vault.unlock(requireString(req.body?.password, 'password'));
    res.json(ok({ exists: true, unlocked: true }));
  }));

  router.post('/vault/lock', wrap(async (_req, res) => {
    vault.lock();
    // Sessões abertas seguram credenciais resolvidas: trancar o cofre fecha tudo.
    await pool.closeAll();
    res.json(ok({ exists: vault.exists(), unlocked: false }));
  }));

  // ---- CRUD de conexões ----

  router.get('/', wrap((_req, res) => {
    const estado = { exists: vault.exists(), unlocked: vault.isUnlocked() };
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
    res.json(ok(await session.children(queryList(req.query.path))));
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

  router.post('/:id/execute', wrap(async (req, res) => {
    const session = await pool.acquire(req.params.id);
    if (typeof session.execute !== 'function') {
      throw new Error(`A conexão "${req.params.id}" não executa comandos.`);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const resultado = await session.execute({
      statement: requireString(body.statement, 'statement'),
      nodePath: Array.isArray(body.nodePath) ? body.nodePath.map(String) : undefined,
      rowLimit: typeof body.rowLimit === 'number' ? body.rowLimit : undefined,
      timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
    });
    res.json(ok(resultado));
  }));

  return router;
}
