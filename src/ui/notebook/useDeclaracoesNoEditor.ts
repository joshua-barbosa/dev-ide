// Conta ao TypeScript do editor as variáveis do notebook (ver
// `shared/notebook/declaracoes.ts`). Sem isto, o `patients` vindo do SQL
// aparecia em vermelho, "como se não conhecesse a variavel".
//
// UM conjunto de arquivos para a página inteira, de quem focou uma célula por
// último: dois notebooks abertos declarando o mesmo nome com tipos diferentes
// viraria erro do próprio TypeScript.
//
// **Trocar no lugar, sem tirar antes.** A primeira versão descartava os
// arquivos e os punha de volta a cada tecla; no meio, o `users` de outra
// célula ficava sem declaração e piscava em vermelho (relato da 0.1.16). O
// Monaco troca o conteúdo quando o caminho é o mesmo, e o descarte de uma
// versão antiga não apaga a nova — então só se descarta ao desmontar.
//
// O Monaco vem por `import()`: ele não pode entrar no primeiro desenho da IDE
// (spec 101), e o notebook só precisa dele quando uma célula está em edição.
import { useEffect, useMemo, useRef } from 'react';
import { codigoDasOutrasCelulas, declaracoesDoNotebook } from '../../shared/notebook/declaracoes';
import type { Notebook } from '../../shared/notebook/modelo';

const CAMINHO = 'file:///braytech-notebook.d.ts';
/** O código das outras células: um script, para o tipo de `users = …map(…)` ser inferido. */
const CAMINHO_DO_CODIGO = 'file:///braytech-notebook-celulas.ts';

/**
 * O que não é erro numa célula: `await` no topo (a célula roda numa função
 * assíncrona), e `import`/`require` de pacote — os `node_modules` estão no
 * kernel, não no navegador, então o editor não tem como achá-los.
 */
const IGNORAR = [1375, 1378, 2307, 7016];

type Descartavel = { dispose(): void };

/** Põe (ou troca) um arquivo nos dois serviços, JS e TS. */
function usarArquivo(caminho: string, texto: string, guardados: Map<string, Descartavel[]>): void {
  void import('monaco-editor').then((monaco) => {
    const novos: Descartavel[] = [];
    for (const padroes of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
      const atuais = padroes.getDiagnosticsOptions();
      const ignorados = [...new Set([...(atuais.diagnosticCodesToIgnore ?? []), ...IGNORAR])];
      if (ignorados.length !== (atuais.diagnosticCodesToIgnore ?? []).length) {
        padroes.setDiagnosticsOptions({ ...atuais, diagnosticCodesToIgnore: ignorados });
      }
      novos.push(padroes.addExtraLib(texto, caminho));
    }
    guardados.set(caminho, novos);
  });
}

export function useDeclaracoesNoEditor(nb: Notebook | null, idEmFoco: string | null): void {
  const texto = useMemo(
    () => (nb === null || idEmFoco === null ? null : declaracoesDoNotebook(nb, idEmFoco)),
    [nb, idEmFoco]
  );
  const codigo = useMemo(
    () => (nb === null || idEmFoco === null ? null : codigoDasOutrasCelulas(nb, idEmFoco)),
    [nb, idEmFoco]
  );
  const guardados = useRef(new Map<string, Descartavel[]>());

  // Um efeito por arquivo: digitar na célula em foco muda as declarações, mas
  // não o código das OUTRAS — e esse não precisa ser reenviado.
  useEffect(() => {
    if (texto !== null) usarArquivo(CAMINHO, texto, guardados.current);
  }, [texto]);
  useEffect(() => {
    if (codigo !== null) usarArquivo(CAMINHO_DO_CODIGO, codigo, guardados.current);
  }, [codigo]);

  // Só ao fechar o notebook os arquivos saem.
  useEffect(() => {
    const deste = guardados.current;
    return () => {
      for (const lista of deste.values()) for (const d of lista) d.dispose();
      deste.clear();
    };
  }, []);
}
