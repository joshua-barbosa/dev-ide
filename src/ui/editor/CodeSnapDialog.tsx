// A janela do CodeSnap: prévia, ajustes e as duas saídas.
//
// Prévia de verdade — o próprio canvas que vai virar PNG, e não uma imitação em
// HTML. Duas representações discordariam no primeiro ajuste, e o que ele veria
// não seria o que sairia.
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { Icon } from '../Icon';
import { ESTILO_PADRAO, nomeDaFoto, type EstiloDaFoto } from '../../shared/codesnap';
import { baixarImagem, comoPng, copiarImagem, desenharFoto } from './codesnap-canvas';
// O MESMO módulo que o `EditorHost` carrega — é dele que sai o realce, com o
// tema que está aplicado agora. Um segundo Monaco daria outras cores.
import * as monaco from 'monaco-editor';
import type { Paleta } from '../../shared/temas';

export interface PedidoDeCodeSnap {
  readonly texto: string;
  readonly linguagem: string;
  readonly primeiraLinha: number;
  readonly caminho: string | null;
}

export interface CodeSnapDialogProps {
  /** `null` fecha a janela. */
  readonly pedido: PedidoDeCodeSnap | null;
  readonly paleta: Paleta;
  onFechar(): void;
  onErro(erro: unknown): void;
  avisar(mensagem: string, titulo?: string): Promise<void>;
}

export function CodeSnapDialog({
  pedido, paleta, onFechar, onErro, avisar,
}: CodeSnapDialogProps) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const canvasAtual = useRef<HTMLCanvasElement | null>(null);
  const [numeros, setNumeros] = useState(true);
  const [enfeite, setEnfeite] = useState(true);
  const [moldura, setMoldura] = useState(ESTILO_PADRAO.moldura);

  useEffect(() => {
    if (pedido === null) return;
    let vivo = true;

    const estilo: EstiloDaFoto = {
      ...ESTILO_PADRAO,
      numeros,
      enfeiteDeJanela: enfeite,
      moldura,
      primeiraLinha: pedido.primeiraLinha,
    };

    desenharFoto({ texto: pedido.texto, linguagem: pedido.linguagem, estilo, paleta, monaco })
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
  }, [pedido, paleta, numeros, enfeite, moldura, onErro]);

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
    <Dialog open={pedido !== null} onClose={onFechar} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontSize: 14 }}>Foto do trecho</DialogTitle>
      <DialogContent dividers>
        <Box
          ref={caixa}
          data-codesnap-previa
          sx={{
            display: 'flex', justifyContent: 'center', p: 1,
            maxHeight: '60vh', overflow: 'auto',
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1.5, flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Switch size="small" checked={numeros} onChange={(e) => setNumeros(e.target.checked)} />
            }
            label={<Box sx={{ fontSize: 12 }}>Números da linha</Box>}
          />
          <FormControlLabel
            control={
              <Switch size="small" checked={enfeite} onChange={(e) => setEnfeite(e.target.checked)} />
            }
            label={<Box sx={{ fontSize: 12 }}>Barra da janela</Box>}
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
            slotProps={{ inputLabel: { sx: { fontSize: 12 } }, htmlInput: { min: 0, max: 120 } }}
            sx={{ width: 110, '& input': { fontSize: 12 } }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onFechar} sx={{ fontSize: 12 }}>
          Fechar
        </Button>
        <Button
          size="small"
          startIcon={<Icon name="lucide:download" size={13} />}
          onClick={comOCanvas((blob) => {
            baixarImagem(blob, nomeDaFoto(pedido?.caminho ?? null, pedido?.primeiraLinha ?? 1));
          })}
          sx={{ fontSize: 12 }}
        >
          Salvar PNG
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<Icon name="lucide:copy" size={13} />}
          onClick={comOCanvas(copiarImagem)}
          sx={{ fontSize: 12 }}
        >
          Copiar imagem
        </Button>
      </DialogActions>
    </Dialog>
  );
}
