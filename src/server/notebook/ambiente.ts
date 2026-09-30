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
  readonly origem: 'venv' | 'sistema' | 'escolhido';
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
