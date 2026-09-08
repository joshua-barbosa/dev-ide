// Os itens de menu das ações, gerados da MESMA lista que registra os comandos.
//
// Digitar 37 entradas duas vezes — uma no `acoesDoMenu.ts`, outra no
// `package.json` — é garantir que as duas divirjam. Aqui elas têm uma fonte só,
// e o script roda no `build:extensao`, antes do empacotamento.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const PACOTE = path.join(RAIZ, 'package.json');

// Lido do FONTE, não do `dist`: o script roda antes do `tsc`.
const fonte = readFileSync(path.join(RAIZ, 'src', 'acoesDoMenu.ts'), 'utf8');
const acoes = [...fonte.matchAll(
  /\{\s*id:\s*'([^']+)',\s*rotulo:\s*'([^']+)',\s*grupo:\s*'([^']+)'\s*\}/g
)].map(([, id, rotulo, grupo]) => ({ id, rotulo, grupo }));

if (acoes.length === 0) {
  console.error('gerar-menus: nenhuma ação lida de src/acoesDoMenu.ts');
  process.exit(1);
}

const pacote = JSON.parse(readFileSync(PACOTE, 'utf8'));
const contribui = pacote.contributes;

// Comandos: os que não são de ação ficam como estão; os de ação são refeitos.
const outros = contribui.commands.filter((c) => !c.command.startsWith('braytech.acao.'));
contribui.commands = [
  ...outros,
  ...acoes.map((a) => ({ command: `braytech.acao.${a.id}`, title: `Braytech: ${a.rotulo}` })),
];

