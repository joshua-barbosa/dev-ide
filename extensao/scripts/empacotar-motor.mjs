// O MOTOR dentro do `.vsix`.
//
// Ele, em 08/09/2026: *"se eu quiser passar a extensão para outras pessoas
// usarem, faz como?"*. A resposta era constrangedora: a extensão procurava o
// `dist/server/index.js` no repositório dele, e instalada sozinha não achava
// motor nenhum.
//
// E o recado, em maiúsculas: *"PODE SER TANTO PARA LINUX, QUANTO PARA WINDOWS E
// INFELIZMENTE TALVEZ ALGUÉM USE EM MAC"*. Por isso o pacote é UM só: tudo o
// que entra aqui é JavaScript, e a única dependência nativa do motor — o
// `node-pty` — fica de fora de propósito (ver `EXTERNOS`).
//
// Um arquivo só, e não uma cópia de `node_modules`: as dependências do motor
// arrastam `@azure/*` pelo `tedious` e um punhado de opcionais que ninguém usa.
// O empacotador descarta o que não é alcançado.
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const ENTRADA = path.join(RAIZ, 'dist', 'server', 'index.js');
const SAIDA = path.join(RAIZ, 'extensao', 'motor', 'servidor.js');

/**
 * O que NÃO entra no pacote.
 *
 * - `node-pty` é nativo, e é do terminal LOCAL. O terminal da extensão é o de
 *   SSH, que é canal do `ssh2` — puro JavaScript. Deixá-lo de fora é o que
 *   permite um pacote só para Linux, Windows e macOS. Sem ele, o motor sobe e
 *   só o terminal local recusa, com mensagem (spec 106).
 * - Os outros são OPCIONAIS de bibliotecas que já os pedem dentro de um
 *   `try`: aceleradores e formas de autenticação que ninguém aqui usa. Deixá-los
 *   externos evita que o empacotador falhe por não achar o que nunca foi
 *   instalado.
 */
const EXTERNOS = [
  'node-pty',
  'cpu-features',
  'kerberos',
  'mongodb-client-encryption',
  '@mongodb-js/zstd',
  'snappy',
  'aws4',
  'gcp-metadata',
  '@aws-sdk/credential-providers',
  'bufferutil',
  'utf-8-validate',
];

if (!fs.existsSync(ENTRADA)) {
  console.error('Faltou compilar o motor: rode "npm run build:server".');
  process.exit(1);
}

fs.rmSync(path.dirname(SAIDA), { recursive: true, force: true });

/**
 * Deixa QUALQUER `.node` de fora do pacote.
 *
 * O `ssh2` tenta um acelerador nativo (`sshcrypto.node`) dentro de um
 * `try { … } catch {}` e, sem ele, usa a implementação em JavaScript puro do
 * próprio `ssh2` — mais lenta, e é o que já acontece hoje em máquina onde ele
 * não compilou. Empacotá-lo prenderia o pacote a uma plataforma; sem ele, o
 * mesmo `.vsix` serve Linux, Windows e macOS.
 */
const semNativos = {
  name: 'sem-nativos',
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, external: true }));
  },
};

const r = await esbuild.build({
  entryPoints: [ENTRADA],
  outfile: SAIDA,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // O host de extensão do VS Code e do Cursor roda Node 20 ou mais novo.
  target: 'node20',
  external: EXTERNOS,
  // **A marca de empacotado**, no topo do arquivo.
  //
  // Não como `define`: aquilo troca o TEXTO `process.env.BRAYTECH_EMPACOTADO`,
  // e `pastaDeProjetos` lê de um parâmetro `env` — a troca não acontecia, e os
  // projetos nasciam DENTRO da pasta instalada da extensão, que o editor apaga
  // a cada atualização. Só apareceu ao rodar o pacote fora do repositório.
  banner: {
    // `||` e não `??`: uma variável DEFINIDA E VAZIA no ambiente passava pelo
    // `??` e desligava a bandeira calada — e aí o motor empacotado gravava os
    // projetos dentro da pasta da extensão, que some na próxima atualização.
    // Quem quiser desligar de propósito ainda consegue, com `=0`.
    js: "process.env.BRAYTECH_EMPACOTADO = process.env.BRAYTECH_EMPACOTADO || '1';",
  },
  // Minificado: são 28 MB de fonte, e o que viaja no `.vsix` de quem instala
  // não precisa ser legível. As mensagens de erro são texto literal e
  // sobrevivem — é por elas que se entende uma falha, não pelos nomes das
  // variáveis do `tedious`.
  minify: true,
  legalComments: 'none',
  plugins: [semNativos],
  logLevel: 'warning',
  metafile: true,
});

const bytes = fs.statSync(SAIDA).size;
const entradas = Object.keys(r.metafile.inputs).length;
console.log(
  `  motor empacotado: ${(bytes / 1024 / 1024).toFixed(1)} MB ` +
    `de ${entradas} arquivos → extensao/motor/servidor.js`
);

// O `require.main === module` do motor não vale aqui: quem o inicia é a
// extensão, chamando `iniciarServidor`. Conferir a exportação agora evita
// descobrir na máquina de outra pessoa.
const exportado = fs.readFileSync(SAIDA, 'utf8').includes('iniciarServidor');
if (!exportado) {
  console.error('O pacote não expõe `iniciarServidor` — a extensão não saberia subir o motor.');
  process.exit(1);
}
