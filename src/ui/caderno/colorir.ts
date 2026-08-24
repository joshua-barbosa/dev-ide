// Cor no bloco do caderno, sem instanciar editor (spec 050, D15).
//
// `monaco.editor.colorize()` roda o MESMO tokenizador do editor grande e devolve
// HTML pintado com o tema corrente — sem `create`, sem modelo, sem view. É o que
// torna a decisão D15 possível: a cor não precisa de editor, só o multi-cursor
// precisava.
//
// **O HTML é seguro por construção.** O texto do usuário entra escapado pelo
// próprio Monaco (é para isso que a função existe: ela produz HTML para colar em
// página); o que sai são `<span style="color:…">` e `<br/>`. Mesmo raciocínio do
// `MarkdownPreview`: quem protege é a servidor-1 que gera, não uma varredura depois.
import { useEffect, useState } from 'react';
import * as monaco from 'monaco-editor';
import { idDoMonaco } from '../../shared/editor/monaco-ids';
import { NOME_DO_TEMA, registrarTema } from '../editor/tema';
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
    // O tema tem que existir no Monaco antes de colorir. Num caderno aberto
    // sozinho pode não haver nenhum editor montado ainda, e sem isto as cores
    // sairiam as do `vs-dark` de fábrica em vez das nossas.
    registrarTema(tema);
    monaco.editor.setTheme(NOME_DO_TEMA);

    let vigente = true;
    void monaco.editor
      .colorize(texto, idDoMonaco(linguagem), { tabSize })
      .then((r) => {
        // Sem isto, uma colorização lenta de duas teclas atrás sobrescreveria a
        // atual — o bloco mostraria o que já não está escrito nele.
        if (vigente) setHtml(r);
      })
      .catch(() => {
        if (vigente) setHtml(null);
      });
    return () => {
      vigente = false;
    };
  }, [texto, linguagem, tema, tabSize]);

  return html;
}
