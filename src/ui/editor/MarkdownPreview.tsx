// Markdown renderizado, no lugar do texto do arquivo.
//
// **Usa `dangerouslySetInnerHTML`, e isso é deliberado.** A alternativa —
// montar componentes React a partir dos tokens — reimplementaria em algumas
// centenas de linhas o que o gerador de HTML já faz, e sem ganhar segurança:
// o que protege aqui é o endurecimento em `shared/markdown.ts`, que neutraliza
// HTML bruto do documento e recusa esquema de URL perigoso. Aquilo tem teste
// com as cargas reais; é lá que a garantia mora, não neste arquivo.
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { renderizarMarkdown } from '../../shared/markdown';
import { tokens } from '../theme';

export interface MarkdownPreviewProps {
  readonly fonte: string;
}

export function MarkdownPreview({ fonte }: MarkdownPreviewProps) {
  // Renderizar a cada tecla seria refazer o documento inteiro por caractere.
  const html = useMemo(() => renderizarMarkdown(fonte), [fonte]);

  return (
    <Box
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
