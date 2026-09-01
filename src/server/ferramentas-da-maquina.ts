// Procura no PATH o que a lista de `shared/ferramentas.ts` declara.
//
// **Nada aqui EXECUTA a ferramenta.** A checagem é só "existe um arquivo
// executável com este nome no PATH": rodar `git --version` a cada abertura da
// tela seria uma dúzia de processos por uma informação que o `access` já dá.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FERRAMENTAS, type EstadoDaFerramenta } from '../shared/ferramentas';

/** O primeiro dos `comandos` que existe como executável no PATH. */
export function acharNoPath(comandos: readonly string[]): string | null {
  const pastas = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d !== '');
  for (const comando of comandos) {
    for (const pasta of pastas) {
      const caminho = path.join(pasta, comando);
      try {
        fs.accessSync(caminho, fs.constants.X_OK);
        return caminho;
      } catch {
        // PATH com pasta que não existe é normal; segue procurando.
      }
    }
  }
  return null;
}

/**
 * A lista com o estado de agora.
 *
 * Recalculada a cada chamada, e não guardada: instalar o `ruff` com a IDE
 * aberta tem de aparecer na tela ao reabri-la, sem reiniciar o servidor.
 */
export function estadoDasFerramentas(): readonly EstadoDaFerramenta[] {
  return FERRAMENTAS.map((f) => ({ ...f, caminho: acharNoPath(f.comandos) }));
}
