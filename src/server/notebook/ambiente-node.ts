// De onde vem o Node do kernel JS/TS, e de onde vêm os pacotes dele.
//
// Um colega dele: *"quando é kernel Node ele não me deixa trocar… estava em
// uma pasta que tinha 2 projetos com node, sendo um frontend (next.js) e um
// backend (nestjs), não sei nem qual dos dois ele escolheu"*. E ele mesmo:
// *"escolher a versão Node é uma coisa e escolher da onde está vindo os
// pacotes é outra história"*. Por isso são DUAS listas.
//
// A plataforma vem por argumento, e o disco por funções — Windows é uso real,
// e isto se testa sem ele.
import * as path from 'path';
import type { Plataforma } from '../../shared/plataforma';
import type { Interpretador } from './ambiente';

export interface PastaDePacotes {
  readonly caminho: string;
  /** Relativo à raiz do workspace: `backend`, `apps/web`, `(raiz)`. */
  readonly rotulo: string;
}

/** Pastas onde um `package.json` nunca é de um projeto dele. */
const NAO_DESCER = new Set(['node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out', 'coverage', '.venv', 'vendor']);
/** Até onde procurar projetos abaixo da raiz: `apps/web/` é o fundo comum. */
const PROFUNDIDADE = 3;

/**
 * As pastas de onde o `require` pode vir.
 *
 * A PRIMEIRA é a que vale sem escolha: a mais próxima do notebook, subindo até
 * a raiz, que tenha `node_modules` — é onde o `require` do Node procuraria. As
 * outras são os projetos do workspace (qualquer pasta com `package.json`).
 */
export function pastasDePacotes(
  pastaDoNotebook: string,
  raizDoProjeto: string | null,
  plataforma: Plataforma,
  existe: (caminho: string) => boolean,
  subpastas: (caminho: string) => readonly string[]
): PastaDePacotes[] {
  const p = plataforma === 'win32' ? path.win32 : path.posix;
  const raiz = raizDoProjeto === null ? null : p.resolve(raizDoProjeto);
  const rotuloDe = (caminho: string): string => {
    if (raiz === null) return p.basename(caminho);
    const relativa = p.relative(raiz, caminho);
    return relativa === '' ? '(raiz)' : relativa.split(p.sep).join('/');
  };
  const ehProjeto = (pasta: string) => existe(p.join(pasta, 'package.json'));

  // A que o `require` usaria: subindo do notebook até a raiz.
  let padrao: string | null = null;
  let pasta = p.resolve(pastaDoNotebook);
  for (;;) {
    if (existe(p.join(pasta, 'node_modules'))) {
      padrao = pasta;
      break;
    }
    if (raiz === null || pasta === raiz) break;
    const acima = p.dirname(pasta);
    if (acima === pasta || !acima.startsWith(raiz)) break;
    pasta = acima;
  }

  // Os projetos do workspace, descendo da raiz.
  const projetos: string[] = [];
  const descer = (dir: string, nivel: number): void => {
    if (ehProjeto(dir)) projetos.push(dir);
    if (nivel >= PROFUNDIDADE) return;
    for (const nome of subpastas(dir)) {
      if (NAO_DESCER.has(nome)) continue;
      descer(p.join(dir, nome), nivel + 1);
    }
  };
  if (raiz !== null) descer(raiz, 0);

  const ordem = [...(padrao === null ? [] : [padrao]), ...projetos];
  const unicas = ordem.filter((c, i) => ordem.indexOf(c) === i);
  const lista = unicas.length > 0 ? unicas : [p.resolve(pastaDoNotebook)];
  return lista.map((caminho) => ({ caminho, rotulo: rotuloDe(caminho) }));
}

/** `v20.11.1` → [20, 11, 1], para ordenar por versão e não por texto. */
function numeros(versao: string): number[] {
  return versao.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
}

function maisNovaPrimeiro(a: string, b: string): number {
  const [x, y] = [numeros(a), numeros(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Os Node que dá para usar: o do editor (sempre existe — é o que roda o
 * motor), os do nvm, e o `node` do PATH.
 */
export function candidatosDeNode(
  plataforma: Plataforma,
  execPathDoMotor: string,
  casa: string,
  env: Readonly<Record<string, string | undefined>>,
  existe: (caminho: string) => boolean,
  subpastas: (caminho: string) => readonly string[]
): Interpretador[] {
  const p = plataforma === 'win32' ? path.win32 : path.posix;
  const candidatos: Interpretador[] = [
    { caminho: execPathDoMotor, origem: 'embutido', rotulo: 'Node do editor' },
  ];

  // nvm (POSIX): $NVM_DIR/versions/node/vX/bin/node. nvm-windows: %NVM_HOME%\vX\node.exe.
  const base = plataforma === 'win32'
    ? env.NVM_HOME ?? null
    : p.join(env.NVM_DIR ?? p.join(casa, '.nvm'), 'versions', 'node');
  if (base !== null) {
    const versoes = subpastas(base).filter((v) => /^v\d/.test(v)).sort(maisNovaPrimeiro);
    for (const v of versoes) {
      const caminho = plataforma === 'win32' ? p.join(base, v, 'node.exe') : p.join(base, v, 'bin', 'node');
      if (existe(caminho)) candidatos.push({ caminho, origem: 'nvm', rotulo: `nvm ${v}` });
    }
  }

  candidatos.push({ caminho: 'node', origem: 'sistema', rotulo: 'node do sistema (PATH)' });
  return candidatos;
}
