// Os ícones que ELE desenhou, em `icones/`.
//
// Ele, em 08/09/2026: *"eu queria poder alterar os svg dos ícones das coisas
// […] não gostei muito dos que estão para table, view, procedures, servidores"*
// — e depois: *"eu consigo pegar o svg do próprio Material Icons Theme também"*.
//
// Um arquivo aqui GANHA do catálogo, nas duas telas. Lido por dois builds
// (`build-icons.mjs` para a IDE e `gerar-icones.mjs` para a extensão), e por
// isso mora num lugar só: duas leituras da mesma pasta divergiriam no dia em
// que uma delas ganhasse uma regra nova.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PASTA = path.join(RAIZ, 'icones');

/**
 * Lê a pasta e devolve `nome -> { claro, escuro }`, com o SVG em texto.
 *
 * `nome-dark.svg` é a versão escura de `nome`, e não um ícone chamado
 * "nome-dark": a árvore do editor não recolore SVG, então um traço preto
 * sumiria no tema escuro e a única saída é dois desenhos.
 */
export function lerIconesProprios(validos) {
  if (!fs.existsSync(PASTA)) return new Map();

  const arquivos = fs
    .readdirSync(PASTA)
    .filter((f) => f.toLowerCase().endsWith('.svg'))
    .sort();

  const mapa = new Map();
  const invalidos = [];

  for (const arquivo of arquivos) {
    const base = arquivo.slice(0, -4);
    const escuro = base.endsWith('-dark');
    const nome = escuro ? base.slice(0, -5) : base;

    if (validos !== undefined && !validos.has(nome)) {
      invalidos.push(arquivo);
      continue;
    }
    const svg = fs.readFileSync(path.join(PASTA, arquivo), 'utf8').trim();
    const atual = mapa.get(nome) ?? {};
    mapa.set(nome, escuro ? { ...atual, escuro: svg } : { ...atual, claro: svg });
  }

  // **Falha, não ignora.** Um arquivo com nome errado ficaria na pasta parecendo
  // que vale, e o ícone velho continuaria na tela sem ninguém entender por quê.
  if (invalidos.length > 0) {
    console.error(
      `Ícone próprio com nome desconhecido: ${invalidos.join(', ')}.\n` +
        'Os nomes válidos são os de src/shared/icons.ts e os das marcas.'
    );
    process.exit(1);
  }

  // Sem o claro, o escuro serve aos dois — e vice-versa.
  for (const [nome, par] of mapa) {
    mapa.set(nome, {
      claro: par.claro ?? par.escuro,
      escuro: par.escuro ?? par.claro,
    });
  }
  return mapa;
}
