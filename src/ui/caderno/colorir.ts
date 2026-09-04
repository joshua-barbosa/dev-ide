// Cor no bloco do caderno, sem instanciar editor (spec 050, D17).
//
// `monaco.editor.colorize()` roda o MESMO tokenizador do editor grande e devolve
// HTML pintado com o tema corrente — sem `create`, sem modelo, sem view. É o que
// torna a decisão D17 possível: a cor não precisa de editor, só o multi-cursor
// precisava.
//
// **O HTML é seguro por construção.** O texto do usuário entra escapado pelo
// próprio Monaco (é para isso que a função existe: ela produz HTML para colar em
// página); o que sai são `<span style="color:…">` e `<br/>`. Mesmo raciocínio do
// `MarkdownPreview`: quem protege é a servidor-1 que gera, não uma varredura depois.
//
// **O Monaco entra por `import()`** (P7, spec 101). Este hook é usado pelo visor
// de célula e pelo campo colorido, que aparecem em telas sem editor nenhum —
// importá-lo direto colocaria os 5 MB do Monaco no caminho do primeiro desenho
// da IDE inteira. Quem toca no Monaco é `colorir-monaco.ts`.
import { useEffect, useState } from 'react';
import { idDoMonaco } from '../../shared/editor/monaco-ids';
import type { NomeDoTema } from '../../shared/temas';

/**
 * Devolve o conteúdo colorido, ou `null` enquanto não ficou pronto.
 *
 * Enquanto é `null` quem aparece é o texto cru da camada de baixo — nunca um
 * vazio. Um bloco que pisca em branco a cada tecla seria pior que bloco sem cor.
 */
export function useColorido(
  texto: string,
  linguagem: string,
  tema: NomeDoTema,
  tabSize: number
): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    const id = idDoMonaco(linguagem);

    let vigente = true;
    let repetir: ReturnType<typeof setTimeout> | undefined;

    const colorir = (podeRepetir: boolean): void => {
      void import('./colorir-monaco')
        .then(async (m) => {
          const r = await m.colorirComMonaco(texto, id, tema, tabSize);
          // Sem isto, uma colorização lenta de duas teclas atrás sobrescreveria
          // a atual — o bloco mostraria o que já não está escrito nele.
          if (!vigente) return;
          setHtml(r);
          // O tokenizador de algumas linguagens (o do JSON é uma) é carregado
          // por um caminho assíncrono próprio, e a primeira colorização de uma
          // página que nunca abriu aquela linguagem chega antes dele — o texto
          // sai inteiro em `mtk1`, sem erro nenhum. Uma segunda tentativa
          // resolve, e o `podeRepetir` garante que ela é UMA.
          if (podeRepetir && m.saiuSemCor(r) && id !== m.LINGUAGEM_PADRAO_MONACO) {
            repetir = setTimeout(() => colorir(false), 250);
          }
        })
        .catch(() => {
          if (vigente) setHtml(null);
        });
    };
    colorir(true);

    return () => {
      vigente = false;
      if (repetir !== undefined) clearTimeout(repetir);
    };
  }, [texto, linguagem, tema, tabSize]);

  return html;
}
