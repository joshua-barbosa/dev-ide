// A resposta da célula HTTP, embaixo dela (spec 120, etapa 1).
//
// O que ele escolheu ver (28/10): Body formatado e Raw, Preview do HTML,
// Headers, status + tempo + tamanho, e binário visto e salvo em disco.
//
// O Preview roda num iframe SEM scripts (`sandbox` vazio): a página que voltou
// é de outro servidor, e não pode executar nada dentro da IDE.
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../../Icon';
import { tokens } from '../../theme';
import { useColorido } from '../../caderno/colorir';
import { baixarArquivo, dentroDoEditor } from '../../arquivos/transferencia';
import { ApiDoNotebook } from '../../api-notebook';
import { daCarga } from '../../../shared/arquivos/carga';
import { estiloDaAba } from './estilos';
import type { NomeDoTema } from '../../../shared/temas';
import type { SaidaHttp } from '../../../shared/notebook/http';
import { formatarCorpo, linguagemDoCorpo, nomeParaSalvar, tamanhoLegivel } from '../../../shared/notebook/http-resposta';

type Aba = 'pretty' | 'raw' | 'preview' | 'headers';

/** Acima disto o corpo aparece sem cor: colorir 1 MB travaria a tela. */
const MAX_PARA_COLORIR = 200 * 1024;
const ALTURA = 360;

const corDoStatus = (status: number): string =>
  status >= 500 ? 'error.main' : status >= 400 ? 'warning.main' : status >= 300 ? 'info.main' : 'success.main';

function CorpoColorido({ texto, linguagem, tema }: { readonly texto: string; readonly linguagem: string; readonly tema: NomeDoTema }) {
  const grande = texto.length > MAX_PARA_COLORIR;
  const colorido = useColorido(grande ? '' : texto, linguagem, tema, 2);
  const comum = {
    m: 0, px: 1.5, py: 0.75, fontFamily: tokens.fontMono, fontSize: 12, whiteSpace: 'pre-wrap',
    wordBreak: 'break-word', maxHeight: ALTURA, overflow: 'auto',
  } as const;
  if (grande || colorido === null) return <Box component="pre" data-corpo-http sx={comum}>{texto}</Box>;
  // O HTML vem do colorizador do Monaco, que escapa o texto (ver `colorir.ts`).
  return <Box component="pre" data-corpo-http sx={comum} dangerouslySetInnerHTML={{ __html: colorido }} />;
}

/**
 * Imagem e PDF aparecem; o resto é só "Salvar".
 *
 * A imagem vai como `data:` — a CSP da webview do editor aceita `data:` em
 * imagem e recusa `blob:` (visto pela guarda da extensão). O PDF precisa de um
 * quadro, e a webview não abre quadro nenhum: lá ele fica no "Salvar".
 */
function CorpoBinario({ saida }: { readonly saida: SaidaHttp }) {
  const mime = saida.tipoDeConteudo.split(';')[0].trim().toLowerCase();
  const pdf = mime === 'application/pdf' && !saida.truncado && !dentroDoEditor();
  const [urlDoPdf, setUrlDoPdf] = useState<string | null>(null);
  useEffect(() => {
    if (!pdf) return undefined;
    const u = URL.createObjectURL(new Blob([daCarga(saida.corpo) as BlobPart], { type: mime }));
    setUrlDoPdf(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrlDoPdf(null);
    };
  }, [pdf, saida.corpo, mime]);
  if (mime.startsWith('image/') && !saida.truncado) {
    return (
      <Box sx={{ px: 1.5, py: 0.75 }}>
        <Box component="img" data-corpo-http alt="imagem da resposta" src={`data:${mime};base64,${saida.corpo}`} sx={{ maxWidth: '100%', maxHeight: ALTURA }} />
      </Box>
    );
  }
  if (urlDoPdf !== null) {
    return <Box component="iframe" data-corpo-http title="PDF da resposta" src={urlDoPdf} sx={{ width: '100%', height: ALTURA, border: 0 }} />;
  }
  return (
    <Box data-corpo-http sx={{ px: 1.5, py: 0.75, fontSize: 12, color: 'text.secondary' }}>
      Binário ({mime || 'sem tipo'}, {tamanhoLegivel(saida.tamanho)}). Use “Salvar” para gravar em disco.
    </Box>
  );
}

export interface RespostaHttpProps {
  readonly saida: SaidaHttp;
  readonly tema: NomeDoTema;
  /** Para buscar no motor o corpo inteiro, quando o guardado foi cortado. */
  readonly caminho: string | null;
  readonly celula: string;
}

