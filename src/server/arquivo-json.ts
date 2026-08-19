// Ler e gravar JSON do usuário em disco.
//
// Extraído do store de preferências quando o estado da sessão virou o segundo
// usuário das mesmas duas regras:
//
// - **ler nunca lança** — arquivo ausente, ilegível ou quebrado valem como
//   "não há nada", porque falhar aqui impediria a IDE de subir por causa de uma
//   vírgula a mais;
// - **gravar é atômico** — temporário mais `rename`, para nunca deixar um
//   arquivo truncado se o processo morrer no meio. É o mesmo cuidado do cofre.
import * as fs from 'fs';
import * as path from 'path';

/** O objeto do arquivo, ou `{}` quando não há um legível. */
export function lerJsonTolerante(caminho: string): Record<string, unknown> {
  try {
    const bruto: unknown = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {};
    return bruto as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Grava com permissão `600`, dentro de uma pasta `700`, sem passo intermediário visível. */
export function gravarJsonAtomico(caminho: string, conteudo: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(caminho), { recursive: true, mode: 0o700 });
  const temp = `${caminho}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(conteudo, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, caminho);
}
