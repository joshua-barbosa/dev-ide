// O bloco de código do caderno: colorido, e ainda assim uma `textarea`.
//
// São duas camadas ocupando o MESMO espaço (spec 050, D15):
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
import { useRef } from 'react';
import Box from '@mui/material/Box';
import { useColorido } from './colorir';
import { tokens } from '../theme';
import { TEMAS, type NomeDoTema } from '../../shared/temas';

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

function estiloDoTexto(fontSize: number, tabSize: number) {
  return {
    margin: 0,
    padding: '8px',
    fontFamily: tokens.fontMono,
    fontSize: `${fontSize}px`,
    lineHeight: 1.5,
    // As três que decidem onde uma linha quebra. A `textarea` quebra assim por
    // padrão; o `<pre>` só quebra igual se mandarem.
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'break-word' as const,
    wordBreak: 'normal' as const,
    tabSize,
    border: 0,
    letterSpacing: 'normal',
  };
}

export function BlocoDeCodigo({
  id, conteudo, linguagem, rotulo, fontSize, tabSize, tema, onAlterar, onAtalhoDeRodar, onFocar,
}: BlocoDeCodigoProps) {
  const colorido = useColorido(conteudo, linguagem, tema, tabSize);
  const camada = useRef<HTMLPreElement>(null);
  const comum = estiloDoTexto(fontSize, tabSize);
  const paleta = TEMAS[tema];

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        component="pre"
        ref={camada}
        data-colorido={id}
        // Quem lê a tela já ouve o conteúdo pela `textarea`; ouvir duas vezes,
        // uma delas sem poder editar, seria ruído.
        aria-hidden
        sx={{
          ...comum,
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          // Sem isto a camada de baixo roubaria o clique e o cursor nunca
          // chegaria à `textarea`.
          pointerEvents: 'none',
          color: paleta.fg,
        }}
        // O HTML vem do colorizador do Monaco, que escapa o texto — ver o
        // cabeçalho de `colorir.ts`.
        dangerouslySetInnerHTML={{ __html: colorido ?? '' }}
      />
      <Box
        component="textarea"
        data-conteudo={id}
        aria-label={rotulo}
        spellCheck={false}
        value={conteudo}
        onFocus={onFocar}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onAlterar(e.target.value)}
        onScroll={(e: React.UIEvent<HTMLTextAreaElement>) => {
          // Rolagem à mão: são dois elementos, e só um deles rola sozinho.
          const pre = camada.current;
          if (pre === null) return;
          pre.scrollTop = e.currentTarget.scrollTop;
          pre.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onAtalhoDeRodar();
          }
        }}
        rows={alturaEmLinhas(conteudo)}
        sx={{
          ...comum,
          position: 'relative',
          width: '100%',
          display: 'block',
          outline: 'none',
          resize: 'vertical',
          bgcolor: 'transparent',
          // O texto é invisível — quem aparece é o de baixo. O cursor não:
          // `caretColor` é a única parte da `textarea` que continua pintada.
          color: 'transparent',
          caretColor: paleta.fg,
          // Seleção translúcida de propósito: opaca, ela cobriria o texto
          // colorido e o trecho selecionado viraria uma tarja lisa.
          '&::selection': { bgcolor: `${paleta.accent}55` },
        }}
      />
    </Box>
  );
}
