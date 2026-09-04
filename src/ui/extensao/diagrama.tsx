// O diagrama ER desenhado, numa aba do editor.
//
// Eu tinha aberto o markdown e chamado `markdown.showPreviewToSide`, dizendo num
// comentário que o VS Code desenha Mermaid nativamente. **Não desenha** — isso
// vem de extensão de terceiro. O que ele viu foi o `erDiagram` cru num bloco de
// código, com um texto em cima falando de roda e arrastar que não valiam ali.
//
// Aqui é o `MarkdownPreview` da IDE, que carrega o Mermaid e tem o zoom e o
// arrasto que aquele texto promete. Pacote próprio porque o Mermaid passa de um
// megabyte, e as abas de filtro e criação não têm por que carregá-lo.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownPreview } from '../editor/MarkdownPreview';
import { ComTemaDoEditor } from './ComTemaDoEditor';
import { definirBaseDaApi } from '../api-http';
import { ligarPonte } from './ponte';

declare const BRAYTECH: {
  readonly base: string;
  readonly markdown: string;
};

ligarPonte();
definirBaseDaApi(BRAYTECH.base);

const raiz = document.getElementById('raiz');
if (raiz !== null) {
  createRoot(raiz).render(
    <StrictMode>
      <ComTemaDoEditor>
        <MarkdownPreview fonte={BRAYTECH.markdown} />
      </ComTemaDoEditor>
    </StrictMode>
  );
}
