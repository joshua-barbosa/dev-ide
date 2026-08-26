// Imagem, PDF e CSV abertos na IDE (T027 · spec 024).
//
// Na spec 024 eu listei os três nos `Non-Goals` sem escrever desculpa nenhuma.
// Clicar num `.png` na árvore tentava abri-lo como TEXTO, e o Monaco recebia
// bytes que não são texto.
//
// Os três chegam por caminhos diferentes, e é isso que decide o desenho:
//   - imagem e PDF são BYTES, e vêm por `/api/file/raw` — o navegador desenha;
//   - CSV é TEXTO, e vai para a mesma grade dos resultados de query.
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { ResultGrid } from '../grid/ResultGrid';
import { tokens } from '../theme';
import { lerTabular, separadorDe, type Visualizador } from '../../shared/editor/visualizadores';
import type { CellValue } from '../../shared/contracts';

export interface VisualizadorDeArquivoProps {
  readonly tipo: Visualizador;
  readonly caminho: string;
  /** Só para CSV: o texto já lido. Imagem e PDF vêm pela URL. */
  readonly conteudo: string;
}

/** A URL dos bytes. O caminho vai codificado — ele tem barras e acentos. */
function urlBruta(caminho: string): string {
  return `/api/file/raw?path=${encodeURIComponent(caminho)}`;
}

export function VisualizadorDeArquivo({ tipo, caminho, conteudo }: VisualizadorDeArquivoProps) {
  if (tipo === 'imagem') return <Imagem caminho={caminho} />;
  if (tipo === 'pdf') return <Pdf caminho={caminho} />;
  return <Csv caminho={caminho} conteudo={conteudo} />;
}

function Imagem({ caminho }: { readonly caminho: string }) {
  const [erro, setErro] = useState(false);
  const [ampliada, setAmpliada] = useState(false);

  return (
    <Box
      data-visualizador="imagem"
      onClick={() => setAmpliada((v) => !v)}
      sx={{
        flex: 1, minHeight: 0, overflow: 'auto', bgcolor: tokens.bgEditor,
        display: 'flex', alignItems: ampliada ? 'flex-start' : 'center',
        justifyContent: ampliada ? 'flex-start' : 'center',
        p: 2, cursor: 'zoom-in',
        ...(ampliada ? { cursor: 'zoom-out' } : {}),
      }}
    >
      {erro ? (
        <Box sx={{ color: 'error.main', fontSize: 12 }}>Não deu para abrir esta imagem.</Box>
      ) : (
        <Box
          component="img"
          src={urlBruta(caminho)}
          alt={caminho}
          onError={() => setErro(true)}
          sx={
            ampliada
              ? { maxWidth: 'none' }
              : // Cabe na tela por padrão: uma foto de 6000 px abrindo em
                // tamanho real deixaria o usuário olhando um pedaço de pixel.
                { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
          }
        />
      )}
    </Box>
  );
}

function Pdf({ caminho }: { readonly caminho: string }) {
  return (
    <Box
      data-visualizador="pdf"
      component="iframe"
      src={urlBruta(caminho)}
      title={caminho}
      // `sandbox` vazio: o PDF é desenhado pelo visualizador do navegador, que
      // não precisa de script nem de acesso à origem. Um PDF pode conter
      // JavaScript, e sem isto ele rodaria com as permissões da IDE.
      sandbox=""
      sx={{ flex: 1, minHeight: 0, border: 0, bgcolor: tokens.bgEditor }}
    />
  );
}

function Csv({ caminho, conteudo }: { readonly caminho: string; readonly conteudo: string }) {
  const resultado = useMemo(() => {
    const primeira = conteudo.split('\n', 1)[0] ?? '';
    const sep = separadorDe(caminho, primeira);
    const { linhas, truncado } = lerTabular(conteudo, sep);
    const [cabecalho, ...resto] = linhas;
    if (cabecalho === undefined) return null;
    return {
      // A primeira linha é o cabeçalho: é o que todo CSV de verdade tem, e o
      // que a grade precisa para nomear as colunas. Quando não for, o usuário
      // vê a primeira linha virar título — e isso é visível, não silencioso.
      columns: cabecalho.map((nome, i) => ({ name: nome === '' ? `coluna ${i + 1}` : nome })),
      rows: resto.map((l) => l as readonly CellValue[]),
      rowCount: resto.length,
      durationMs: 0,
      truncated: truncado,
    };
  }, [caminho, conteudo]);

  if (resultado === null) {
    return (
      <Box data-visualizador="csv" sx={{ flex: 1, p: 2, fontSize: 12, color: 'text.secondary' }}>
        Arquivo vazio.
      </Box>
    );
  }

  return (
    <Box data-visualizador="csv" sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {/* A MESMA grade dos resultados de query: ordenação, largura de coluna
          arrastável e a lupa vêm de graça. Escrever uma segunda tabela aqui
          seria manter duas. */}
      <ResultGrid resultado={resultado} rotulo={caminho.split('/').pop() ?? caminho} />
    </Box>
  );
}
