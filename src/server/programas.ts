// Achar um executável no PATH.
//
// Saiu de `terminal/session.ts` quando o Windows entrou em cena: a busca de lá
// procurava só pelo nome cru e pelo bit de execução, e nenhuma das duas coisas
// existe no Windows — lá `bash` é `bash.exe`, e quem diz os sufixos válidos é o
// `PATHEXT`.
//
// A parte que decide os NOMES é pura e mora em `shared/plataforma.ts`; aqui só
// se toca no disco.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ehCaminhoDeExecutavel, nomesDoExecutavel, plataformaAtual, type Plataforma,
} from '../shared/plataforma';

export function existeNoCaminho(
  exec: string,
  plataforma: Plataforma = plataformaAtual(),
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  if (ehCaminhoDeExecutavel(exec, plataforma)) return fs.existsSync(exec);

  const pastas = (env.PATH ?? '').split(path.delimiter).filter((d) => d !== '');
  const nomes = nomesDoExecutavel(exec, plataforma, env);

  return pastas.some((pasta) =>
    nomes.some((nome) => {
      try {
        // `X_OK` no Windows não distingue nada — lá o que vale é o arquivo
        // existir com uma das extensões do `PATHEXT`.
        if (plataforma === 'win32') return fs.existsSync(path.join(pasta, nome));
        fs.accessSync(path.join(pasta, nome), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    })
  );
}
