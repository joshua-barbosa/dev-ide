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
import { ligarZoom } from './zoomDeDiagrama';
import { tokens } from '../theme';

export interface MarkdownPreviewProps {
  readonly fonte: string;
}

/** A mensagem de um erro, sem supor que ele é um `Error`. */
function mensagemDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
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
    // A LISTA é relida depois do `import()`, e não capturada antes.
    //
    // O mermaid leva mais de um segundo para carregar na primeira vez, e nesse
    // intervalo o React pode ter trocado o HTML do preview — os nós capturados
    // antes já não estão na tela, e escrever neles não desenha nada. O sintoma
    // era um diagrama VAZIO, sem erro nenhum: o desenho ia para um nó órfão.
    //
    // Achado com o diagrama ER (T064), que abre a aba JÁ em preview e portanto
    // cai na corrida toda vez. O preview comum tinha o mesmo defeito desde a
    // spec 068 — só precisava de azar.
    if (alvo.querySelector(`.${CLASSE_DO_MERMAID}`) !== null) {
      void import('mermaid').catch((erro: unknown) => {
        // Ver a nota do KaTeX abaixo: carga que falha em silêncio some com o
        // desenho e não deixa dizer por quê.
        if (alvo.isConnected) alvo.setAttribute('data-mermaid-erro-de-carga', mensagemDoErro(erro));
        return null;
      }).then(async (mod) => {
        if (mod === null) return;
        const { default: mermaid } = mod;
        mermaid.initialize({
          startOnLoad: false,
          // `strict` escapa o HTML dentro dos rótulos do diagrama. É a mesma
          // decisão do renderizador de markdown: nada que veio do arquivo
          // chega ao DOM como marcação.
          securityLevel: 'strict',
          theme: 'dark',
        });
        const atuais = [...alvo.querySelectorAll<HTMLElement>(`.${CLASSE_DO_MERMAID}`)];
        for (const [i, no] of atuais.entries()) {
          // Já desenhado por uma passagem anterior: não redesenha.
          if (no.querySelector('svg') !== null) continue;
          // A TELA DIZ O QUE ESTÁ FAZENDO.
          //
          // Um diagrama de 105 tabelas leva segundos, e antes disto o bloco
          // ficava vazio e mudo. Ele olhou e escreveu: "não sei se está
          // rodando, se está travado, se não está fazendo nada". Um retângulo
          // em branco não distingue as três coisas — e essa é a informação que
          // mais importa enquanto se espera.
          no.textContent = 'desenhando o diagrama…';
          no.setAttribute('data-mermaid-desenhando', 'true');
          const codigo = no.dataset.fonte ?? '';
          try {
            const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i}`, codigo);
            if (!no.isConnected) continue;
            no.removeAttribute('data-mermaid-desenhando');
            no.innerHTML = svg;
            // Sem zoom, um diagrama de 40 tabelas vira uma fileira de tarjas
            // ilegíveis — foi exatamente a reclamação dele, com print.
            ligarZoom(no);
          } catch (e) {
            // Diagrama com erro de sintaxe mostra a MENSAGEM, e não some. Um
            // bloco em branco pareceria a IDE quebrada.
            if (!no.isConnected) continue;
            no.removeAttribute('data-mermaid-desenhando');
            no.textContent = `Diagrama inválido: ${(e as Error).message}`;
            no.setAttribute('data-mermaid-erro', 'true');
          }
        }
      });
    }

    if (acharFormulas(fonte).length > 0) {
      void Promise.all([import('katex'), import('katex/dist/katex.min.css')])
        .then(([{ default: katex }]) => {
          // Mesma razão do mermaid: o que decide é o nó ainda estar na tela.
          if (!alvo.isConnected) return;
          renderizarFormulas(alvo, katex);
        })
        // **A carga que falha não pode falhar em silêncio.**
        //
        // Sem isto, um `import()` recusado deixava a fórmula como o texto cru
        // `$x^2$`, sem erro, sem aviso e sem rastro — quem olhasse concluiria
        // que a IDE não sabe fórmula. O diagrama já mostrava a mensagem quando
        // o desenho falhava (`data-mermaid-erro`); a CARGA das duas bibliotecas
        // é que não mostrava nada.
        //
        // A marca fica no nó: é o que um teste pode afirmar e o que um relato
        // dele pode citar.
        .catch((erro: unknown) => {
          if (!alvo.isConnected) return;
          alvo.setAttribute('data-formula-erro', mensagemDoErro(erro));
        });
    }

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
        // Largura de leitura para TEXTO. O diagrama é exceção: ele tem janela
        // própria, com zoom e arrasto, e espremê-lo em 900 px foi o que o
        // tornou ilegível.
        '& > *': { maxWidth: 900 },
        '& > .mermaid-por-desenhar': { maxWidth: 'none' },
        // Enquanto desenha, o bloco diz que está desenhando.
        '& .mermaid-por-desenhar[data-mermaid-desenhando]': {
          color: 'text.secondary',
          fontSize: 12,
          fontStyle: 'italic',
          py: 2,
        },

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
