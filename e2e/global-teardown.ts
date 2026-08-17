// Remove o diretório temporário da execução.
//
// Sem isto, cada execução deixa um /tmp/dev-ide-e2e-<porta> para trás — e como
// a porta muda a cada vez, eles se acumulam indefinidamente.
import * as fs from 'node:fs';

export default function globalTeardown(): void {
  const dados = process.env.E2E_DATA;
  if (dados === undefined) return;
  fs.rmSync(dados, { recursive: true, force: true });
}
