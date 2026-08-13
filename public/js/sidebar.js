// Painel lateral: árvore de arquivos do projeto e lista de símbolos
// (variáveis, constantes, objetos, classes e funções) dos arquivos salvos.
(function () {
  'use strict';

  const panelFiles = document.getElementById('panel-files');
  const panelSymbols = document.getElementById('panel-symbols');

  // Abas da lateral são dirigidas por data-panel, não por ids fixos: adicionar
  // uma aba nova é só acrescentar o botão e o painel no HTML.
  const tabButtons = [...document.querySelectorAll('.sidebar-tabs button')];
  const tabPanels = [...document.querySelectorAll('.sidebar-panel')];

  const KIND_LABEL = {
    class: 'C', function: 'ƒ', method: 'm', const: 'K',
    variable: 'v', object: 'O', interface: 'I', enum: 'E',
  };
  const KIND_TITLE = {
    class: 'Classes', function: 'Funções', method: 'Métodos', const: 'Constantes',
    variable: 'Variáveis', object: 'Objetos', interface: 'Interfaces', enum: 'Enums',
  };
  const KIND_ORDER = ['class', 'interface', 'enum', 'function', 'method', 'object', 'const', 'variable'];

  let onOpenFile = null; // (path) => void
  let onOpenSymbol = null; // (path, line) => void
  let activePath = null;

  for (const botao of tabButtons) {
    botao.addEventListener('click', () => switchTab(botao.dataset.panel));
  }

  function switchTab(which) {
    for (const botao of tabButtons) {
      botao.classList.toggle('active', botao.dataset.panel === which);
    }
    for (const painel of tabPanels) {
      painel.classList.toggle('hidden', painel.dataset.panel !== which);
    }
  }

  function renderTree(nodes) {
    panelFiles.innerHTML = '';
    if (!nodes || nodes.length === 0) {
      panelFiles.innerHTML =
        '<div class="tree-item tree-dir">projeto vazio — crie um arquivo</div>';
      return;
    }
    panelFiles.appendChild(buildTree(nodes));
  }

  function buildTree(nodes) {
    const container = document.createDocumentFragment();
    for (const node of nodes) {
      const item = document.createElement('div');
      item.className = 'tree-item' + (node.type === 'dir' ? ' tree-dir' : '');
      item.textContent = (node.type === 'dir' ? '📁 ' : '📄 ') + node.name;
      item.dataset.path = node.path;
      if (node.path === activePath) item.classList.add('active');
      container.appendChild(item);
      if (node.type === 'dir') {
        const children = document.createElement('div');
        children.className = 'tree-children';
        children.appendChild(buildTree(node.children || []));
        container.appendChild(children);
        item.addEventListener('click', () => children.classList.toggle('hidden'));
      } else {
        item.addEventListener('click', () => onOpenFile && onOpenFile(node.path));
      }
    }
    return container;
  }

  function renderSymbols(symbols) {
    panelSymbols.innerHTML = '';
    if (!symbols || symbols.length === 0) {
      panelSymbols.innerHTML =
        '<div class="sym-group-title">nenhum símbolo — salve arquivos .js/.ts/.py no projeto</div>';
      return;
    }
    const byKind = new Map();
    for (const sym of symbols) {
      if (!byKind.has(sym.kind)) byKind.set(sym.kind, []);
      byKind.get(sym.kind).push(sym);
    }
    for (const kind of KIND_ORDER) {
      const group = byKind.get(kind);
      if (!group) continue;
      const title = document.createElement('div');
      title.className = 'sym-group-title';
      title.textContent = KIND_TITLE[kind] || kind;
      panelSymbols.appendChild(title);
      for (const sym of group.sort((a, b) => a.name.localeCompare(b.name))) {
        panelSymbols.appendChild(symbolItem(sym));
      }
    }
  }

  function symbolItem(sym) {
    const item = document.createElement('div');
    item.className = 'sym-item';
    item.title = `${sym.file}:${sym.line}`;

    const badge = document.createElement('span');
    badge.className = 'sym-badge ' + sym.kind;
    badge.textContent = KIND_LABEL[sym.kind] || '?';

    const name = document.createElement('span');
    name.textContent = sym.name;

    const file = document.createElement('span');
    file.className = 'sym-file';
    file.textContent = sym.file.split('/').pop() + ':' + sym.line;

    item.append(badge, name, file);
    item.addEventListener('click', () => onOpenSymbol && onOpenSymbol(sym.file, sym.line));
    return item;
  }

  window.Sidebar = {
    renderTree,
    renderSymbols,
    setActivePath(path) {
      activePath = path;
      panelFiles.querySelectorAll('.tree-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.path === path);
      });
    },
    onOpenFile(fn) { onOpenFile = fn; },
    onOpenSymbol(fn) { onOpenSymbol = fn; },
    showTab: switchTab,
    showSymbolsTab: () => switchTab('symbols'),
  };
})();
