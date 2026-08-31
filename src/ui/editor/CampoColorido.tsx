// Um campo de texto COM COR, sem instanciar editor (specs 050 e 071).
//
// Duas camadas: um `<pre>` pintado pelo colorizador do Monaco embaixo, e uma
// `textarea` de texto transparente por cima. A de cima recebe o cursor, a
// seleção e as teclas; a de baixo só mostra.
//
// **Tudo que decide a posição de um caractere vive em `estiloDoTexto`, e é usado
// pelas duas.** Uma diferença de padding, de `line-height` ou de `tab-size`
// desalinha as camadas — e o sintoma é o texto colorido "escorregando" do
// cursor, que é péssimo de diagnosticar e trivial de evitar.
//
// Nasceu no bloco do caderno (spec 050) e virou componente quando o campo de
// SQL da aba de tabela precisou do mesmo (T059). A desculpa que eu tinha
// escrito para não colorir lá era *"é `textarea`, não Monaco"* — e o caderno já
// provava que a cor não precisa de Monaco montado.
import { useRef } from 'react';
import Box from '@mui/material/Box';
import { useColorido } from '../caderno/colorir';
import { tokens } from '../theme';
import { TEMAS, type NomeDoTema } from '../../shared/temas';

export interface CampoColoridoProps {
  readonly valor: string;
  readonly linguagem: string;
  readonly tema: NomeDoTema;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly rotulo: string;
  readonly linhas: number;
  onAlterar(valor: string): void;
  onTeclar?(e: React.KeyboardEvent): void;
  /**
   * O campo ganhou foco, e ONDE o cursor caiu — em caracteres desde o começo.
   *
   * A posição existe por causa do T073: o bloco do caderno troca esta camada
   * pelo Monaco ao receber foco, e sem ela o cursor voltaria para o começo do
   * bloco a cada clique no meio de uma linha.
   */
  onFocar?(cursorEm: number): void;
  /**
   * Atributos de teste das duas camadas — cada tela tem os seus.
   *
   * Mapa, e não nome solto: o caderno marca com `data-conteudo="<id do bloco>"`
   * e a aba de tabela com `data-sql-da-tabela`. Um só formato não serviria aos
   * dois sem inventar valor onde não há.
   */
  readonly marcaDoTexto?: Readonly<Record<string, string | boolean>>;
  readonly marcaDaCor?: Readonly<Record<string, string | boolean>>;
  /**
   * `sx` extra da `textarea` — altura, borda, fundo.
   *
   * **O que decide a posição de um caractere NÃO passa por aqui.** Fonte,
   * entrelinha, padding e `tab-size` são reaplicados depois deste `sx`, e por
   * isso não há como um chamador desalinhar as camadas. Já houve: a aba de
   * tabela mandava `fontSize: 11` só para a `textarea`, o texto colorido ficava
   * maior que o invisível, e clicar no fim de uma palavra punha o cursor no
   * meio dela.
   */
  readonly sx?: Record<string, unknown>;
}

export function estiloDoTexto(fontSize: number, tabSize: number) {
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

export function CampoColorido({
  valor, linguagem, tema, fontSize, tabSize, rotulo, linhas,
  onAlterar, onTeclar, onFocar, marcaDoTexto, marcaDaCor, sx,
}: CampoColoridoProps) {
  const colorido = useColorido(valor, linguagem, tema, tabSize);
  const camada = useRef<HTMLPreElement>(null);
  const comum = estiloDoTexto(fontSize, tabSize);
  const paleta = TEMAS[tema];

  return (
    <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <Box
        component="pre"
        ref={camada}
        {...(marcaDaCor ?? {})}
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
        {...(marcaDoTexto ?? {})}
        aria-label={rotulo}
        spellCheck={false}
        value={valor}
        onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) =>
          onFocar?.(e.currentTarget.selectionStart ?? 0)
        }
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onAlterar(e.target.value)}
        onScroll={(e: React.UIEvent<HTMLTextAreaElement>) => {
          // Rolagem à mão: são dois elementos, e só um deles rola sozinho.
          const pre = camada.current;
          if (pre === null) return;
          pre.scrollTop = e.currentTarget.scrollTop;
          pre.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onKeyDown={onTeclar}
        rows={linhas}
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
          ...sx,
          // DEPOIS do `sx`, e de propósito: ver a nota na propriedade. As duas
          // camadas medem o caractere igual, ou o cursor descola do texto.
          fontFamily: comum.fontFamily,
          fontSize: comum.fontSize,
          lineHeight: comum.lineHeight,
          letterSpacing: comum.letterSpacing,
          padding: comum.padding,
          tabSize: comum.tabSize,
          whiteSpace: comum.whiteSpace,
          overflowWrap: comum.overflowWrap,
          wordBreak: comum.wordBreak,
        }}
      />
    </Box>
  );
}
