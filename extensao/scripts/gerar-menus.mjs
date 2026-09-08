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
const FIXOS = [
  // --- conexão ---
  { cmd: 'copiarNome', t: 'Copiar nome', when: 'viewItem =~ /braytech\\.conexao/', g: '1_copiar' },
  { cmd: 'conectar', t: 'Conectar', when: 'viewItem =~ /braytech\\.conexao\\.fechada/', g: '2_estado' },
  { cmd: 'desconectar', t: 'Desconectar', when: 'viewItem =~ /braytech\\.conexao\\.aberta/', g: '2_estado' },
  { cmd: 'recarregarConexao', t: 'Recarregar metadados', icone: '$(refresh)',
    when: 'viewItem =~ /braytech\\.conexao/', g: '2_estado', inline: true },
  { cmd: 'verProcessos', t: 'Ver processos…', when: 'viewItem =~ /braytech\\.conexao/', g: '3_ver' },
  { cmd: 'editarConexao', t: 'Editar conexão…', when: 'viewItem =~ /braytech\\.conexao/', g: '9_editar' },
  { cmd: 'excluirConexao', t: 'Excluir conexão', when: 'viewItem =~ /braytech\\.conexao/', g: '9_editar' },
  // --- nó de banco ---
  { cmd: 'copiarNomeDoNo', t: 'Copiar nome', when: 'viewItem =~ /braytech\\.no/', g: '1_copiar',
    real: 'copiarNome' },
  { cmd: 'diagramaEr', t: 'Diagrama ER', when: 'viewItem =~ /\\.er(\\.|$|\\[)/', g: '3_ver' },
  { cmd: 'diagramaDaTabela', t: 'Diagrama desta tabela', when: 'viewItem =~ /\\.erTabela/', g: '3_ver' },
  { cmd: 'novaQuerySql', t: 'Nova query SQL…', when: 'viewItem =~ /\\.queries/', g: '4_criar' },
  { cmd: 'novoQueryBook', t: 'Novo Query Book…', when: 'viewItem =~ /\\.queries/', g: '4_criar' },
  // --- arquivo e pasta remotos (spec 053) ---
  { cmd: 'copiarCaminho', t: 'Copiar caminho',
    when: 'viewItem =~ /(pastaRemota|arquivoRemoto)/', g: '1_copiar' },
  { cmd: 'novoArquivoRemoto', t: 'Novo arquivo…', when: 'viewItem =~ /pastaRemota/', g: '4_criar' },
  { cmd: 'novaPastaRemota', t: 'Nova pasta…', when: 'viewItem =~ /pastaRemota/', g: '4_criar' },
  { cmd: 'renomearRemoto', t: 'Renomear…',
    when: 'viewItem =~ /(pastaRemota|arquivoRemoto)/', g: '9_editar' },
  { cmd: 'apagarRemoto', t: 'Apagar',
    when: 'viewItem =~ /(pastaRemota|arquivoRemoto)/', g: '9_editar' },
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
for (const nome of fixosNaPaleta) {
  if (contribui.commands.some((c) => c.command === nome)) continue;
  const f = FIXOS.find((x) => nomeReal(x) === nome);
  contribui.commands.push({
    command: nome,
    title: `Braytech: ${f.t}`,
    ...(f.icone === undefined ? {} : { icon: f.icone }),
  });
}

contribui.menus['view/item/context'] = [
  ...FIXOS.map((f) => ({
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
