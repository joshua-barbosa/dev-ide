// A foto do trecho, numa ABA AO LADO (spec 077).
//
// Era um diálogo, e ele corrigiu com o motivo junto:
//
// > *"ele abre como uma aba e não um dialog — porque eu posso continuar
// > selecionando o texto no arquivo aberto. Ele divide a tela: na esquerda o
// > código que havia selecionado e na direita o preview da imagem."*
//
// Um diálogo tranca a tela: para trocar o trecho era preciso fechar, selecionar
// de novo e reabrir. Ao lado, a foto **acompanha a seleção** — o gesto vira
// selecionar e olhar, e não selecionar, abrir, olhar, fechar.
//
// A prévia é o próprio canvas que vira PNG, e não uma imitação em HTML: duas
// representações discordariam no primeiro ajuste, e o que ele vê não seria o
// que sai.
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import { ESTILO_PADRAO, nomeDaFoto, type EstiloDaFoto } from '../../shared/codesnap';
import { baixarImagem, comoPng, copiarImagem, desenharFoto } from './codesnap-canvas';
// O MESMO módulo que o `EditorHost` carrega — é dele que sai o realce, com o
// tema que está aplicado agora. Um segundo Monaco daria outras cores.

import type { EditorHandle } from './EditorHost';
import type { Paleta } from '../../shared/temas';

export interface PainelDeCodeSnapProps {
  /** O editor DE ONDE vem a seleção — o grupo do arquivo, não o desta aba. */
  readonly editorDeOrigem: EditorHandle | null;
  /** O caminho do arquivo de origem, para dar nome ao PNG. */
  readonly caminhoDeOrigem: string | null;
  /**
   * Muda a cada movimento do cursor.
   *
   * É o gatilho da atualização: o Monaco move o cursor em toda mudança de
   * seleção, então isto é o que faz a foto seguir o que ele está marcando.
   */
  readonly cursor: { readonly linha: number; readonly coluna: number };
  readonly paleta: Paleta;
  onErro(erro: unknown): void;
  avisar(mensagem: string, titulo?: string): Promise<void>;
}

interface Trecho {
  readonly texto: string;
  readonly linguagem: string;
  readonly primeiraLinha: number;
}

export function PainelDeCodeSnap({
  editorDeOrigem, caminhoDeOrigem, cursor, paleta, onErro, avisar,
}: PainelDeCodeSnapProps) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const canvasAtual = useRef<HTMLCanvasElement | null>(null);
  const [numeros, setNumeros] = useState(true);
  const [enfeite, setEnfeite] = useState(true);
  const [moldura, setMoldura] = useState(ESTILO_PADRAO.moldura);
  /**
   * O último trecho com conteúdo.
   *
   * Guardado porque clicar no editor DESMARCA a seleção, e a foto sumiria no
   * gesto mais comum de todos. Enquanto ele não marca outra coisa, fica a
   * última — que é o que ele acabou de fotografar.
   */
  const [trecho, setTrecho] = useState<Trecho | null>(null);

  useEffect(() => {
    if (editorDeOrigem === null) return;
    const atual = editorDeOrigem.trechoDeTrabalho();
    // Sem seleção o trecho seria o arquivo INTEIRO, e a foto piscaria para o
    // documento todo a cada clique. Só seleção de verdade troca a foto.
    if (atual === null || atual.inteiro || atual.texto.trim() === '') return;
    setTrecho({
      texto: atual.texto,
      linguagem: atual.linguagemDoMonaco,
      primeiraLinha: atual.primeiraLinha,
    });
  }, [editorDeOrigem, cursor]);

  useEffect(() => {
    if (trecho === null) return;
    let vivo = true;

    const estilo: EstiloDaFoto = {
      ...ESTILO_PADRAO,
      numeros,
      enfeiteDeJanela: enfeite,
      moldura,
      primeiraLinha: trecho.primeiraLinha,
    };

    // O Monaco entra por `import()` (P7, spec 101): quem tira foto de um
    // trecho já tem um editor aberto, então o pedaço já está em memória — e
    // quem NUNCA usa o CodeSnap deixa de pagar por ele no primeiro desenho.
    import('monaco-editor')
      .then((monaco) =>
        desenharFoto({ texto: trecho.texto, linguagem: trecho.linguagem, estilo, paleta, monaco })
      )
      .then((canvas) => {
        if (!vivo) return;
        canvasAtual.current = canvas;
        const onde = caixa.current;
        if (onde === null) return;
        onde.replaceChildren(canvas);
        // A prévia encolhe para caber; o PNG sai no tamanho inteiro.
        canvas.style.maxWidth = '100%';
        canvas.style.height = 'auto';
        canvas.style.borderRadius = '6px';
      })
      .catch(onErro);

    return () => {
      vivo = false;
    };
  }, [trecho, paleta, numeros, enfeite, moldura, onErro]);

  const comOCanvas = (o: (blob: Blob) => Promise<void> | void) => async (): Promise<void> => {
    const canvas = canvasAtual.current;
    if (canvas === null) return;
    try {
      await o(await comoPng(canvas));
    } catch (e) {
      // Copiar imagem falha em navegador sem `ClipboardItem`, e a mensagem já
      // diz o que fazer — mostrá-la é melhor que o erro genérico da IDE.
      await avisar((e as Error).message, 'CodeSnap');
    }
  };

  return (
    <Box
      data-painel-de-codesnap
      sx={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        bgcolor: tokens.bgEditor,
      }}
    >
      <Box
        ref={caixa}
        data-codesnap-previa
        sx={{
          flex: 1, minHeight: 0, overflow: 'auto', p: 1.5,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        }}
      >
        {trecho === null && (
          <Box sx={{ color: 'text.secondary', fontSize: 12, mt: 4, textAlign: 'center', px: 2 }}>
            Selecione um trecho no editor ao lado.
            <br />A foto acompanha o que você marcar.
          </Box>
        )}
      </Box>

      <Box
        sx={{
          borderTop: 1, borderColor: 'divider', p: 1,
          display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
        }}
      >
        <FormControlLabel
          control={
            <Switch size="small" checked={numeros} onChange={(e) => setNumeros(e.target.checked)} />
          }
          label={<Box sx={{ fontSize: 11.5 }}>Números</Box>}
        />
        <FormControlLabel
          control={
            <Switch size="small" checked={enfeite} onChange={(e) => setEnfeite(e.target.checked)} />
          }
          label={<Box sx={{ fontSize: 11.5 }}>Barra da janela</Box>}
        />
        <TextField
          size="small"
          type="number"
          label="Moldura"
          value={moldura}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) setMoldura(Math.max(0, Math.min(120, n)));
          }}
          slotProps={{ inputLabel: { sx: { fontSize: 11 } }, htmlInput: { min: 0, max: 120 } }}
          sx={{ width: 96, '& input': { fontSize: 11.5 } }}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          disabled={trecho === null}
          startIcon={<Icon name="lucide:download" size={13} />}
          onClick={comOCanvas((blob) => {
            void baixarImagem(blob, nomeDaFoto(caminhoDeOrigem, trecho?.primeiraLinha ?? 1));
          })}
          sx={{ fontSize: 11.5 }}
        >
          Salvar PNG
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={trecho === null}
          startIcon={<Icon name="lucide:copy" size={13} />}
          onClick={comOCanvas(copiarImagem)}
          sx={{ fontSize: 11.5 }}
        >
          Copiar imagem
        </Button>
      </Box>
    </Box>
  );
}