// Colchetes delimitam de propósito: sem eles `drop` casaria em `drop-view`.
const quando = (id) => `viewItem =~ /\\[${id.replace(/-/g, '\\-')}\\]/`;
// **Os itens que não vêm do driver.**
//
// Ele viu que faltavam: *"aquelas opções de menu, as opções quando coloca o
// mouse em cima, quando clica"*. As ações do driver são a MINORIA do menu — o
// resto é isto, e é o que a IDE oferece no botão direito de uma conexão, de um
// nó e de um arquivo remoto.
//
// `inline` é o que aparece ao passar o MOUSE, como ícone na própria linha. São
// os mesmos quatro da IDE (`AcoesDaLinhaRemota`): recarregar, baixar, executar
// e enviar.
// **O inventário FECHADO do painel da IDE.**
//
// 27 afordâncias, extraídas do `ConnectionsPanel`, do `AcoesDaLinhaRemota` e do
// `AcaoDoImportar` — não lembradas. Ele disse *"estou falando com um disco
// travado"*, e estava certo: eu vinha achando uma família por vez, com ele
// olhando a tela.
//
// `titulo: true`  -> ícone na BARRA DO TOPO da lateral (`view/title`)
// `inline: true`  -> ícone que aparece no HOVER da linha
// sem os dois     -> item do botão direito
//
// `Recolher tudo` não está aqui de propósito: o `showCollapseAll` da `TreeView`
// já o desenha, e declará-lo daria dois ícones iguais.
const NAS_DUAS = "view == braytech.databases.arvore || view == braytech.servicos.arvore";
const FIXOS = [
  // --- barra do topo ---
  { cmd: 'novaConexao', t: 'Nova conexão', icone: '$(add)', when: NAS_DUAS, titulo: true, g: '1' },
  { cmd: 'trocarSenhaMestra', t: 'Trocar a senha mestra', icone: '$(key)',
    when: NAS_DUAS, titulo: true, g: '2' },
  { cmd: 'importarConexoes', t: 'Importar conexões de um arquivo', icone: '$(cloud-upload)',
    when: NAS_DUAS, titulo: true, g: '3' },
  { cmd: 'exportarConexoes', t: 'Exportar conexões COM as senhas', icone: '$(cloud-download)',
    when: NAS_DUAS, titulo: true, g: '4' },
  { cmd: 'alternarCofre', t: 'Trancar / destrancar o cofre', icone: '$(lock)',
    when: NAS_DUAS, titulo: true, g: '5' },

  // --- grupo (pasta) ---
  { cmd: 'renomearGrupo', t: 'Renomear grupo', icone: '$(edit)',
    when: 'viewItem =~ /braytech\\.grupo/', g: '9_editar', inline: true },
  { cmd: 'novaConexaoNoGrupo', t: 'Nova conexão neste grupo', icone: '$(add)',
    when: 'viewItem =~ /braytech\\.grupo/', g: '4_criar', inline: true },

  // --- conexão ---
  { cmd: 'copiarNome', t: 'Copiar nome', when: 'viewItem =~ /braytech\\.conexao/', g: '1_copiar' },
  { cmd: 'conectar', t: 'Conectar', when: 'viewItem =~ /braytech\\.conexao\\.fechada/', g: '2_estado' },
  { cmd: 'desconectar', t: 'Desconectar', when: 'viewItem =~ /braytech\\.conexao\\.aberta/', g: '2_estado' },
  { cmd: 'recarregarConexao', t: 'Recarregar metadados', icone: '$(refresh)',
    when: 'viewItem =~ /braytech\\.conexao/', g: '2_estado', inline: true },
  // Só onde o DRIVER diz que há arquivos / terminal — a mesma condição do
  // painel (`driver?.kind === 'files'`, `driver?.hasTerminal === true`). Sem
  // ela os dois apareciam em conexão de banco, onde a aba não tem nada dentro.
  { cmd: 'abrirServidorDaConexao', t: 'Abrir numa aba', icone: '$(server)',
    when: 'viewItem =~ /\\.comArquivos/', g: '3_ver', inline: true },
  { cmd: 'abrirTerminalDaConexao', t: 'Abrir no terminal', icone: '$(terminal)',
    when: 'viewItem =~ /\\.comTerminal/', g: '3_ver', inline: true },
  { cmd: 'verProcessos', t: 'Ver processos…', when: 'viewItem =~ /braytech\\.conexao/', g: '3_ver' },
  { cmd: 'editarConexao', t: 'Editar conexão…', when: 'viewItem =~ /braytech\\.conexao/', g: '9_editar' },
  { cmd: 'excluirConexao', t: 'Excluir conexão', icone: '$(trash)',
    when: 'viewItem =~ /braytech\\.conexao/', g: '9_editar', inline: true },

  // --- nó de banco ---
  { cmd: 'copiarNomeDoNo', t: 'Copiar nome', when: 'viewItem =~ /braytech\\.no/', g: '1_copiar',
    real: 'copiarNome' },
  { cmd: 'abrirTabelaDoNo', t: 'Abrir tabela', icone: '$(table)',
    when: 'viewItem =~ /\\.tabela/', g: '3_ver', inline: true, real: 'abrirNo' },
  { cmd: 'abrirQueryNoDatabase', t: 'Abrir Query', icone: '$(new-file)',
    when: 'viewItem =~ /\\.database/', g: '4_criar', inline: true },
  { cmd: 'diagramaEr', t: 'Diagrama ER', icone: '$(type-hierarchy)',
    when: 'viewItem =~ /\\.er(\\.|$|\\[)/', g: '3_ver', inline: true },
  { cmd: 'diagramaDaTabela', t: 'Diagrama desta tabela', when: 'viewItem =~ /\\.erTabela/', g: '3_ver' },
  { cmd: 'recarregarNo', t: 'Recarregar', icone: '$(refresh)',
    when: 'viewItem =~ /\\.categoria/', g: '2_estado', inline: true },
  { cmd: 'filtrarCategoria', t: 'Filtrar', icone: '$(filter)',
    when: 'viewItem =~ /\\.categoria/', g: '3_ver', inline: true },
  { cmd: 'criarObjeto', t: 'Criar aqui…', icone: '$(add)',
    when: 'viewItem =~ /\\.template/', g: '4_criar', inline: true },
  // O `+` PERGUNTA o tipo, como na IDE — os dois diretos ficam no botão
  // direito, para quem já sabe o que quer.
  { cmd: 'novaQuery', t: 'Nova query — SQL ou Query Book', icone: '$(add)',
    when: 'viewItem =~ /\\.queries/', g: '4_criar', inline: true },
  { cmd: 'novaQuerySql', t: 'Nova query SQL…', when: 'viewItem =~ /\\.queries/', g: '4_criar' },
  { cmd: 'novoQueryBook', t: 'Novo Query Book…', when: 'viewItem =~ /\\.queries/', g: '4_criar' },

  // --- arquivo de query ---
  { cmd: 'renomearQuery', t: 'Renomear…', icone: '$(edit)',
    when: 'viewItem =~ /\\.arquivoDeQuery/', g: '9_editar', inline: true },
  { cmd: 'apagarQuery', t: 'Apagar', icone: '$(trash)',
    when: 'viewItem =~ /\\.arquivoDeQuery/', g: '9_editar', inline: true },

  // --- arquivo e pasta remotos (spec 053) ---
  { cmd: 'copiarCaminho', t: 'Copiar caminho',
    when: 'viewItem =~ /(pastaRemota|arquivoRemoto)/', g: '1_copiar' },
  { cmd: 'novoArquivoRemoto', t: 'Novo arquivo…', when: 'viewItem =~ /pastaRemota/', g: '4_criar' },
  { cmd: 'novaPastaRemota', t: 'Nova pasta…', when: 'viewItem =~ /pastaRemota/', g: '4_criar' },
  { cmd: 'renomearRemoto', t: 'Renomear…',
    when: 'viewItem =~ /(pastaRemota|arquivoRemoto)/', g: '9_editar' },
  { cmd: 'apagarRemoto', t: 'Apagar',
    when: 'viewItem =~ /(pastaRemota|arquivoRemoto)/', g: '9_editar' },
  { cmd: 'recarregarRemoto', t: 'Recarregar', icone: '$(refresh)', real: 'recarregarNo',
    when: 'viewItem =~ /pastaRemota/', g: '2_estado', inline: true },
  { cmd: 'favoritarRemoto', t: 'Favoritar', icone: '$(star-empty)',
    when: 'viewItem =~ /(pastaRemota|arquivoRemoto)/', g: '3_ver', inline: true },
  { cmd: 'baixarRemoto', t: 'Baixar', icone: '$(cloud-download)',
    when: 'viewItem =~ /arquivoRemoto/', g: '5_transferir', inline: true },
  { cmd: 'executarRemoto', t: 'Executar no servidor…', icone: '$(play)',
    when: 'viewItem =~ /executavel/', g: '5_transferir', inline: true },
  { cmd: 'enviarArquivos', t: 'Enviar arquivos para esta pasta', icone: '$(cloud-upload)',
    when: 'viewItem =~ /pastaRemota/', g: '5_transferir', inline: true },
];


