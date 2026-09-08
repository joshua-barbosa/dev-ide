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
// Preserva o que NÃO é ação (o `Enviar arquivos`, por exemplo): o gerador é
// dono das entradas `braytech.acao.*` e de mais nada.
const fixos = (contribui.menus['view/item/context'] ?? []).filter(
  (m) => !m.command.startsWith('braytech.acao.')
);
contribui.menus['view/item/context'] = [
  ...fixos,
  ...acoes.map((a) => ({
    command: `braytech.acao.${a.id}`,
    when: quando(a.id),
    group: a.grupo,
  })),
];

// Nenhuma delas faz sentido na paleta: todas precisam de um nó em mãos.
const semNo = ['braytech.abrirNo', 'braytech.abrirArquivoRemoto'];
contribui.menus.commandPalette = [
  ...semNo.map((command) => ({ command, when: 'false' })),
  ...acoes.map((a) => ({ command: `braytech.acao.${a.id}`, when: 'false' })),
];

writeFileSync(PACOTE, `${JSON.stringify(pacote, null, 2)}\n`);
console.log(`gerar-menus: ${acoes.length} ações -> comandos e menu de contexto`);
