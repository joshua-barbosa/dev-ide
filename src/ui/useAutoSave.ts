// Salvar sozinho, nos dois modos que o VS Code tem.
//
// A regra que manda em tudo aqui: **nunca gravar onde o usuário não mandou.**
// Aba sem título não tem arquivo em disco, e inventar um nome — ou perguntar no
// meio da digitação — seria o oposto de automático. Por isso os dois caminhos
// passam por funções que simplesmente não fazem nada quando não há caminho.
import { useEffect, useRef } from 'react';
import type { Preferencias } from '../shared/prefs';
import type { Workspace } from './useWorkspace';

export interface AutoSaveDeps {
  readonly ws: Workspace;
  readonly prefs: Preferencias;
  readonly aoFalhar: (erro: unknown) => void;
}

export function useAutoSave({ ws, prefs, aoFalhar }: AutoSaveDeps): void {
  const modo = prefs['editor.autoSave'];
  const atraso = prefs['editor.autoSaveDelay'];

  // Por ref para os efeitos não dependerem do objeto do workspace, que é novo
  // a cada render — o temporizador reiniciaria sem parar e nunca dispararia.
  const espaco = useRef(ws);
  espaco.current = ws;
  const falhou = useRef(aoFalhar);
  falhou.current = aoFalhar;

  // ---- afterDelay: parou de digitar, grava ----
  useEffect(() => {
    if (modo !== 'afterDelay') return;
    // `edicoes` é 0 no primeiro render; salvar aí gravaria sem edição nenhuma.
    if (ws.edicoes === 0) return;

    const timer = window.setTimeout(() => {
      void espaco.current.salvar().catch(falhou.current);
    }, atraso);
    return () => window.clearTimeout(timer);
  }, [modo, atraso, ws.edicoes]);

  // ---- onFocusChange: trocou de aba ou saiu da janela ----
  //
  // Usa `salvarTodas` e não `salvar`: quando a aba ativa muda, o que perdeu o
  // foco é a ANTERIOR, e `salvar` já estaria olhando para a nova. `salvarTodas`
  // pega as duas, e gravar o que já estava sujo não faz mal nenhum.
  const abaAnterior = useRef(ws.activeId);
  useEffect(() => {
    if (modo !== 'onFocusChange') {
      abaAnterior.current = ws.activeId;
      return;
    }
    if (abaAnterior.current === ws.activeId) return;
    abaAnterior.current = ws.activeId;
    void espaco.current.salvarTodas().catch(falhou.current);
  }, [modo, ws.activeId]);

  useEffect(() => {
    if (modo !== 'onFocusChange') return;
    const aoPerderFoco = (): void => {
      void espaco.current.salvarTodas().catch(falhou.current);
    };
    window.addEventListener('blur', aoPerderFoco);
    return () => window.removeEventListener('blur', aoPerderFoco);
  }, [modo]);
}
