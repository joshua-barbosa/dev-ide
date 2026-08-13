// Grid de resultados.
//
// Um só componente para todos os drivers: como QueryResult é o mesmo formato
// para SQL, Redis e Mongo, o grid não sabe de qual banco vieram as linhas.
(function () {
  'use strict';

  const MAX_LARGURA = 420;

  function render(painel, resultado, contexto) {
    painel.innerHTML = '';
    painel.className = 'tab-panel grid-panel';

    painel.appendChild(cabecalho(resultado, contexto));

    if (resultado.columns.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'grid-message';
      msg.textContent = resultado.message || 'Comando executado.';
      painel.appendChild(msg);
      return;
    }

    const rolagem = document.createElement('div');
    rolagem.className = 'grid-scroll';
    rolagem.appendChild(tabela(resultado));
    painel.appendChild(rolagem);
  }

  function cabecalho(resultado, contexto) {
    const barra = document.createElement('div');
    barra.className = 'grid-header';

    const info = document.createElement('span');
    const partes = [resultado.rowCount + ' linha(s)', resultado.durationMs + 'ms'];
    if (contexto && contexto.label) partes.unshift(contexto.label);
    info.textContent = partes.join(' · ');
    barra.appendChild(info);

    if (resultado.truncated) {
      const aviso = document.createElement('span');
      aviso.className = 'grid-truncated';
      // Importante deixar explícito: o usuário não pode confundir o corte com
      // o total real de linhas da tabela.
      aviso.textContent = '⚠ resultado cortado no limite de linhas';
      barra.appendChild(aviso);
    }
    return barra;
  }

  function tabela(resultado) {
    const table = document.createElement('table');
    table.className = 'grid-table';

    const thead = document.createElement('thead');
    const linhaCabecalho = document.createElement('tr');

    const cantoNum = document.createElement('th');
    cantoNum.className = 'grid-rownum';
    linhaCabecalho.appendChild(cantoNum);

    for (const coluna of resultado.columns) {
      const th = document.createElement('th');
      const nome = document.createElement('div');
      nome.className = 'grid-col-name';
      nome.textContent = coluna.name;
      th.appendChild(nome);
      if (coluna.type) {
        const tipo = document.createElement('div');
        tipo.className = 'grid-col-type';
        tipo.textContent = coluna.type;
        th.appendChild(tipo);
      }
      linhaCabecalho.appendChild(th);
    }
    thead.appendChild(linhaCabecalho);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    resultado.rows.forEach((linha, i) => {
      const tr = document.createElement('tr');

      const num = document.createElement('td');
      num.className = 'grid-rownum';
      num.textContent = String(i + 1);
      tr.appendChild(num);

      for (const valor of linha) {
        const td = document.createElement('td');
        if (valor === null) {
          td.className = 'grid-null';
          td.textContent = 'NULL';
        } else {
          td.textContent = String(valor);
          td.title = String(valor);
        }
        td.style.maxWidth = MAX_LARGURA + 'px';
        // Clique copia a célula: o caso mais comum é levar um id para a query.
        td.addEventListener('click', () => {
          if (navigator.clipboard) navigator.clipboard.writeText(valor === null ? '' : String(valor));
          td.classList.add('copiado');
          setTimeout(() => td.classList.remove('copiado'), 400);
        });
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function erro(painel, mensagem) {
    painel.innerHTML = '';
    painel.className = 'tab-panel grid-panel';
    const div = document.createElement('div');
    div.className = 'grid-message grid-error';
    div.textContent = mensagem;
    painel.appendChild(div);
  }

  function carregando(painel) {
    painel.innerHTML = '';
    painel.className = 'tab-panel grid-panel';
    const div = document.createElement('div');
    div.className = 'grid-message';
    div.textContent = 'executando…';
    painel.appendChild(div);
  }

  window.Grid = { render: render, erro: erro, carregando: carregando };
})();
