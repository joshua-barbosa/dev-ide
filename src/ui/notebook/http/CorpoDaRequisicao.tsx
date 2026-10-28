// O Body da célula HTTP (spec 120): none, form-data, x-www-form-urlencoded,
// raw (Text, JSON, HTML, XML) e binary — os seis do pedido.
//
// Trocar de tipo leva junto o que dá: as linhas do form-data passam para o
// urlencoded e vice-versa (os campos de arquivo viram texto). O resto começa
// vazio.
import Box from '@mui/material/Box';
import { BlocoDeCodigo } from '../../caderno/BlocoDeCodigo';
import { tokens } from '../../theme';
import { TabelaDeLinhas } from './TabelaDeLinhas';
import { estiloDoSeletor } from './estilos';
import type { NomeDoTema } from '../../../shared/temas';
import {
  linhaVazia, type CampoDeFormulario, type CorpoHttp, type FormatoRaw, type LinhaHttp, type TipoDeCorpo,
} from '../../../shared/notebook/http';

const TIPOS: readonly (readonly [TipoDeCorpo, string])[] = [
  ['nenhum', 'none'], ['form-data', 'form-data'], ['urlencoded', 'x-www-form-urlencoded'],
  ['raw', 'raw'], ['binario', 'binary'],
];

const FORMATOS: readonly (readonly [FormatoRaw, string, string])[] = [
  ['texto', 'Text', 'plain'], ['json', 'JSON', 'json'], ['html', 'HTML', 'html'], ['xml', 'XML', 'xml'],
];

function trocarTipo(corpo: CorpoHttp, tipo: TipoDeCorpo): CorpoHttp {
  const linhas: readonly LinhaHttp[] = corpo.tipo === 'form-data' || corpo.tipo === 'urlencoded' ? corpo.campos : [];
  switch (tipo) {
    case 'form-data':
      return { tipo, campos: linhas.map((l) => ({ ...l, tipo: 'texto' as const })) };
    case 'urlencoded':
      return { tipo, campos: linhas.map(({ ligado, chave, valor, descricao }) => ({ ligado, chave, valor, descricao })) };
    case 'raw':
      return { tipo, formato: 'json', texto: '' };
    case 'binario':
      return { tipo, arquivo: '' };
    default:
      return { tipo: 'nenhum' };
  }
}

const caminhoAbsoluto = 'caminho absoluto do arquivo (ex.: /home/voce/foto.png ou C:\\pasta\\foto.png)';

export interface CorpoDaRequisicaoProps {
  readonly id: string;
  readonly corpo: CorpoHttp;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  onMudar(corpo: CorpoHttp): void;
  onAtalhoDeRodar(): void;
  onFocar(): void;
}

export function CorpoDaRequisicao(p: CorpoDaRequisicaoProps) {
  const { corpo } = p;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box role="radiogroup" aria-label="Tipo do corpo" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, fontSize: 11 }}>
        {TIPOS.map(([tipo, rotulo]) => (
          <Box key={tipo} component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}>
            <input
              type="radio"
              name={`corpo-${p.id}`}
              checked={corpo.tipo === tipo}
              onChange={() => p.onMudar(trocarTipo(corpo, tipo))}
            />
            {rotulo}
          </Box>
        ))}
        {corpo.tipo === 'raw' && (
          <Box
            component="select"
            aria-label="Formato do raw"
            value={corpo.formato}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => p.onMudar({ ...corpo, formato: e.target.value as FormatoRaw })}
            sx={estiloDoSeletor}
          >
            {FORMATOS.map(([f, rotulo]) => <option key={f} value={f}>{rotulo}</option>)}
          </Box>
        )}
      </Box>

      {corpo.tipo === 'nenhum' && (
        <Box sx={{ fontSize: 11, color: 'text.secondary' }}>Esta requisição não tem corpo.</Box>
      )}

      {corpo.tipo === 'form-data' && (
        <TabelaDeLinhas<CampoDeFormulario>
          rotulo="form-data"
          linhas={corpo.campos}
          novaLinha={() => ({ ...linhaVazia(), tipo: 'texto' })}
          onMudar={(campos) => p.onMudar({ ...corpo, campos })}
          dicaDoValor={(l) => (l.tipo === 'arquivo' ? caminhoAbsoluto : '')}
          colunaExtra={(linha, mudar) => (
            <Box
              component="select"
              aria-label={`Tipo do campo ${linha.chave}`}
              value={linha.tipo}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => mudar({ ...linha, tipo: e.target.value as CampoDeFormulario['tipo'] })}
              sx={{ ...estiloDoSeletor, mx: 0.5 }}
            >
              <option value="texto">Text</option>
              <option value="arquivo">File</option>
            </Box>
          )}
        />
      )}

      {corpo.tipo === 'urlencoded' && (
        <TabelaDeLinhas<LinhaHttp>
          rotulo="x-www-form-urlencoded"
          linhas={corpo.campos}
          novaLinha={linhaVazia}
          onMudar={(campos) => p.onMudar({ ...corpo, campos })}
        />
      )}

      {corpo.tipo === 'raw' && (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 0.5, overflow: 'hidden' }}>
          <BlocoDeCodigo
            id={`${p.id}-corpo`}
            conteudo={corpo.texto}
            linguagem={FORMATOS.find(([f]) => f === corpo.formato)?.[2] ?? 'plain'}
            rotulo="Corpo da requisição"
            fontSize={p.fontSize}
            tabSize={p.tabSize}
            tema={p.tema}
            onAlterar={(texto) => p.onMudar({ ...corpo, texto })}
            onAtalhoDeRodar={p.onAtalhoDeRodar}
            onFocar={p.onFocar}
          />
        </Box>
      )}

      {corpo.tipo === 'binario' && (
        <Box
          component="input"
          aria-label="Arquivo do corpo (binary)"
          value={corpo.arquivo}
          placeholder={caminhoAbsoluto}
          spellCheck={false}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => p.onMudar({ ...corpo, arquivo: e.target.value })}
          sx={{
            border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'transparent', color: 'text.primary',
            fontFamily: tokens.fontMono, fontSize: 12, px: 0.75, py: 0.5, outline: 'none',
          }}
        />
      )}
    </Box>
  );
}