// Preserva o que NÃO é ação (o `Enviar arquivos`, por exemplo): o gerador é
// dono das entradas `braytech.acao.*` e de mais nada.
const nomeReal = (f) => `braytech.${f.real ?? f.cmd}`;
const fixosNaPaleta = [...new Set(FIXOS.map(nomeReal))];

// Comandos dos fixos: um por `cmd` REAL (dois itens podem chamar o mesmo).
// **Sempre ESCREVE, nunca pula.** A versão anterior fazia `continue` quando o
// comando já existia — e como quase todos já existiam, o `icon` nunca era
// gravado. Sem `icon`, um item `inline` é desenhado com o TÍTULO INTEIRO: foi o
// "Braytech: Excluir conexão" escrito por extenso na linha, no lugar da
// lixeira, que ele viu na tela.
for (const nome of fixosNaPaleta) {
  // Quando dois itens compartilham o comando (`copiarNome` no nó e na conexão),
  // vale o que TEM ícone: é o que decide como o inline é desenhado.
  const candidatos = FIXOS.filter((x) => nomeReal(x) === nome);
  const f = candidatos.find((x) => x.icone !== undefined) ?? candidatos[0];
  const existente = contribui.commands.find((c) => c.command === nome);
  const declaracao = {
    command: nome,
    title: existente?.title ?? `Braytech: ${f.t}`,
    ...(f.icone === undefined ? {} : { icon: f.icone }),
  };
  if (existente === undefined) contribui.commands.push(declaracao);
  else Object.assign(existente, declaracao);
}

const daBarra = FIXOS.filter((f) => f.titulo === true);
const deLinha = FIXOS.filter((f) => f.titulo !== true);

// A barra do topo: o `Recarregar` que já existia mais os do inventário.
contribui.menus['view/title'] = [
  {
    command: 'braytech.recarregar',
    when: `${NAS_DUAS} || view == braytech.databases || view == braytech.servicos`,
    group: 'navigation@0',
  },
  ...daBarra.map((f, i) => ({
    command: `braytech.${f.real ?? f.cmd}`,
    when: f.when,
    group: `navigation@${i + 1}`,
  })),
];

contribui.menus['view/item/context'] = [
  ...deLinha.map((f) => ({
    command: nomeReal(f),
    when: f.when,
    // `inline` é o que aparece no HOVER, como ícone na linha.
    group: f.inline === true ? 'inline' : f.g,
  })),
  ...acoes.map((a) => ({
    command: `braytech.acao.${a.id}`,
    when: quando(a.id),
    group: a.grupo,
  })),
];

// Nenhuma delas faz sentido na paleta: todas precisam de um nó em mãos.
const semNo = ['braytech.abrirNo', 'braytech.abrirArquivoRemoto', ...fixosNaPaleta];
contribui.menus.commandPalette = [
  ...semNo.map((command) => ({ command, when: 'false' })),
  ...acoes.map((a) => ({ command: `braytech.acao.${a.id}`, when: 'false' })),
];

writeFileSync(PACOTE, `${JSON.stringify(pacote, null, 2)}\n`);
console.log(
  `gerar-menus: ${acoes.length} ações + ${FIXOS.length} fixos -> ` +
    `${contribui.menus['view/item/context'].length} itens de menu`
);
