// O bloco de código do caderno: colorido, e ainda assim uma `textarea`.
//
// São duas camadas ocupando o MESMO espaço (spec 050, D17):
//
//   - embaixo, um `<pre>` com o HTML que o Monaco colore — só para ver;
//   - em cima, a `textarea` de sempre, com o texto **transparente** — só para
//     escrever.
//
// O usuário digita na de cima e enxerga a de baixo. É a técnica que o editor
// principal usou até a spec 010, e o que a aposentou lá foi multi-cursor, que
// uma `textarea` não tem por definição do HTML — não desalinhamento.
//
// **Tudo que decide a posição de um caractere vive em `estiloDoTexto` e é usado
// pelas duas camadas.** Fonte, tamanho, entrelinha, recuo, quebra e tabulação:
// se uma delas divergir da outra em um pixel, o cursor passa a mentir. Esse é o
// risco da técnica, e concentrá-lo num objeto só é como ele se paga.
import { CampoColorido } from '../editor/CampoColorido';
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
      onFocar={onFocar}
      onTeclar={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onAtalhoDeRodar();
        }
      }}
    />
  );
}
