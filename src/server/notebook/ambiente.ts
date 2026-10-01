// De onde vem o Python do notebook (spec 112, etapa 2).
//
// Ele: *"o 'kernel' pode ser da onde vem os pacotes… e onde está o python
// (tipo o .venv)"*. O `python3` do sistema dele não tem `pandas`; o `.venv` do
// projeto costuma ter. Por isso o `.venv` vem primeiro.
//
// Procura da pasta do notebook SUBINDO até a raiz do projeto, e não além: um
// `.venv` na pasta de casa não é deste projeto, e usá-lo calado seria rodar
// com pacotes que ninguém escolheu.
//
// A plataforma vem por argumento, e os caminhos são montados com o `path` DELA
// — Windows é uso real (`Scripts\python.exe`), e um padrão POSIX calado é como
// isso quebra lá.
import * as path from 'path';
import type { Plataforma } from '../../shared/plataforma';

export interface Interpretador {
  readonly caminho: string;
  readonly origem: 'venv' | 'sistema' | 'escolhido' | 'embutido' | 'nvm';
  /** O que a barra do notebook mostra: `.venv (projeto)`, `a/.venv`, `sistema`. */
  readonly rotulo: string;
}

const PASTAS_DE_VENV = ['.venv', 'venv'];

export function candidatosDePython(
  pastaDoNotebook: string,
  raizDoProjeto: string | null,
  plataforma: Plataforma,
  existe: (caminho: string) => boolean
): Interpretador[] {
  const p = plataforma === 'win32' ? path.win32 : path.posix;
  const dentroDoVenv = plataforma === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  const raiz = raizDoProjeto === null ? null : p.resolve(raizDoProjeto);

  const candidatos: Interpretador[] = [];
  let pasta = p.resolve(pastaDoNotebook);
  for (;;) {
    for (const venv of PASTAS_DE_VENV) {
      const caminho = p.join(pasta, venv, ...dentroDoVenv);
      if (existe(caminho)) {
        const relativa = raiz === null ? '' : p.relative(raiz, pasta);
        candidatos.push({
          caminho,
          origem: 'venv',
          rotulo: relativa === '' ? `${venv} (projeto)` : `${relativa.split(p.sep).join('/')}/${venv}`,
        });
      }
    }
    // Sem projeto, só a própria pasta; com projeto, até a raiz dele.
    if (raiz === null || pasta === raiz) break;
    const acima = p.dirname(pasta);
    if (acima === pasta || !acima.startsWith(raiz)) break;
    pasta = acima;
  }

  candidatos.push({
    caminho: plataforma === 'win32' ? 'python' : 'python3',
    origem: 'sistema',
    rotulo: 'sistema',
  });
  return candidatos;
}

export interface AmbientePhp {
  /** O `vendor/autoload.php` mais próximo: pacotes do Composer e classes do projeto. */
  readonly autoload: string | null;
  /** O `bootstrap/app.php` de um projeto Laravel, quando há `artisan` ao lado. */
  readonly laravel: string | null;
}

/**
 * O PHP do notebook: o `vendor` e o Laravel do projeto (spec 112, etapa 3).
 *
 * Mesma regra do `.venv`: da pasta do notebook subindo até a raiz do projeto,
 * e não além — um `vendor` fora do projeto não é deste projeto.
 */
export function ambientePhp(
  pastaDoNotebook: string,
  raizDoProjeto: string | null,
  plataforma: Plataforma,
  existe: (caminho: string) => boolean
): AmbientePhp {
  const p = plataforma === 'win32' ? path.win32 : path.posix;
  const raiz = raizDoProjeto === null ? null : p.resolve(raizDoProjeto);
  let autoload: string | null = null;
  let laravel: string | null = null;
  let pasta = p.resolve(pastaDoNotebook);
  for (;;) {
    const candidato = p.join(pasta, 'vendor', 'autoload.php');
    if (autoload === null && existe(candidato)) autoload = candidato;
    const bootstrap = p.join(pasta, 'bootstrap', 'app.php');
    if (laravel === null && existe(p.join(pasta, 'artisan')) && existe(bootstrap)) laravel = bootstrap;
    if (raiz === null || pasta === raiz) break;
    const acima = p.dirname(pasta);
    if (acima === pasta || !acima.startsWith(raiz)) break;
    pasta = acima;
  }
  return { autoload, laravel };
}

