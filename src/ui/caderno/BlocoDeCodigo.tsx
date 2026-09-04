// O bloco de código do caderno: duas camadas quando parado, Monaco quando em foco.
//
// **Parado** são duas camadas ocupando o mesmo espaço (spec 050, D17): embaixo
// um `<pre>` colorido, em cima uma `textarea` de texto transparente. É barato —
// um caderno de trinta blocos não paga trinta editores.
//
// **Em foco** entra o Monaco de verdade (T073, spec 071). A desculpa que eu
// tinha escrito para não ter multi-cursor era *"o bloco é pequeno"*, e ele
// respondeu na triagem com o desenho certo: *"Monaco só no bloco em foco"*.
// Assim o bloco que está sendo escrito tem multi-cursor, busca e dobradura, e
// os outros vinte e nove continuam custando um `<pre>`.
//
// A posição do cursor ATRAVESSA a troca. Sem isso, clicar no meio de uma linha
// levaria o cursor para o começo do bloco — o gesto mais comum de todos ficaria
// irritante.
import { lazy, Suspense, useState } from 'react';
import { CampoColorido } from '../editor/CampoColorido';

// O bloco em FOCO vira Monaco; os outros ficam no `CampoColorido`, que já era
// a decisão D17. Trazer o Monaco por `import()` (P7, spec 101) faz um caderno
// que nunca ganhou foco não pagar por ele — e faz o resto da IDE não esperar.
// Enquanto ele não chega, quem aparece é o MESMO campo colorido de antes: o
// bloco não pisca em branco nem perde o texto.
const EditorDoBloco = lazy(async () => ({
  default: (await import('./EditorDoBloco')).EditorDoBloco,
}));
import type { NomeDoTema } from '../../shared/temas';

export interface BlocoDeCodigoProps {
  readonly id: string;
  readonly conteudo: string;
  readonly linguagem: string;
  readonly rotulo: string;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  onAlterar(conteudo: string): void;
  onAtalhoDeRodar(): void;
  onFocar(): void;
}

/** As linhas que a `textarea` mostra sem rolar: nem apertada, nem uma página. */
function alturaEmLinhas(conteudo: string): number {
  return Math.min(20, Math.max(3, conteudo.split('\n').length + 1));
}

export function BlocoDeCodigo({
  id, conteudo, linguagem, rotulo, fontSize, tabSize, tema, onAlterar, onAtalhoDeRodar, onFocar,
}: BlocoDeCodigoProps) {
  /** Onde o cursor estava quando o Monaco entrou. `null` = camada de texto. */
  const [editando, setEditando] = useState<number | null>(null);

  /** O que ocupa o lugar enquanto o Monaco do bloco não chegou: o campo de antes. */
  const CampoDeTexto = () => (
    <CampoColorido
      valor={conteudo}
      linguagem={linguagem}
      tema={tema}
      fontSize={fontSize}
      tabSize={tabSize}
      rotulo={rotulo}
      linhas={alturaEmLinhas(conteudo)}
      marcaDoTexto={{ 'data-conteudo': id }}
      marcaDaCor={{ 'data-colorido': id }}
      onAlterar={onAlterar}
    />
  );

  if (editando !== null) {
    return (
      <Suspense fallback={<CampoDeTexto />}>
      <EditorDoBloco
        conteudo={conteudo}
        linguagem={linguagem}
        rotulo={rotulo}
        fontSize={fontSize}
        tabSize={tabSize}
        tema={tema}
        cursorEm={editando}
        onAlterar={onAlterar}
        onAtalhoDeRodar={onAtalhoDeRodar}
        onSair={() => setEditando(null)}
      />
      </Suspense>
    );
  }

  return (
    <CampoColorido
      valor={conteudo}
      linguagem={linguagem}
      tema={tema}
      fontSize={fontSize}
      tabSize={tabSize}
      rotulo={rotulo}
      linhas={alturaEmLinhas(conteudo)}
      marcaDoTexto={{ 'data-conteudo': id }}
      marcaDaCor={{ 'data-colorido': id }}
      onAlterar={onAlterar}
      onFocar={(cursor) => {
        onFocar();
        // O Monaco entra AQUI, levando junto onde o cursor estava. `?? 0` para
        // o foco por teclado, que não tem posição de clique.
        setEditando(cursor ?? 0);
      }}
      onTeclar={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onAtalhoDeRodar();
        }
      }}
    />
  );
}
