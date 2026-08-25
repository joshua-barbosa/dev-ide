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
import { useEffect, useState } from 'react';
import * as monaco from 'monaco-editor';
import { idDoMonaco, LINGUAGEM_PADRAO_MONACO } from '../../shared/editor/monaco-ids';
import { NOME_DO_TEMA, registrarTema } from '../editor/tema';
import type { NomeDoTema } from '../../shared/temas';

/**
 * As linguagens cujo tokenizador já foi carregado nesta página.
 *
 * O `colorize` do Monaco espera o tokenizador por um instante e, se ele não
 * chegar, devolve o texto SEM COR — sem erro, sem aviso. E o tokenizador de uma
 * linguagem só é carregado quando alguém abre um editor nela: numa página que
 * nunca abriu um `.json`, colorir JSON devolvia tudo na mesma classe `mtk1`.
 *
 * Criar um modelo vazio dispara o carregamento. Um por linguagem, descartado
 * logo em seguida — o registro do tokenizador é global e sobrevive ao descarte.
 */
const AQUECIDAS = new Set<string>();

function aquecer(id: string): void {
  if (AQUECIDAS.has(id)) return;
  AQUECIDAS.add(id);
  const modelo = monaco.editor.createModel('', id);
  modelo.dispose();
}

/**
 * O resultado saiu sem cor?
 *
 * `colorize` sempre devolve `<span class="mtkN">`; quando o tokenizador não
 * respondeu a tempo, TODOS saem como `mtk1` — o padrão. Uma classe só é o
 * sintoma, e é o que distingue "não deu tempo" de "este texto é mesmo de uma
 * cor só" (que também é `mtk1`, mas aí colorir de novo não custa nada).
 */
function saiuSemCor(html: string): boolean {
  const classes = new Set(html.match(/mtk\d+/g) ?? []);
  return classes.size <= 1;
}

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

    const id = idDoMonaco(linguagem);
    aquecer(id);

    let vigente = true;
    let repetir: ReturnType<typeof setTimeout> | undefined;

    const colorir = (podeRepetir: boolean): void => {
      void monaco.editor
        .colorize(texto, id, { tabSize })
        .then((r) => {
          // Sem isto, uma colorização lenta de duas teclas atrás sobrescreveria
          // a atual — o bloco mostraria o que já não está escrito nele.
          if (!vigente) return;
          setHtml(r);
          // O tokenizador de algumas linguagens (o do JSON é uma) é carregado
          // por um caminho assíncrono próprio, e a primeira colorização de uma
          // página que nunca abriu aquela linguagem chega antes dele — o texto
          // sai inteiro em `mtk1`, sem erro nenhum. Uma segunda tentativa
          // resolve, e o `podeRepetir` garante que ela é UMA.
          if (podeRepetir && saiuSemCor(r) && id !== LINGUAGEM_PADRAO_MONACO) {
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
