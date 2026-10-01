// Conta ao TypeScript do editor as variáveis do notebook (ver
// `shared/notebook/declaracoes.ts`). Sem isto, o `patients` vindo do SQL
// aparecia em vermelho, "como se não conhecesse a variavel".
//
// UM arquivo de declarações para a página inteira, de quem focou uma célula
// por último: dois notebooks abertos declarando o mesmo nome com tipos
// diferentes viraria erro do próprio TypeScript. O Monaco troca o conteúdo
// quando o caminho é o mesmo, e o descarte de um antigo não apaga o novo.
//
// O Monaco vem por `import()`: ele não pode entrar no primeiro desenho da IDE
// (spec 101), e o notebook só precisa dele quando uma célula está em edição.
import { useEffect, useMemo } from 'react';
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

export function useDeclaracoesNoEditor(nb: Notebook | null, idEmFoco: string | null): void {
  const texto = useMemo(
    () => (nb === null || idEmFoco === null ? null : declaracoesDoNotebook(nb, idEmFoco)),
    [nb, idEmFoco]
  );
  const codigo = useMemo(
    () => (nb === null || idEmFoco === null ? null : codigoDasOutrasCelulas(nb, idEmFoco)),
    [nb, idEmFoco]
  );

  useEffect(() => {
    if (texto === null || codigo === null) return;
    let vigente = true;
    const descartes: { dispose(): void }[] = [];
    void import('monaco-editor').then((monaco) => {
      if (!vigente) return;
      for (const padroes of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
        const atuais = padroes.getDiagnosticsOptions();
        const ignorados = [...new Set([...(atuais.diagnosticCodesToIgnore ?? []), ...IGNORAR])];
        if (ignorados.length !== (atuais.diagnosticCodesToIgnore ?? []).length) {
          padroes.setDiagnosticsOptions({ ...atuais, diagnosticCodesToIgnore: ignorados });
        }
        descartes.push(padroes.addExtraLib(texto, CAMINHO));
        descartes.push(padroes.addExtraLib(codigo, CAMINHO_DO_CODIGO));
      }
    });
    return () => {
      vigente = false;
      for (const d of descartes) d.dispose();
    };
  }, [texto, codigo]);
}
