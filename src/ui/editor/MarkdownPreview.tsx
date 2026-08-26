// Markdown renderizado, no lugar do texto do arquivo.
//
// **Usa `dangerouslySetInnerHTML`, e isso é deliberado.** A alternativa —
// montar componentes React a partir dos tokens — reimplementaria em algumas
// centenas de linhas o que o gerador de HTML já faz, e sem ganhar segurança:
// o que protege aqui é o endurecimento em `shared/markdown.ts`, que neutraliza
// HTML bruto do documento e recusa esquema de URL perigoso. Aquilo tem teste
// com as cargas reais; é lá que a garantia mora, não neste arquivo.
import { useEffect, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import { CLASSE_DO_MERMAID, renderizarMarkdown } from '../../shared/markdown';
import { acharFormulas } from '../../shared/matematica';
import { tokens } from '../theme';

export interface MarkdownPreviewProps {
  readonly fonte: string;
}

export function MarkdownPreview({ fonte }: MarkdownPreviewProps) {
  // Renderizar a cada tecla seria refazer o documento inteiro por caractere.
  const html = useMemo(() => renderizarMarkdown(fonte), [fonte]);
  const caixa = useRef<HTMLDivElement>(null);

  // Mermaid e KaTeX depois de o HTML estar no DOM (T026).
  //
  // As duas bibliotecas entram por `import()` DINÂMICO, e só quando o documento
  // tem o que elas desenham: o mermaid sozinho passa de um megabyte, e cobrá-lo
  // de quem abre um README simples seria pagar por todos o preço de poucos.
  useEffect(() => {
    const alvo = caixa.current;
    if (alvo === null) return;
    let vigente = true;

    const diagramas = [...alvo.querySelectorAll<HTMLElement>(`.${CLASSE_DO_MERMAID}`)];
    if (diagramas.length > 0) {
      void import('mermaid').then(async ({ default: mermaid }) => {
        if (!vigente) return;
        mermaid.initialize({
          startOnLoad: false,
          // `strict` escapa o HTML dentro dos rótulos do diagrama. É a mesma
          // decisão do renderizador de markdown: nada que veio do arquivo
          // chega ao DOM como marcação.
          securityLevel: 'strict',
          theme: 'dark',
        });
        for (const [i, no] of diagramas.entries()) {
          const codigo = no.dataset.fonte ?? '';
          try {
            const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i}`, codigo);
            if (!vigente) return;
            no.innerHTML = svg;
          } catch (e) {
            // Diagrama com erro de sintaxe mostra a MENSAGEM, e não some. Um
            // bloco em branco pareceria a IDE quebrada.
            no.textContent = `Diagrama inválido: ${(e as Error).message}`;
            no.setAttribute('data-mermaid-erro', 'true');
          }
        }
      });
    }

    if (acharFormulas(fonte).length > 0) {
      void Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
        ([{ default: katex }]) => {
          if (!vigente) return;
          renderizarFormulas(alvo, katex);
        }
      );
    }

    return () => {
      vigente = false;
    };
  }, [html, fonte]);

  return (
    <Box
      ref={caixa}
      data-markdown-preview
      // O conteúdo vem endurecido de `shared/markdown.ts` — ver o comentário do
      // topo, e os testes de carga que o acompanham.
      dangerouslySetInnerHTML={{ __html: html }}
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'auto',
        bgcolor: tokens.bgEditor,
        color: 'text.primary',
        px: 4,
        py: 3,
        fontFamily: tokens.fontUi,
        fontSize: 14,
        lineHeight: 1.65,
        // Largura de leitura: linha cheia de monitor largo cansa a vista, e é o
        // que todo visualizador de markdown limita.
        '& > *': { maxWidth: 900 },

        '& h1, & h2, & h3, & h4': { mt: 3, mb: 1.5, lineHeight: 1.3, fontWeight: 600 },
        '& h1': { fontSize: 28, borderBottom: 1, borderColor: 'divider', pb: 1 },
        '& h2': { fontSize: 22, borderBottom: 1, borderColor: 'divider', pb: 0.75 },
        '& h3': { fontSize: 18 },
        '& h4': { fontSize: 15 },
        '& p': { my: 1.5 },
        '& a': { color: 'primary.main' },
        '& ul, & ol': { pl: 3, my: 1.5 },
        '& li': { my: 0.4 },
        '& li > input[type="checkbox"]': { mr: 1 },

        '& blockquote': {
          my: 2,
          ml: 0,
          pl: 2,
          borderLeft: 3,
          borderColor: 'primary.main',
          color: 'text.secondary',
        },

        '& code': {
          fontFamily: tokens.fontMono,
          fontSize: 12.5,
          bgcolor: 'background.paper',
          px: 0.6,
          py: 0.2,
          borderRadius: 0.5,
        },
        '& pre': {
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          p: 1.5,
          overflow: 'auto',
        },
        // Dentro do bloco, o fundo já é o do `pre`; repetir cria caixa na caixa.
        '& pre code': { bgcolor: 'transparent', p: 0, fontSize: 12.5 },

        '& table': { borderCollapse: 'collapse', my: 2, display: 'block', overflowX: 'auto' },
        '& th, & td': { border: 1, borderColor: 'divider', px: 1.25, py: 0.6, textAlign: 'left' },
        '& th': { bgcolor: 'background.paper', fontWeight: 600 },

        '& hr': { border: 0, borderTop: 1, borderColor: 'divider', my: 3 },
        '& img': { maxWidth: '100%' },
      }}
    />
  );
}

/**
 * Troca as fórmulas por KaTeX, andando pelos nós de TEXTO (T026).
 *
 * Pelos nós de texto, e não por `innerHTML`: uma troca por expressão regular no
 * HTML inteiro pegaria um `$` que está dentro de um atributo ou de um bloco de
 * código, e quebraria a marcação. Aqui só o que é texto visível é olhado.
 *
 * `<pre>` e `<code>` ficam de fora: dentro de bloco de código, `$x$` é o texto
 * `$x$` — é justamente ali que se escreve `$HOME` e `R$ 10`.
 */
function renderizarFormulas(
  raiz: HTMLElement,
  // Só o que este arquivo usa: pedir o módulo inteiro amarraria a assinatura a
  // um tipo que muda com a versão do KaTeX, sem ganho nenhum.
  katex: { render: (tex: string, alvo: HTMLElement, opcoes?: object) => void }
): void {
  const passeio = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode: (no) =>
      no.parentElement?.closest('pre, code, .katex') === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });

  const textos: Text[] = [];
  for (let no = passeio.nextNode(); no !== null; no = passeio.nextNode()) {
    if (no.textContent !== null && no.textContent.includes('$')) textos.push(no as Text);
  }

  for (const no of textos) {
    const texto = no.textContent ?? '';
    const formulas = acharFormulas(texto);
    if (formulas.length === 0) continue;

    const pedaco = document.createDocumentFragment();
    let cursor = 0;
    for (const f of formulas) {
      if (f.inicio > cursor) {
        pedaco.append(document.createTextNode(texto.slice(cursor, f.inicio)));
      }
      const alvo = document.createElement(f.modo === 'bloco' ? 'div' : 'span');
      try {
        katex.render(f.conteudo, alvo, {
          displayMode: f.modo === 'bloco',
          // `trust: false` (o padrão) recusa `\href`, `\url` e companhia — os
          // comandos que produzem marcação arbitrária. `throwOnError: false`
          // faz fórmula errada aparecer em vermelho em vez de derrubar tudo.
          throwOnError: false,
        });
      } catch {
        alvo.textContent = texto.slice(f.inicio, f.fim);
      }
      pedaco.append(alvo);
      cursor = f.fim;
    }
    if (cursor < texto.length) pedaco.append(document.createTextNode(texto.slice(cursor)));
    no.parentNode?.replaceChild(pedaco, no);
  }
}
