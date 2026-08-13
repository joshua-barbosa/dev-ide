// Barra de abas e troca de painéis.
//
// Toda a lógica de estado está em tabs.js; aqui é só DOM. Duas regras que
// valem registrar:
//
// - Abas de editor COMPARTILHAM o mesmo #editor-wrap. Só existe um textarea;
//   trocar de aba salva e restaura o conteúdo dele. Criar um editor por aba
//   multiplicaria DOM sem ganho.
// - Abas de outros tipos (grid, conexão, terminal) ganham um painel próprio,
//   criado sob demanda e removido quando a aba fecha.
(function () {
  'use strict';

  const tabBar = document.getElementById('tab-bar');
  const panels = document.getElementById('tab-panels');
  const editorWrap = document.getElementById('editor-wrap');
  const emptyState = document.getElementById('tab-empty');

  const ICONS = {
    editor: '📄',
    sql: '🗒',
    grid: '▦',
    connection: '🔌',
    terminal: '▶',
    sftp: '📁',
    monitor: '📈',
  };

  let store = null;
  let onClose = null;
  const dynamicPanels = new Map();

  function panelFor(tab) {
    if (tab.type === 'editor' || tab.type === 'sql') return editorWrap;

    let painel = dynamicPanels.get(tab.id);
    if (painel === undefined) {
      painel = document.createElement('div');
      painel.className = 'tab-panel';
      painel.dataset.tabId = tab.id;
      panels.appendChild(painel);
      dynamicPanels.set(tab.id, painel);
    }
    return painel;
  }

  /** Descarta painéis de abas que não existem mais. */
  function limparPainéisOrfaos(tabs) {
    const vivos = new Set(tabs.map((tab) => tab.id));
    for (const [id, painel] of dynamicPanels) {
      if (!vivos.has(id)) {
        painel.remove();
        dynamicPanels.delete(id);
      }
    }
  }

  function criarAba(tab, ativo) {
    const item = document.createElement('div');
    item.className = 'tab' + (ativo ? ' active' : '') + (tab.dirty ? ' dirty' : '');
    item.dataset.tabId = tab.id;
    item.title = tab.title;

    const icone = document.createElement('span');
    icone.className = 'tab-icon';
    icone.textContent = tab.icon || ICONS[tab.type] || '•';

    const titulo = document.createElement('span');
    titulo.className = 'tab-title';
    titulo.textContent = tab.title;

    const fechar = document.createElement('button');
    fechar.className = 'tab-close';
    fechar.type = 'button';
    // O ponto de "não salvo" ocupa o mesmo lugar do X, e vira X ao passar o mouse.
    fechar.textContent = tab.dirty ? '●' : '✕';
    fechar.title = 'Fechar';
    fechar.addEventListener('click', (e) => {
      e.stopPropagation(); // não ativar a aba ao fechá-la
      if (onClose) onClose(tab.id);
    });

    item.append(icone, titulo, fechar);
    item.addEventListener('click', () => store.activate(tab.id));
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1 && onClose) onClose(tab.id); // botão do meio fecha
    });
    return item;
  }

  function render(tabs, activeId) {
    limparPainéisOrfaos(tabs);

    tabBar.innerHTML = '';
    for (const tab of tabs) {
      tabBar.appendChild(criarAba(tab, tab.id === activeId));
    }

    const ativo = tabs.find((tab) => tab.id === activeId) || null;
    const painelAtivo = ativo === null ? null : panelFor(ativo);

    editorWrap.classList.toggle('hidden', painelAtivo !== editorWrap);
    for (const painel of dynamicPanels.values()) {
      painel.classList.toggle('hidden', painel !== painelAtivo);
    }
    if (emptyState) emptyState.classList.toggle('hidden', ativo !== null);
    tabBar.classList.toggle('hidden', tabs.length === 0);
  }

  window.TabBar = {
    init(options) {
      store = options.store;
      onClose = options.onClose;
      store.onChange(render);
      render(store.list(), store.activeId());
    },
    /** Painel DOM de uma aba, criado sob demanda. */
    panelFor,
    ICONS,
  };
})();