export function RespostaHttp({ saida, tema, caminho, celula }: RespostaHttpProps) {
  const binario = saida.codificacao === 'base64';
  const linguagem = linguagemDoCorpo(saida.tipoDeConteudo);
  const [abaEscolhida, setAba] = useState<Aba>('pretty');
  const [erro, setErro] = useState<string | null>(null);
  const formatado = useMemo(
    () => (binario ? '' : formatarCorpo(saida.corpo, saida.tipoDeConteudo)),
    [binario, saida.corpo, saida.tipoDeConteudo]
  );

  const salvar = async (): Promise<void> => {
    setErro(null);
    const nome = nomeParaSalvar(saida.url, saida.tipoDeConteudo);
    const mime = saida.tipoDeConteudo.split(';')[0].trim() || 'application/octet-stream';
    try {
      if (!saida.truncado) {
        await baixarArquivo(nome, binario ? daCarga(saida.corpo) : saida.corpo, mime);
        return;
      }
      if (caminho === null) throw new Error('salve o notebook e rode a célula de novo');
      const inteiro = await ApiDoNotebook.corpoHttp(caminho, celula);
      await baixarArquivo(nome, daCarga(inteiro.base64), inteiro.mime);
    } catch (e) {
      setErro(`Não deu para salvar: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const abas: readonly (readonly [Aba, string])[] = [
    ['pretty', binario ? 'Body' : 'Pretty'],
    ...(binario ? [] : [['raw', 'Raw'] as const]),
    ...(linguagem === 'html' ? [['preview', 'Preview'] as const] : []),
    ['headers', `Headers (${saida.headers.length})`],
  ];
  // A resposta nova pode não ter a aba que estava aberta (Raw numa imagem,
  // Preview num JSON): volta ao corpo, em vez de mostrar base64 ou nada.
  const aba: Aba = abas.some(([valor]) => valor === abaEscolhida) ? abaEscolhida : 'pretty';

  return (
    <Box data-saida="http" sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, pt: 0.5, fontSize: 11, flexWrap: 'wrap' }}>
        <Box role="tablist" aria-label="Partes da resposta" sx={{ display: 'flex' }}>
          {abas.map(([valor, rotulo]) => (
            <Box
              key={valor}
              component="button"
              type="button"
              role="tab"
              aria-selected={aba === valor}
              onClick={() => setAba(valor)}
              sx={estiloDaAba(aba === valor)}
            >
              {rotulo}
            </Box>
          ))}
        </Box>
        <Box sx={{ flex: 1 }} />
        <Box data-status-http sx={{ fontWeight: 700, color: corDoStatus(saida.status) }}>
          {saida.status} {saida.statusTexto}
        </Box>
        <Box sx={{ color: 'text.secondary' }}>{saida.tempoMs} ms</Box>
        <Box sx={{ color: 'text.secondary' }} title={saida.truncado ? 'O arquivo guarda só o primeiro 1 MB; o kernel recebeu tudo.' : undefined}>
          {tamanhoLegivel(saida.tamanho)}{saida.truncado ? ' (cortado)' : ''}
        </Box>
        <Box
          component="button"
          type="button"
          aria-label="Salvar a resposta em disco"
          title="Salvar a resposta em disco"
          onClick={() => void salvar()}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5, border: 0, bgcolor: 'transparent',
            cursor: 'pointer', fontSize: 11, color: 'text.secondary', '&:hover': { color: 'text.primary' },
          }}
        >
          <Icon name="lucide:download" size={12} /> Salvar
        </Box>
      </Box>
      {erro !== null && <Box sx={{ px: 1.5, fontSize: 11, color: 'error.main' }}>{erro}</Box>}
      {saida.truncado && aba !== 'headers' && (
        <Box sx={{ px: 1.5, fontSize: 11, color: 'warning.main' }}>
          Mostrando o primeiro 1 MB de {tamanhoLegivel(saida.tamanho)}. A variável no kernel tem a resposta inteira.
        </Box>
      )}

      {aba === 'pretty' && (binario ? <CorpoBinario saida={saida} /> : <CorpoColorido texto={formatado} linguagem={linguagem} tema={tema} />)}
      {aba === 'raw' && <CorpoColorido texto={saida.corpo} linguagem="plain" tema={tema} />}
      {aba === 'preview' && (
        <Box component="iframe" data-preview-http title="Preview da resposta" sandbox="" srcDoc={saida.corpo} sx={{ width: '100%', height: ALTURA, border: 0, bgcolor: '#fff' }} />
      )}
      {aba === 'headers' && (
        <Box
          role="table"
          aria-label="Headers da resposta"
          sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', px: 1.5, py: 0.75, fontFamily: tokens.fontMono, fontSize: 12, columnGap: 2, rowGap: 0.25 }}
        >
          {saida.headers.map(([k, v], i) => [
            <Box key={`k${i}`} sx={{ color: 'text.secondary' }}>{k}</Box>,
            <Box key={`v${i}`} sx={{ wordBreak: 'break-all' }}>{v}</Box>,
          ])}
        </Box>
      )}
    </Box>
  );
}
