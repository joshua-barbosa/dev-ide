// Painéis Database e Service.
//
// Os dois são o MESMO componente, montado duas vezes com um filtro diferente.
// Quem decide o painel é o próprio driver, pelo campo `panel` — não dá para
// derivar do protocolo: Redis é chave-valor e Pinecone é vetorial, mas os dois
// são armazenamento de dados e vão para Database, enquanto SSH e FTP são
// infraestrutura e vão para Service. Nenhum tipo está escrito aqui dentro.
(function () {
  'use strict';

  const ICONES = {
    server: '🖥', database: '🗄', schema: '📚', table: '▦', view: '👁',
    column: '▸', function: 'ƒ', procedure: '⚙', index: '🔑', collection: '📦',
    key: '🔑', folder: '📁', file: '📄', link: '🔗', query: '🗒',
  };

  let driversPorTipo = new Map();
  let onAbrirQuery = null;
  let onAbrirAcao = null;
  let onEditarConexao = null;
  const paineis = [];

  function criarPainel(elemento, painelAlvo) {
    const painel = {
      elemento: elemento,
      painelAlvo: painelAlvo,
      // Caminhos expandidos, para redesenhar sem perder o que estava aberto.
      expandidos: new Set(),
      // Cache de filhos por chave de caminho, evitando ir ao servidor de novo.
      filhos: new Map(),
      conexoes: [],
      abertas: new Set(),
    };
    paineis.push(painel);
    return painel;
  }

  const chaveDe = (id, caminho) => id + ' ' + caminho.join(' ');

  // ---- menu de contexto (botao direito) ----

  let menuAberto = null;

  function fecharMenu() {
    if (menuAberto !== null) {
      menuAberto.remove();
      menuAberto = null;
    }
  }

  document.addEventListener('click', fecharMenu);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') fecharMenu();
  });

  /** `itens` e [{ label, danger?, onClick }]; `null` vira separador. */
  function abrirMenu(x, y, itens) {
    fecharMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';

    for (const item of itens) {
      if (item === null) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
        continue;
      }
      const opcao = document.createElement('div');
      opcao.className = 'ctx-item' + (item.danger ? ' danger' : '');
      opcao.textContent = item.label;
      opcao.addEventListener('click', function (e) {
        e.stopPropagation();
        fecharMenu();
        Promise.resolve(item.onClick()).catch(function (err) { alert(err.message); });
      });
      menu.appendChild(opcao);
    }

    // Renderiza fora da tela para medir, depois corrige se transbordar a janela.
    menu.style.left = '-9999px';
    menu.style.top = '0';
    document.body.appendChild(menu);
    const caixa = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - caixa.width - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - caixa.height - 4) + 'px';
    menuAberto = menu;
  }

  function copiar(texto) {
    return navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.resolve();
  }

  function tipoEhAceito(painel, tipo) {
    const driver = driversPorTipo.get(tipo);
    // Tipo desconhecido (driver removido, conexão antiga) cai em Service, para
    // a conexão continuar visível em vez de sumir sem explicação.
    const alvo = driver === undefined ? 'service' : driver.panel;
    return alvo === painel.painelAlvo;
  }

  // ---- estado do cofre ----

  function barraDeAcoes(estado) {
    const barra = document.createElement('div');
    barra.className = 'db-actions';

    if (!estado.exists) {
      barra.appendChild(botao('Criar cofre', criarCofre, 'Define a senha mestra que protege as credenciais'));
      return barra;
    }
    if (!estado.unlocked) {
      barra.appendChild(botao('Destrancar', destrancarCofre, 'O cofre destranca uma vez por execução do servidor'));
      return barra;
    }
    barra.appendChild(botao('+ conexão', novaConexao, 'Cadastrar uma conexão'));
    barra.appendChild(botao('↻', recarregar, 'Recarregar'));
    barra.appendChild(botao('🔒', trancarCofre, 'Trancar o cofre (fecha as sessões abertas)'));
    return barra;
  }

  function botao(texto, acao, titulo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    if (titulo) b.title = titulo;
    b.addEventListener('click', () => acao().catch((err) => alert(err.message)));
    return b;
  }

  async function criarCofre() {
    const senha = prompt('Defina a senha mestra do cofre.\nEla protege as credenciais e NÃO tem recuperação:');
    if (!senha) return;
    await window.Api.createVault(senha);
    await recarregar();
  }

  async function destrancarCofre() {
    const senha = prompt('Senha mestra:');
    if (!senha) return;
    await window.Api.unlockVault(senha);
    await recarregar();
  }

  async function trancarCofre() {
    await window.Api.lockVault();
    for (const painel of paineis) {
      painel.abertas.clear();
      painel.filhos.clear();
      painel.expandidos.clear();
    }
    await recarregar();
  }

  // ---- cadastro ----

  async function novaConexao() {
    const tipos = [...driversPorTipo.values()].map((d) => d.type).join(', ');
    const tipo = prompt('Tipo da conexão (' + tipos + '):', 'mysql');
    if (!tipo) return;

    const driver = driversPorTipo.get(tipo.trim());
    if (driver === undefined) throw new Error('Tipo desconhecido: ' + tipo);

    const label = prompt('Nome da conexão:');
    if (!label) return;
    const grupo = prompt('Grupo (use "/" para subgrupos, ex.: ACME/Bancos):', '') || '';

    // Formulário dirigido pelos metadados do driver — nenhum campo hardcoded.
    const fields = {};
    for (const campo of driver.fields) {
      const obrigatorio = campo.required === true;
      const padrao = campo.default === undefined ? '' : String(campo.default);
      const dica = [campo.label, campo.help ? '\n' + campo.help : ''].join('');
      const rotulo = dica + (obrigatorio ? '\n(obrigatório)' : '\n(opcional — deixe vazio para o padrão)');

      const valor = campo.type === 'password'
        ? prompt(rotulo, '')
        : prompt(rotulo + (campo.options ? '\nValores: ' + campo.options.map((o) => o.value).join(', ') : ''), padrao);

      if (valor === null) return; // cancelou
      if (valor !== '') fields[campo.name] = valor;
      else if (obrigatorio && padrao === '') throw new Error('O campo "' + campo.label + '" é obrigatório.');
    }

    const somenteLeitura = confirm('Abrir esta conexão em SOMENTE-LEITURA?\n\nRecomendado para produção: o servidor recusa qualquer escrita.');
    await window.Api.createConnection({
      type: driver.type,
      label: label.trim(),
      group: grupo.trim(),
      readOnly: somenteLeitura,
      fields: fields,
    });
    await recarregar();
  }

  // ---- árvore ----

  function linha(nivel, opcoes) {
    const item = document.createElement('div');
    item.className = 'tree-item' + (opcoes.classe ? ' ' + opcoes.classe : '');
    item.style.paddingLeft = 4 + nivel * 12 + 'px';
    if (opcoes.titulo) item.title = opcoes.titulo;

    const seta = document.createElement('span');
    seta.className = 'tree-arrow';
    seta.textContent = opcoes.expansivel ? (opcoes.aberto ? '▾' : '▸') : ' ';

    const icone = document.createElement('span');
    icone.className = 'tree-icon';
    icone.textContent = opcoes.icone || '';

    const nome = document.createElement('span');
    nome.className = 'tree-name';
    nome.textContent = opcoes.rotulo;

    item.append(seta, icone, nome);

    if (opcoes.detalhe) {
      const detalhe = document.createElement('span');
      detalhe.className = 'tree-detail';
      detalhe.textContent = opcoes.detalhe;
      item.appendChild(detalhe);
    }
    if (opcoes.onClick) item.addEventListener('click', opcoes.onClick);
    if (opcoes.onMenu) {
      item.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        opcoes.onMenu(e);
      });
    }
    return item;
  }

  /**
   * Um grupo só aparece se houver, nele ou em algum descendente, uma conexão
   * do painel. Sem isso, "ACME" apareceria vazio no Service só porque tem
   * bancos dentro — pasta vazia é ruído.
   */
  function temConteudo(painel, grupo) {
    if (grupo.connections.some((c) => tipoEhAceito(painel, c.type))) return true;
    return grupo.groups.some((sub) => temConteudo(painel, sub));
  }

  function renderGrupo(painel, grupo, nivel, destino) {
    for (const sub of grupo.groups) {
      if (!temConteudo(painel, sub)) continue;
      const caminho = 'grupo:' + sub.path;
      const aberto = painel.expandidos.has(caminho);
      destino.appendChild(
        linha(nivel, {
          rotulo: sub.name,
          icone: '📁',
          expansivel: true,
          aberto: aberto,
          classe: 'tree-dir',
          onClick: () => {
            alternar(painel, caminho);
            desenhar(painel);
          },
        })
      );
      if (aberto) renderGrupo(painel, sub, nivel + 1, destino);
    }

    for (const conexao of grupo.connections) {
      if (!tipoEhAceito(painel, conexao.type)) continue;
      renderConexao(painel, conexao, nivel, destino);
    }
  }

  function renderConexao(painel, conexao, nivel, destino) {
    const caminho = 'conn:' + conexao.id;
    const aberto = painel.expandidos.has(caminho);
    const driver = driversPorTipo.get(conexao.type);

    destino.appendChild(
      linha(nivel, {
        rotulo: conexao.label,
        icone: painel.abertas.has(conexao.id) ? '🟢' : (driver ? ICONES[driver.icon] : '🔌'),
        detalhe: conexao.readOnly ? 'RO' : '',
        titulo: conexao.type + (conexao.fields.host ? ' · ' + conexao.fields.host : ''),
        expansivel: true,
        aberto: aberto,
        onClick: () => abrirConexao(painel, conexao),
        onMenu: (e) => menuDaConexao(e, painel, conexao),
      })
    );

    if (aberto) renderNos(painel, conexao.id, [], nivel + 1, destino);
  }

  function renderNos(painel, id, caminho, nivel, destino) {
    const nos = painel.filhos.get(chaveDe(id, caminho));
    if (nos === undefined) {
      destino.appendChild(linha(nivel, { rotulo: 'carregando…', classe: 'tree-dim' }));
      return;
    }
    if (nos.length === 0) {
      destino.appendChild(linha(nivel, { rotulo: '(vazio)', classe: 'tree-dim' }));
      return;
    }

    for (const no of nos) {
      const filho = caminho.concat([no.id]);
      const chave = 'no:' + chaveDe(id, filho);
      const aberto = painel.expandidos.has(chave);

      destino.appendChild(
        linha(nivel, {
          rotulo: no.label,
          icone: ICONES[no.icon] || '•',
          detalhe: no.detail,
          expansivel: no.hasChildren,
          aberto: aberto,
          titulo: no.hasChildren ? '' : 'Clique duplo abre uma query',
          onMenu: (e) => menuDoNo(e, id, filho, no),
          onClick: (e) => {
            if (no.hasChildren) {
              alternarNo(painel, id, filho, chave);
            } else if (onAbrirQuery && no.meta && no.meta.object) {
              onAbrirQuery(id, no);
            }
            e.stopPropagation();
          },
        })
      );

      // Tabela/view: clique com o botão direito abre a query de SELECT.
      if (no.actions && no.actions.length > 0 && onAbrirQuery) {
        const ultimo = destino.lastElementChild;
        ultimo.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          onAbrirQuery(id, no);
        });
      }

      if (aberto) renderNos(painel, id, filho, nivel + 1, destino);
    }
  }


  // ---- menus ----

  /**
   * As opcoes vem do proprio no: o driver declara `actions`, e o backend
   * executa cada uma em /:id/action. Copiar nome e o unico item local.
   */
  function menuDoNo(evento, connectionId, caminho, no) {
    const itens = [
      { label: 'Copiar nome', onClick: () => copiar(no.label) },
    ];

    if ((no.actions || []).length > 0) itens.push(null);

    for (const acao of no.actions || []) {
      itens.push({
        label: acao.label,
        danger: acao.danger === true,
        onClick: async () => {
          if (acao.danger === true && !confirm('"' + acao.label + '" em ' + no.label + '.\n\nConfirmar?')) return;
          const resultado = await window.Api.runAction(connectionId, {
            nodePath: caminho,
            actionId: acao.id,
          });
          if (onAbrirAcao) onAbrirAcao(connectionId, resultado);
        },
      });
    }
    abrirMenu(evento.clientX, evento.clientY, itens);
  }

  function menuDaConexao(evento, painel, conexao) {
    abrirMenu(evento.clientX, evento.clientY, [
      { label: 'Copiar nome', onClick: () => copiar(conexao.label) },
      { label: painel.abertas.has(conexao.id) ? 'Desconectar' : 'Conectar', onClick: async () => {
        if (painel.abertas.has(conexao.id)) {
          await window.Api.disconnect(conexao.id);
          painel.expandidos.delete('conn:' + conexao.id);
          painel.filhos.clear();
          await recarregar();
        } else {
          await abrirConexao(painel, conexao);
        }
      } },
      { label: 'Recarregar metadados', onClick: async () => {
        painel.filhos.clear();
        const nos = await window.Api.children(conexao.id, []);
        painel.filhos.set(chaveDe(conexao.id, []), nos);
        desenhar(painel);
      } },
      null,
      { label: 'Editar conexao\u2026', onClick: () => { if (onEditarConexao) onEditarConexao(conexao); } },
      { label: 'Excluir conexao', danger: true, onClick: async () => {
        if (!confirm('Excluir a conexao "' + conexao.label + '"?\n\nA credencial cifrada sera removida do cofre.')) return;
        await window.Api.deleteConnection(conexao.id);
        await recarregar();
      } },
    ]);
  }

  // ---- interação ----

  function alternar(painel, chave) {
    if (painel.expandidos.has(chave)) painel.expandidos.delete(chave);
    else painel.expandidos.add(chave);
  }

  /**
   * Garante o cofre destrancado, pedindo a senha na hora se preciso.
   * Devolve false se o usuário cancelou — aí a ação chamadora só desiste, sem
   * jogar um erro na cara de quem já sabe que o cofre está trancado.
   */
  async function garantirDestrancado(painel) {
    if (painel.estado && painel.estado.unlocked) return true;

    const senha = prompt('O cofre está trancado.\nSenha mestra para destrancar:');
    if (!senha) return false;
    await window.Api.unlockVault(senha);
    await recarregar();
    return true;
  }

  async function abrirConexao(painel, conexao) {
    const chave = 'conn:' + conexao.id;
    if (painel.expandidos.has(chave)) {
      painel.expandidos.delete(chave);
      desenhar(painel);
      return;
    }

    // Destrancar antes de expandir: clicar numa conexão é a intenção clara de
    // usá-la, então pedir a senha aqui é mais direto que recusar e mandar o
    // usuário procurar o botão.
    try {
      if (!(await garantirDestrancado(painel))) return;
    } catch (err) {
      alert(err.message);
      return;
    }

    painel.expandidos.add(chave);
    desenhar(painel);

    try {
      await window.Api.connect(conexao.id);
      painel.abertas.add(conexao.id);
      const nos = await window.Api.children(conexao.id, []);
      painel.filhos.set(chaveDe(conexao.id, []), nos);
    } catch (err) {
      painel.expandidos.delete(chave);
      alert('Não foi possível conectar em "' + conexao.label + '":\n\n' + err.message);
    }
    desenhar(painel);
  }

  async function alternarNo(painel, id, caminho, chave) {
    if (painel.expandidos.has(chave)) {
      painel.expandidos.delete(chave);
      desenhar(painel);
      return;
    }
    painel.expandidos.add(chave);
    desenhar(painel);

    if (!painel.filhos.has(chaveDe(id, caminho))) {
      try {
        painel.filhos.set(chaveDe(id, caminho), await window.Api.children(id, caminho));
      } catch (err) {
        painel.expandidos.delete(chave);
        alert(err.message);
      }
    }
    desenhar(painel);
  }

  // ---- desenho ----

  function desenhar(painel) {
    painel.elemento.innerHTML = '';
    painel.elemento.appendChild(barraDeAcoes(painel.estado || { exists: false, unlocked: false }));

    if (painel.estado && !painel.estado.exists) {
      painel.elemento.appendChild(aviso('Nenhum cofre ainda. Crie um para guardar credenciais cifradas.'));
      return;
    }
    // O aviso vem ANTES da árvore: é a informação que explica por que clicar
    // numa conexão vai pedir senha.
    if (painel.estado && !painel.estado.unlocked) {
      painel.elemento.appendChild(aviso('🔒 Cofre trancado — clicar numa conexão pede a senha mestra.'));
    }
    if (painel.arvore === undefined) return;

    const corpo = document.createElement('div');
    renderGrupo(painel, painel.arvore, 0, corpo);
    painel.elemento.appendChild(corpo);

    if (corpo.children.length === 0) {
      painel.elemento.appendChild(aviso('Nenhuma conexão deste tipo. Use "+ conexão".'));
    }
  }

  function aviso(texto) {
    const div = document.createElement('div');
    div.className = 'db-hint';
    div.textContent = texto;
    return div;
  }

  async function recarregar() {
    const dados = await window.Api.connections();
    for (const painel of paineis) {
      painel.estado = dados.vault;
      painel.arvore = dados.tree;
      painel.abertas = new Set(dados.openIds);
      desenhar(painel);
    }
  }

  window.Connections = {
    async init(opcoes) {
      onAbrirQuery = opcoes.onAbrirQuery;
      onAbrirAcao = opcoes.onAbrirAcao;
      onEditarConexao = opcoes.onEditarConexao;
      criarPainel(document.getElementById('panel-database'), 'database');
      criarPainel(document.getElementById('panel-service'), 'service');

      const drivers = await window.Api.drivers();
      driversPorTipo = new Map(drivers.map((d) => [d.type, d]));
      await recarregar();
    },
    recarregar: recarregar,
  };
})();
