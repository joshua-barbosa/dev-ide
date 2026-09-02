// Os atalhos de teclado, despachados pelo mesmo registro do menu e da paleta.
//
// Saiu do `App` pelo Artigo IV, e o assunto é próprio: **como uma tecla vira um
// comando**. As três portas — menu, paleta e atalho — leem do mesmo lugar, e é
// isso que as impede de discordar.
//
// O ouvinte é registrado UMA VEZ e lê o despacho por `ref`. Sem isso ele
// capturaria o contexto do primeiro render e passaria a decidir disponibilidade
// com estado velho — um `Ctrl+S` deixaria de funcionar depois de trocar de aba.
import { useEffect, useRef } from 'react';
import { comandoDoAtalho, formatarAtalho, type ContextoDeComandos } from '../../shared/commands';

export function useAtalhos(
  contexto: ContextoDeComandos,
  executarComando: (id: string) => void
): void {
  const despacho = useRef<(e: KeyboardEvent) => void>(() => {});
  despacho.current = (e: KeyboardEvent) => {
    const cmd = comandoDoAtalho(formatarAtalho(e), contexto);
    if (cmd === null) return;
    // Só engole a tecla quando há comando DISPONÍVEL — caso contrário o editor
    // perderia atalhos que ele próprio trata.
    e.preventDefault();
    executarComando(cmd.id);
  };

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent): void => despacho.current(e);
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, []);
}
