// Cliente da API REST do backend.
(function () {
  'use strict';

  async function request(method, url, body) {
    const options = { method, headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      throw new Error('Falha de conexão com o servidor da IDE: ' + err.message);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
    }
    if (!payload.success) {
      throw new Error(payload.error || `Erro do servidor (HTTP ${response.status}).`);
    }
    return payload.data;
  }

  window.Api = {
    listProjects: () => request('GET', '/api/projects'),
    createProject: (name) => request('POST', '/api/projects', { name }),
    fileTree: (project) => request('GET', `/api/projects/${encodeURIComponent(project)}/files`),
    createFile: (project, name, content) =>
      request('POST', `/api/projects/${encodeURIComponent(project)}/files`, { name, content }),
    projectSymbols: (project) =>
      request('GET', `/api/projects/${encodeURIComponent(project)}/symbols`),
    readFile: (path) => request('GET', `/api/file?path=${encodeURIComponent(path)}`),
    saveFile: (path, content) => request('POST', '/api/file', { path, content }),
    run: (payload) => request('POST', '/api/run', payload),

    // ---- Conexões ----
    drivers: () => request('GET', '/api/connections/drivers'),
    connections: () => request('GET', '/api/connections'),
    createVault: (password) => request('POST', '/api/connections/vault', { password }),
    unlockVault: (password) => request('POST', '/api/connections/vault/unlock', { password }),
    lockVault: () => request('POST', '/api/connections/vault/lock'),
    createConnection: (payload) => request('POST', '/api/connections', payload),
    updateConnection: (id, patch) => request('PATCH', `/api/connections/${id}`, patch),
    deleteConnection: (id) => request('DELETE', `/api/connections/${id}`),
    renameGroup: (from, to) => request('POST', '/api/connections/groups/rename', { from, to }),
    connect: (id) => request('POST', `/api/connections/${id}/connect`),
    disconnect: (id) => request('POST', `/api/connections/${id}/disconnect`),
    // Cada segmento vira um `path=` separado: ids e caminhos podem conter "/".
    children: (id, nodePath) => {
      const qs = (nodePath || []).map((p) => 'path=' + encodeURIComponent(p)).join('&');
      return request('GET', `/api/connections/${id}/children${qs ? '?' + qs : ''}`);
    },
    execute: (id, payload) => request('POST', `/api/connections/${id}/execute`, payload),
    runAction: (id, payload) => request('POST', `/api/connections/${id}/action`, payload),
  };
})();
