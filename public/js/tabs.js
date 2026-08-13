// Store das abas do editor.
//
// Só estado — nenhum DOM. A renderização fica em tabbar.js, que se inscreve em
// onChange. Essa separação é o que permite testar as regras chatas (qual aba
// fica ativa depois de fechar, não duplicar aba já aberta, preservar "dirty")
// em node, sem navegador.
//
// O rabo UMD existe porque o frontend não tem bundler: no navegador vira
// window.createTabStore, e nos testes vira require().
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.createTabStore = api.createTabStore;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function createTabStore() {
    var tabs = [];
    var activeId = null;
    var listeners = [];

    function indexOf(id) {
      for (var i = 0; i < tabs.length; i += 1) {
        if (tabs[i].id === id) return i;
      }
      return -1;
    }

    function notify() {
      var snapshot = list();
      // Um listener quebrado não pode impedir os demais de atualizarem a UI.
      for (var i = 0; i < listeners.length; i += 1) {
        try {
          listeners[i](snapshot, activeId);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('listener de abas falhou:', err);
        }
      }
    }

    function list() {
      return tabs.slice();
    }

    function get(id) {
      var i = indexOf(id);
      return i === -1 ? null : tabs[i];
    }

    function open(input) {
      var existente = indexOf(input.id);
      if (existente !== -1) {
        // Já aberta: foca, preservando o estado (conteúdo, dirty, cursor).
        activeId = input.id;
        notify();
        return tabs[existente];
      }
      var aba = {
        id: input.id,
        type: input.type,
        title: input.title,
        icon: input.icon,
        dirty: input.dirty === true,
        meta: input.meta || {},
      };
      tabs = tabs.concat([aba]);
      activeId = aba.id;
      notify();
      return aba;
    }

    function close(id) {
      var i = indexOf(id);
      if (i === -1) return;

      var fechandoAtiva = activeId === id;
      tabs = tabs.slice(0, i).concat(tabs.slice(i + 1));

      if (fechandoAtiva) {
        // Vizinha à direita; se não houver, a da esquerda; se não houver, nenhuma.
        var proxima = tabs[i] || tabs[i - 1] || null;
        activeId = proxima === null ? null : proxima.id;
      }
      notify();
    }

    function activate(id) {
      if (indexOf(id) === -1 || activeId === id) return;
      activeId = id;
      notify();
    }

    function update(id, patch) {
      var i = indexOf(id);
      if (i === -1) return null;

      // Cria uma aba nova em vez de mutar: quem guardou a referência anterior
      // continua vendo o estado antigo, sem surpresa.
      var atual = tabs[i];
      var nova = {
        id: atual.id,
        type: patch.type === undefined ? atual.type : patch.type,
        title: patch.title === undefined ? atual.title : patch.title,
        icon: patch.icon === undefined ? atual.icon : patch.icon,
        dirty: patch.dirty === undefined ? atual.dirty : patch.dirty === true,
        meta: patch.meta === undefined ? atual.meta : patch.meta,
      };
      tabs = tabs.slice(0, i).concat([nova], tabs.slice(i + 1));
      notify();
      return nova;
    }

    function onChange(listener) {
      listeners = listeners.concat([listener]);
      return function cancelar() {
        listeners = listeners.filter(function (item) {
          return item !== listener;
        });
      };
    }

    return {
      list: list,
      get: get,
      activeId: function () {
        return activeId;
      },
      active: function () {
        return activeId === null ? null : get(activeId);
      },
      open: open,
      close: close,
      activate: activate,
      update: update,
      onChange: onChange,
    };
  }

  return { createTabStore: createTabStore };
});
