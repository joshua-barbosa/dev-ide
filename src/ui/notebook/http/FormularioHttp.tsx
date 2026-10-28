// O formulário da célula HTTP (spec 120, etapa 1): método, URL e as abas
// Params, Headers e Body — o Postman dentro da célula.
//
// A URL e a aba Params são a MESMA query (`aoEditarUrl` / `aoEditarParams`):
// escrever `?a=1` na URL aparece na tabela, e o contrário também.
import { useState } from 'react';
import Box from '@mui/material/Box';
import { tokens } from '../../theme';
import { TabelaDeLinhas } from './TabelaDeLinhas';
import { CorpoDaRequisicao } from './CorpoDaRequisicao';
import { AutorizacaoHttp } from './AutorizacaoHttp';
import { OpcoesDaRequisicao } from './OpcoesDaRequisicao';
import { BarraDeCurl } from './BarraDeCurl';
import { importarCurl, pareceCurl } from './importarCurl';
import { ApiDoNotebook } from '../../api-notebook';
import { estiloDaAba, estiloDoSeletor } from './estilos';
import type { NomeDoTema } from '../../../shared/temas';
import {
  aoEditarParams, aoEditarUrl, linhaVazia, METODOS_HTTP, type LinhaHttp, type MetodoHttp, type RequisicaoHttp,
} from '../../../shared/notebook/http';

type Aba = 'params' | 'autorizacao' | 'headers' | 'body' | 'opcoes';

/** As cores de método do Postman: dá para ler a célula de longe. */
const COR_DO_METODO: Record<MetodoHttp, string> = {
  GET: 'success.main', POST: 'warning.main', PUT: 'info.main', PATCH: 'secondary.main',
  DELETE: 'error.main', HEAD: 'text.secondary', OPTIONS: 'text.secondary',
};

export interface FormularioHttpProps {
  readonly id: string;
  readonly requisicao: RequisicaoHttp;
  readonly fontSize: number;
  readonly tabSize: number;
  readonly tema: NomeDoTema;
  onMudar(requisicao: RequisicaoHttp): void;
  onRodar(): void;
  onFocar(): void;
  /** O "Copiar cURL". Na extensão passa pelo editor quando o navegador nega. */
  copiarTexto(texto: string): Promise<void>;
  /** O `.brnb`: o "Pegar token" do OAuth lê `{{ }}` do kernel dele. */
  readonly caminho: string | null;
  /** O `[n]` da célula: o estado do token do OAuth se relê a cada execução. */
  readonly contador: number | null;
}

const contar = (linhas: readonly LinhaHttp[]): string => {
  const n = linhas.filter((l) => l.ligado && l.chave !== '').length;
  return n === 0 ? '' : ` (${n})`;
};

export function FormularioHttp(p: FormularioHttpProps) {
  const r = p.requisicao;
  // Sem corpo, o GET abre em Params; com corpo, no Body — onde está o que importa.
  const [aba, setAba] = useState<Aba>(r.corpo.tipo === 'nenhum' ? 'params' : 'body');
  const abas: readonly (readonly [Aba, string])[] = [
    ['params', `Params${contar(r.params)}`],
    ['autorizacao', `Authorization${r.autorizacao.tipo === 'nenhuma' ? '' : ' ●'}`],
    ['headers', `Headers${contar(r.headers)}`],
    ['body', `Body${r.corpo.tipo === 'nenhum' ? '' : ' ●'}`],
    ['opcoes', 'Settings'],
  ];
  const [recado, setRecado] = useState<{ texto: string; erro: boolean } | null>(null);

  const importar = (texto: string): void => {
    try {
      const { requisicao, avisos } = importarCurl(texto);
      p.onMudar(requisicao);
      setAba(requisicao.corpo.tipo === 'nenhum' ? 'params' : 'body');
      setRecado({ texto: avisos.length === 0 ? 'cURL importado.' : `cURL importado. ${avisos.join(' ')}`, erro: false });
    } catch (e) {
      setRecado({ texto: e instanceof Error ? e.message : String(e), erro: true });
    }
  };
  const copiar = async (estilo: 'bash' | 'cmd'): Promise<void> => {
    try {
      await p.copiarTexto(await ApiDoNotebook.curl(r, estilo));
      setRecado({ texto: `Copiado (${estilo}).`, erro: false });
    } catch (e) {
      setRecado({ texto: `Não deu para copiar: ${e instanceof Error ? e.message : String(e)}`, erro: true });
    }
  };

  return (
    <Box data-formulario-http sx={{ px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Box
          component="select"
          aria-label="Método HTTP"
          value={r.metodo}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => p.onMudar({ ...r, metodo: e.target.value as MetodoHttp })}
          sx={{ ...estiloDoSeletor, fontSize: 12, fontWeight: 700, px: 0.5, color: COR_DO_METODO[r.metodo] }}
        >
          {METODOS_HTTP.map((m) => <option key={m} value={m}>{m}</option>)}
        </Box>
        <Box
          component="input"
          aria-label="URL da requisição"
          value={r.url}
          placeholder="https://api.exemplo.test/recurso?id={{id}}"
          spellCheck={false}
          onFocus={p.onFocar}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => p.onMudar(aoEditarUrl(r, e.target.value))}
          onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
            // Colar um cURL na URL importa ele inteiro, como no Postman.
            const colado = e.clipboardData.getData('text');
            if (!pareceCurl(colado)) return;
            e.preventDefault();
            importar(colado);
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              p.onRodar();
            }
          }}
          sx={{
            flex: 1, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 0.5, outline: 'none',
            bgcolor: 'transparent', color: 'text.primary', fontFamily: tokens.fontMono, fontSize: 12, px: 0.75, py: 0.5,
            '&:focus': { borderColor: 'primary.main' },
          }}
        />
      </Box>

      <BarraDeCurl onImportar={importar} onCopiar={(estilo) => void copiar(estilo)} recado={recado} />

      <Box role="tablist" aria-label="Partes da requisição" sx={{ display: 'flex', borderBottom: 1, borderColor: 'divider' }}>
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

      {aba === 'params' && (
        <TabelaDeLinhas<LinhaHttp>
          rotulo="Params"
          linhas={r.params}
          novaLinha={linhaVazia}
          onMudar={(params) => p.onMudar(aoEditarParams(r, params))}
        />
      )}
      {aba === 'autorizacao' && (
        <AutorizacaoHttp
          autorizacao={r.autorizacao}
          requisicao={r}
          caminho={p.caminho}
          contador={p.contador}
          onMudar={(autorizacao) => p.onMudar({ ...r, autorizacao })}
        />
      )}
      {aba === 'headers' && (
        <TabelaDeLinhas<LinhaHttp>
          rotulo="Headers"
          linhas={r.headers}
          novaLinha={linhaVazia}
          onMudar={(headers) => p.onMudar({ ...r, headers })}
        />
      )}
      {aba === 'opcoes' && <OpcoesDaRequisicao opcoes={r.opcoes} onMudar={(opcoes) => p.onMudar({ ...r, opcoes })} />}
      {aba === 'body' && (
        <CorpoDaRequisicao
          id={p.id}
          corpo={r.corpo}
          fontSize={p.fontSize}
          tabSize={p.tabSize}
          tema={p.tema}
          onMudar={(corpo) => p.onMudar({ ...r, corpo })}
          onAtalhoDeRodar={p.onRodar}
          onFocar={p.onFocar}
        />
      )}
    </Box>
  );
}
