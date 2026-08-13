// Editor: textarea transparente sobreposta a uma camada de highlight,
// com números de linha sincronizados e suporte a Tab.
(function () {
  'use strict';

  const textarea = document.getElementById('editor');
  const highlightLayer = document.getElementById('highlight-layer');
  const highlightCode = document.getElementById('highlight-code');
  const lineNumbers = document.getElementById('line-numbers');
  const statusCursor = document.getElementById('status-cursor');

  let language = 'javascript';
  let onChange = null;

  function render() {
    const code = textarea.value;
    // "\n" final extra para a camada de highlight acompanhar a última linha vazia
    highlightCode.innerHTML = window.Highlighter.highlight(code + '\n', language);
    renderLineNumbers(code);
    syncScroll();
  }

  function renderLineNumbers(code) {
    const count = code.split('\n').length;
    const nums = [];
    for (let i = 1; i <= count; i++) nums.push(i);
    lineNumbers.textContent = nums.join('\n');
  }

  function syncScroll() {
    highlightLayer.scrollTop = textarea.scrollTop;
    highlightLayer.scrollLeft = textarea.scrollLeft;
    lineNumbers.scrollTop = textarea.scrollTop;
  }

  function updateCursorStatus() {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    statusCursor.textContent = `Ln ${line}, Col ${col}`;
  }

  textarea.addEventListener('input', () => {
    render();
    if (onChange) onChange();
  });
  textarea.addEventListener('scroll', syncScroll);
  ['keyup', 'click', 'input'].forEach((ev) =>
    textarea.addEventListener(ev, updateCursorStatus)
  );

  // Tab insere 4 espaços em vez de sair do editor
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      textarea.value = value.slice(0, start) + '    ' + value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + 4;
      render();
      if (onChange) onChange();
    }
  });

  window.Editor = {
    getValue: () => textarea.value,
    setValue(value) {
      textarea.value = value;
      render();
      updateCursorStatus();
    },
    getSelection() {
      return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    },
    setLanguage(lang) {
      language = window.LANGUAGES[lang] ? lang : 'plain';
      document.body.dataset.lang = language;
      render();
    },
    getLanguage: () => language,
    goToLine(line) {
      const lines = textarea.value.split('\n');
      let pos = 0;
      for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
      textarea.focus();
      textarea.setSelectionRange(pos, pos + (lines[line - 1] ? lines[line - 1].length : 0));
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 19;
      textarea.scrollTop = Math.max(0, (line - 5) * lineHeight);
      syncScroll();
      updateCursorStatus();
    },
    focus: () => textarea.focus(),
    onChange(fn) { onChange = fn; },

    // Cursor e rolagem são guardados por aba: trocar de aba e voltar precisa
    // devolver o arquivo exatamente onde estava.
    getViewState() {
      return {
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
        scrollTop: textarea.scrollTop,
        scrollLeft: textarea.scrollLeft,
      };
    },
    setViewState(view) {
      if (!view) return;
      textarea.setSelectionRange(view.selectionStart || 0, view.selectionEnd || 0);
      textarea.scrollTop = view.scrollTop || 0;
      textarea.scrollLeft = view.scrollLeft || 0;
      syncScroll();
      updateCursorStatus();
    },
  };

  render();
})();
