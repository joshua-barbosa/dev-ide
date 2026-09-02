// A IDE sabe se está no desktop, e usa o que só o desktop tem (T003, T099).
//
// **Detecta capacidade, e não plataforma.** Nada de `navigator.userAgent` nem de
// uma variável de build: a pergunta é "existe a ponte?", e a resposta vale
// exatamente para a janela onde o código está rodando. Isso é o que mantém o
// mesmo bundle funcionando nos dois modos — que é a condição para a versão web
// não apodrecer enquanto a desktop avança.

import type { PonteDoDesktop } from '../electron/preload';

/** A ponte, ou `undefined` no navegador. */
export function ponteDoDesktop(): PonteDoDesktop | undefined {
  const w = window as unknown as { devIde?: PonteDoDesktop };
  const p = w.devIde;
  // Confere a MARCA, e não só a presença: uma extensão qualquer pode ter posto
  // um `window.devIde` no caminho, e chamar métodos de um objeto estranho seria
  // pior que não ter ponte.
  return p !== undefined && p.ehDesktop === true ? p : undefined;
}

export function ehDesktop(): boolean {
  return ponteDoDesktop() !== undefined;
}
