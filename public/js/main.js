// Orquestração da IDE: estado, toolbar, execução e integração dos painéis.
(function () {
  'use strict';

  const els = {
    projectSelect: document.getElementById('project-select'),
    newProject: document.getElementById('btn-new-project'),
    newFile: document.getElementById('btn-new-file'),
    openFile: document.getElementById('btn-open-file'),
    save: document.getElementById('btn-save'),
    languageSelect: document.getElementById('language-select'),
    runFile: document.getElementById('btn-run-file'),
    runBlock: document.getElementById('btn-run-block'),
    runFunction: document.getElementById('btn-run-function'),
    functionSelect: document.getElementById('function-select'),
    functionArgs: document.getElementById('function-args'),
    output: document.getElementById('output'),
    outputStatus: document.getElementById('output-status'),
    clearOutput: document.getElementById('btn-clear-output'),
    statusFile: document.getElementById('status-file'),
    statusDirty: document.getElementById('status-dirty'),
  };

  const state = {
    project: null,
  };

  // ---- Abas ----
  // Uma aba de arquivo guarda todo o seu estado em `meta`; o editor é um só e
  // é carregado com o conteúdo da aba ativa a cada troca.
  const tabs = window.createTabStore();
  let carregando = false; // suprime onChange do editor durante a troca de aba

  const tabIdDe = (path) => 'file:' + path;

  function abaAtiva() {
    const aba = tabs.active();
    return aba !== null && (aba.type === 'editor' || aba.type === 'sql') ? aba : null;
  }

  /** Caminho do arquivo na aba ativa, ou null se não houver aba de arquivo. */
  function caminhoAtivo() {
    const aba = abaAtiva();
    return aba === null ? null : aba.meta.path;
  }

  function salvarEstadoNaAba(id) {
    const aba = tabs.get(id);
    if (aba === null || (aba.type !== 'editor' && aba.type !== 'sql')) return;
    tabs.update(id, {
      meta: Object.assign({}, aba.meta, {
        content: window.Editor.getValue(),
        language: window.Editor.getLanguage(),
        view: window.Editor.getViewState(),
      }),
    });
  }

  function carregarAbaNoEditor(aba) {
    carregando = true;
    try {
      window.Editor.setLanguage(aba.meta.language || 'plain');
      els.languageSelect.value = window.Editor.getLanguage();
      window.Editor.setValue(aba.meta.content || '');
      window.Editor.setViewState(aba.meta.view);
    } finally {
      carregando = false;
    }
    els.statusFile.textContent = aba.meta.path || aba.title;
    els.statusDirty.textContent = aba.dirty ? '● não salvo' : '';
    window.Sidebar.setActivePath(aba.meta.path || null);
    refreshFunctionList();
  }

  let ultimaAbaAtiva = null;
  tabs.onChange((lista, activeId) => {
    if (activeId === ultimaAbaAtiva) return;

    // Marca ANTES de salvar: salvarEstadoNaAba chama tabs.update, que dispara
    // este mesmo listener de novo. Sem a marca antecipada, a chamada reentrante
    // veria a guarda ainda falsa e recursaria até travar a aba do navegador.
    const anterior = ultimaAbaAtiva;
    ultimaAbaAtiva = activeId;
    if (anterior !== null) salvarEstadoNaAba(anterior);

    const aba = activeId === null ? null : tabs.get(activeId);
    if (aba === null) {
      els.statusFile.textContent = 'nenhum arquivo';
      els.statusDirty.textContent = '';
      window.Sidebar.setActivePath(null);
      return;
    }
    if (aba.type === 'editor' || aba.type === 'sql') carregarAbaNoEditor(aba);
  });

  function fecharAba(id) {
    const aba = tabs.get(id);
    if (aba !== null && aba.dirty) {
      const nome = aba.title;
      if (!confirm('"' + nome + '" tem alterações não salvas. Fechar mesmo assim?')) return;
    }
    // Não zera `ultimaAbaAtiva` aqui: `null` é o sentinela de "nenhuma aba", e
    // usá-lo também para "aba fechada" faria a guarda do onChange engolir o
    // evento de fechar a última. salvarEstadoNaAba já ignora aba inexistente.
    tabs.close(id);
  }

  window.TabBar.init({ store: tabs, onClose: fecharAba });

  // ---- Conexões ----
  // A conexão ativa é a última que o usuário tocou na árvore; é contra ela que
  // Ctrl+Enter executa quando a aba é SQL.
  let conexaoAtiva = null;

  function abrirQueryDaArvore(connectionId, no) {
    conexaoAtiva = connectionId;
    const objeto = no.meta && no.meta.object ? no.meta.object : no.label;
    const schema = no.meta && no.meta.schema ? no.meta.schema : null;
    const alvo = schema ? schema + '.' + objeto : objeto;

    const id = 'sql:' + connectionId + ':' + alvo;
    if (ultimaAbaAtiva !== null) salvarEstadoNaAba(ultimaAbaAtiva);
    tabs.open({
      id: id,
      type: 'sql',
      title: objeto + '.sql',
      meta: {
        path: null,
        content: 'SELECT * FROM ' + alvo + ' LIMIT 100;',
        language: 'sql',
        view: null,
        connectionId: connectionId,
        nodePath: no.meta && no.meta.nodePath ? no.meta.nodePath : null,
      },
    });
  }

  /**
   * Abre numa aba o que a ação do menu devolveu. `statement` vira SQL pronto
   * para rodar; `text` (DDL, contagem) vira conteúdo para leitura — os dois no
   * mesmo editor, já com a conexão amarrada para o Ctrl+Enter funcionar.
   */
  function abrirResultadoDeAcao(connectionId, resultado) {
    conexaoAtiva = connectionId;
    const id = 'acao:' + connectionId + ':' + resultado.title;
    if (ultimaAbaAtiva !== null) salvarEstadoNaAba(ultimaAbaAtiva);
    tabs.open({
      id: id,
      type: 'sql',
      title: resultado.title,
      meta: {
        path: null,
        content: resultado.content,
        language: resultado.language || 'sql',
        view: null,
        connectionId: connectionId,
      },
    });
  }

  async function executarSql() {
    const aba = abaAtiva();
    if (aba === null) return false;

    const connectionId = aba.meta.connectionId || conexaoAtiva;
    if (!connectionId) {
      logOutput('Nenhuma conexão ativa. Abra uma conexão no painel Database.\n', true);
      return true;
    }

    const statement = (window.Editor.getSelection() || window.Editor.getValue()).trim();
    if (statement === '') return true;

    const gridId = 'grid:' + connectionId;
    const gridAba = tabs.open({ id: gridId, type: 'grid', title: 'Resultado', meta: {} });
    const painel = window.TabBar.panelFor(gridAba);
    window.Grid.carregando(painel);

    try {
      const resultado = await window.Api.execute(connectionId, {
        statement: statement,
        rowLimit: 500,
      });
      window.Grid.render(painel, resultado, { label: aba.title });
      logStatus(resultado.rowCount + ' linha(s) · ' + resultado.durationMs + 'ms', false);
    } catch (err) {
      window.Grid.erro(painel, err.message);
      logStatus('erro', true);
    }
    return true;
  }

  // ---- Projetos ----
  async function refreshProjects(selectName) {
    const projects = await window.Api.listProjects();
    els.projectSelect.innerHTML = '';
    if (projects.length === 0) {
      els.projectSelect.appendChild(new Option('(sem projetos)', ''));
    }
    for (const name of projects) {
      els.projectSelect.appendChild(new Option(name, name));
    }
    const chosen = selectName || state.project || projects[0] || null;
    if (chosen && projects.includes(chosen)) {
      els.projectSelect.value = chosen;
      await selectProject(chosen);
    }
  }

  async function selectProject(name) {
    state.project = name;
    await Promise.all([refreshTree(), refreshSymbols()]);
  }

  async function refreshTree() {
    if (!state.project) return;
    window.Sidebar.renderTree(await window.Api.fileTree(state.project));
    window.Sidebar.setActivePath(caminhoAtivo());
  }

  async function refreshSymbols() {
    if (!state.project) return;
    window.Sidebar.renderSymbols(await window.Api.projectSymbols(state.project));
  }

  // ---- Arquivos ----
  async function openFile(path) {
    // Arquivo já aberto: só foca a aba, preservando edições não salvas.
    const existente = tabs.get(tabIdDe(path));
    if (existente) {
      tabs.activate(existente.id);
      return;
    }

    const data = await window.Api.readFile(path);
    const ext = '.' + (data.path.split('.').pop() || '').toLowerCase();
    const lang = window.EXT_TO_LANG[ext] || 'plain';

    // Salva a aba atual antes de abrir a nova, senão o conteúdo dela se perde.
    if (ultimaAbaAtiva !== null) salvarEstadoNaAba(ultimaAbaAtiva);

    tabs.open({
      id: tabIdDe(data.path),
      type: lang === 'sql' ? 'sql' : 'editor',
      title: data.path.split('/').pop(),
      meta: { path: data.path, content: data.content, language: lang, view: null },
    });
  }

  async function saveFile() {
    const aba = abaAtiva();
    if (aba === null) return;
    if (!aba.meta.path) {
      return newFile(window.Editor.getValue());
    }
    await window.Api.saveFile(aba.meta.path, window.Editor.getValue());
    setDirty(false);
    logStatus('salvo', false);
    await Promise.all([refreshTree(), refreshSymbols()]);
    refreshFunctionList();
  }

  async function newFile(initialContent) {
    if (!state.project) {
      alert('Crie ou selecione um projeto primeiro.');
      return;
    }
    const name = prompt('Nome do novo arquivo (ex.: utils.ts, script.py):');
    if (!name) return;
    try {
      const created = await window.Api.createFile(state.project, name.trim(), initialContent || '');
      await openFile(created.path);
      await Promise.all([refreshTree(), refreshSymbols()]);
    } catch (err) {
      alert(err.message);
    }
  }

  function setDirty(dirty) {
    const aba = abaAtiva();
    if (aba !== null && aba.dirty !== dirty) tabs.update(aba.id, { dirty: dirty });
    els.statusDirty.textContent = dirty ? '● não salvo' : '';
  }

  // ---- Funções do arquivo atual (para "executar função") ----
  const FN_PATTERNS = [
    /(?:^|\s)function\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)\n]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /(?:^|\s)def\s+([A-Za-z_]\w*)/g,
  ];

  function refreshFunctionList() {
    const code = window.Editor.getValue();
    const names = new Set();
    for (const pattern of FN_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(code)) !== null) names.add(m[1]);
    }
    els.functionSelect.innerHTML = '';
    if (names.size === 0) {
      els.functionSelect.appendChild(new Option('(sem funções)', ''));
      return;
    }
    for (const name of [...names].sort()) {
      els.functionSelect.appendChild(new Option(name + '()', name));
    }
  }

  // ---- Execução ----
  async function run(mode) {
    // O despacho por contexto mora aqui, e não em cada gatilho: Ctrl+Enter e os
    // botões da toolbar chamam esta função, então uma aba SQL vai para o banco
    // por qualquer um dos caminhos.
    const abaCorrente = abaAtiva();
    if (abaCorrente !== null && abaCorrente.type === 'sql') {
      await executarSql();
      return;
    }

    const language = els.languageSelect.value;
    if (language === 'python') {
      logOutput('Execução de Python ainda não é suportada — o runner usa Node.js.\n', true);
      return;
    }
    const aba = abaAtiva();
    const filePath = aba === null ? null : aba.meta.path;
    const sujo = aba !== null && aba.dirty;
    const payload = { mode, language, filePath: filePath || undefined };

    if (mode === 'file') {
      if (sujo || !filePath) {
        // executa o conteúdo do editor mesmo sem salvar
        payload.mode = 'block';
        payload.code = window.Editor.getValue();
      }
    } else if (mode === 'block') {
      payload.code = window.Editor.getSelection() || window.Editor.getValue();
    } else if (mode === 'function') {
      const fn = els.functionSelect.value;
      if (!fn) {
        logOutput('Nenhuma função detectada no arquivo atual.\n', true);
        return;
      }
      if (!filePath || sujo) {
        logOutput('Salve o arquivo antes de executar uma função (Ctrl+S).\n', true);
        return;
      }
      payload.functionName = fn;
      const rawArgs = els.functionArgs.value.trim();
      if (rawArgs) {
        try {
          const parsed = JSON.parse(rawArgs);
          if (!Array.isArray(parsed)) throw new Error('deve ser um array');
          payload.args = parsed;
        } catch (err) {
          logOutput(`Argumentos inválidos (${err.message}). Use um array JSON, ex.: [1, "a"]\n`, true);
          return;
        }
      }
    }

    logStatus('executando...', false);
    try {
      const result = await window.Api.run(payload);
      renderRunResult(result);
    } catch (err) {
      logOutput(err.message + '\n', true);
      logStatus('erro', true);
    }
  }

  function renderRunResult(result) {
    if (result.stdout) logOutput(result.stdout, false);
    if (result.stderr) logOutput(result.stderr, true);
    if (!result.stdout && !result.stderr) logOutput('(sem saída)\n', false);
    const ok = result.exitCode === 0 && !result.timedOut;
    const status = result.timedOut
      ? 'tempo esgotado (15s)'
      : `exit ${result.exitCode} · ${result.durationMs}ms`;
    logStatus(status, !ok);
  }

  function logOutput(text, isError) {
    const span = document.createElement('span');
    if (isError) span.className = 'out-err';
    span.textContent = text;
    els.output.appendChild(span);
    els.output.scrollTop = els.output.scrollHeight;
  }

  function logStatus(text, isError) {
    els.outputStatus.textContent = text;
    els.outputStatus.classList.toggle('error', Boolean(isError));
  }

  // ---- Eventos ----
  els.projectSelect.addEventListener('change', () => selectProject(els.projectSelect.value));

  els.newProject.addEventListener('click', async () => {
    const name = prompt('Nome do novo projeto:');
    if (!name) return;
    try {
      await window.Api.createProject(name.trim());
      await refreshProjects(name.trim());
    } catch (err) {
      alert(err.message);
    }
  });

  els.newFile.addEventListener('click', () => newFile(''));

  els.openFile.addEventListener('click', async () => {
    const path = prompt('Caminho do arquivo para abrir (absoluto):');
    if (!path) return;
    try {
      await openFile(path.trim());
    } catch (err) {
      alert(err.message);
    }
  });

  els.save.addEventListener('click', () => saveFile().catch((e) => alert(e.message)));
  els.languageSelect.addEventListener('change', () =>
    window.Editor.setLanguage(els.languageSelect.value)
  );
  els.runFile.addEventListener('click', () => run('file'));
  els.runBlock.addEventListener('click', () => run('block'));
  els.runFunction.addEventListener('click', () => run('function'));
  els.clearOutput.addEventListener('click', () => {
    els.output.innerHTML = '';
    logStatus('', false);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile().catch((err) => alert(err.message));
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      // Despacha por contexto: aba SQL vai para o banco, o resto para o runner.
      const aba = abaAtiva();
      if (aba !== null && aba.type === 'sql') {
        executarSql().catch((err) => logOutput(err.message + '\n', true));
      } else {
        run('file');
      }
    }
  });

  window.Editor.onChange(() => {
    if (carregando) return; // troca de aba não é edição do usuário
    setDirty(true);
    refreshFunctionList();
  });

  window.Sidebar.onOpenFile((path) => openFile(path).catch((e) => alert(e.message)));
  window.Sidebar.onOpenSymbol(async (path, line) => {
    try {
      if (path !== caminhoAtivo()) await openFile(path);
      window.Editor.goToLine(line);
    } catch (err) {
      alert(err.message);
    }
  });

  // ---- Inicialização ----
  window.Editor.setLanguage('javascript');
  refreshProjects().catch((err) => logOutput(err.message + '\n', true));
  window.Connections.init({
    onAbrirQuery: abrirQueryDaArvore,
    onAbrirAcao: abrirResultadoDeAcao,
    onEditarConexao: (conexao) => alert('Edição de conexão ainda não tem formulário — em construção.'),
  }).catch((err) =>
    logOutput('Painel de conexões: ' + err.message + '\n', true)
  );
})();
