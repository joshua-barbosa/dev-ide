// Redimensionamento da barra lateral.
//
// Durante o arraste os eventos são capturados no documento, não na alça: se
// ficassem na alça, mover o mouse rápido "escaparia" dela e o arraste travaria.
(function () {
  'use strict';

  const LARGURA_MIN = 160;
  const LARGURA_PADRAO = 240;
  /** Espaço mínimo que sobra para o editor; impede engolir a área de trabalho. */
  const RESERVA_EDITOR = 320;
  const CHAVE = 'dev-ide.sidebar-width';

  const sidebar = document.getElementById('sidebar');
  const alca = document.getElementById('sidebar-resizer');

  function limitar(largura) {
    const maximo = Math.max(LARGURA_MIN, window.innerWidth - RESERVA_EDITOR);
    return Math.min(Math.max(largura, LARGURA_MIN), maximo);
  }

  function aplicar(largura) {
    const valor = limitar(largura);
    sidebar.style.width = valor + 'px';
    return valor;
  }

  function salvar(largura) {
    try {
      localStorage.setItem(CHAVE, String(largura));
    } catch {
      // Modo privativo ou storage cheio: a largura só não persiste.
    }
  }

  function restaurar() {
    try {
      const guardada = Number(localStorage.getItem(CHAVE));
      if (Number.isFinite(guardada) && guardada > 0) aplicar(guardada);
    } catch {
      // sem storage: fica o padrão do CSS
    }
  }

  let arrastando = false;

  alca.addEventListener('mousedown', (e) => {
    e.preventDefault(); // evita selecionar texto ao arrastar
    arrastando = true;
    document.body.classList.add('resizing');
  });

  document.addEventListener('mousemove', (e) => {
    if (!arrastando) return;
    // A largura é a distância até a borda esquerda da lateral, não o offsetX
    // da alça — assim o cursor não "desliza" em relação à borda.
    aplicar(e.clientX - sidebar.getBoundingClientRect().left);
  });

  document.addEventListener('mouseup', () => {
    if (!arrastando) return;
    arrastando = false;
    document.body.classList.remove('resizing');
    salvar(sidebar.getBoundingClientRect().width);
  });

  alca.addEventListener('dblclick', () => {
    salvar(aplicar(LARGURA_PADRAO));
  });

  // Janela menor pode deixar a lateral maior que o permitido.
  window.addEventListener('resize', () => {
    aplicar(sidebar.getBoundingClientRect().width);
  });

  restaurar();
})();