/**
 * Um interpretador digitado em "Outro…": relativo à pasta do NOTEBOOK, `~/`
 * como a pasta do usuário, absoluto como está, e nome solto (`python3`) para o
 * PATH. A pergunta foi *"O caminho do python eu preciso colocar desde a raiz?
 * Ou posso colocar só a partir da pasta que estou?"* — pode.
 */
export function resolverInterpretador(
  valor: string,
  pastaDoNotebook: string,
  casa: string,
  plataforma: Plataforma
): string {
  const p = plataforma === 'win32' ? path.win32 : path.posix;
  const texto = valor.trim();
  if (/^~[\\/]/.test(texto)) return p.join(casa, texto.slice(2));
  if (p.isAbsolute(texto)) return texto;
  const temBarra = plataforma === 'win32' ? /[\\/]/.test(texto) : texto.includes('/');
  return temBarra ? p.resolve(pastaDoNotebook, texto) : texto;
}

/**
 * O que digitaram em "Outro…" é uma PASTA? (relato de 01/10: "spawn
 * …/backend/vendor EACCES" — o motor tentou executar a pasta.)
 *
 * "Outro…" é só o PROGRAMA (o usuário: "PHP e vendor são coisas bem
 * diferentes"): a pasta onde o php/node/python está vira o executável de
 * dentro dela; a pasta de um venv, o python dele. A pasta do vendor ou dos
 * pacotes NÃO vira escolha de pacotes aqui — o recado aponta a opção certa.
 */
export function lerEscolhaDePasta(
  caminho: string,
  linguagem: 'python' | 'php' | 'javascript' | 'typescript',
  plataforma: Plataforma,
  existe: (caminho: string) => boolean,
  ehPasta: (caminho: string) => boolean
): { readonly interpretador: string } | { readonly erro: string } {
  if (!ehPasta(caminho)) return { interpretador: caminho };
  const p = plataforma === 'win32' ? path.win32 : path.posix;
  const exe = (nome: string) => (plataforma === 'win32' ? `${nome}.exe` : nome);
  const programa = linguagem === 'php' ? 'php' : linguagem === 'python' ? 'python' : 'node';
  for (const dentro of [p.join(caminho, exe(programa)), p.join(caminho, 'bin', exe(programa))]) {
    if (existe(dentro)) return { interpretador: dentro };
  }
  if (linguagem === 'python' && plataforma === 'win32' && existe(p.join(caminho, 'Scripts', 'python.exe'))) {
    return { interpretador: p.join(caminho, 'Scripts', 'python.exe') };
  }
  const ehVendor = existe(p.join(caminho, 'autoload.php')) || existe(p.join(caminho, 'vendor', 'autoload.php'));
  if (linguagem === 'php' && ehVendor) {
    return { erro: `"${caminho}" é a pasta do vendor, não o programa PHP. Escolha-a em "Outra pasta de vendor…" (ou "Vendor: …" na lista).` };
  }
  return {
    erro: `"${caminho}" é uma pasta, e nela não há o programa ${programa}. Aponte o executável, ou a pasta onde ele está.`,
  };
}

/**
 * "Outra pasta de vendor…" / "Outra pasta de pacotes…": a pasta do PROJETO,
 * ou a própria `vendor/` (`node_modules/`) — vale a do projeto.
 */
export function lerPastaDePacotes(
  caminho: string,
  linguagem: 'python' | 'php' | 'javascript' | 'typescript',
  plataforma: Plataforma,
  existe: (caminho: string) => boolean,
  ehPasta: (caminho: string) => boolean
): { readonly pacotes: string } | { readonly erro: string } {
  const p = plataforma === 'win32' ? path.win32 : path.posix;
  if (!ehPasta(caminho)) return { erro: `"${caminho}" não existe (ou não é uma pasta).` };
  if (linguagem === 'php') {
    if (p.basename(caminho) === 'vendor' && existe(p.join(caminho, 'autoload.php'))) return { pacotes: p.dirname(caminho) };
    if (existe(p.join(caminho, 'vendor', 'autoload.php'))) return { pacotes: caminho };
    return { erro: `Em "${caminho}" não há vendor/autoload.php (rode o composer install lá?).` };
  }
  if (p.basename(caminho) === 'node_modules') return { pacotes: p.dirname(caminho) };
  return { pacotes: caminho };
}
