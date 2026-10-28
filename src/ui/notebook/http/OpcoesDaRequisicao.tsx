// A aba Settings da célula HTTP (spec 120, etapa 3): timeout, redirecionamento,
// certificado inválido e proxy.
import Box from '@mui/material/Box';
import { estiloDoCampo } from './CampoDeSegredo';
import type { OpcoesHttp } from '../../../shared/notebook/http';

export interface OpcoesDaRequisicaoProps {
  readonly opcoes: OpcoesHttp;
  onMudar(opcoes: OpcoesHttp): void;
}

function Caixa({ rotulo, dica, marcado, onMudar }: {
  readonly rotulo: string; readonly dica: string; readonly marcado: boolean; onMudar(v: boolean): void;
}) {
  return (
    <Box component="label" sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, cursor: 'pointer' }}>
      <input type="checkbox" checked={marcado} onChange={(e) => onMudar(e.target.checked)} aria-label={rotulo} />
      <Box>
        <Box>{rotulo}</Box>
        <Box sx={{ color: 'text.secondary' }}>{dica}</Box>
      </Box>
    </Box>
  );
}

export function OpcoesDaRequisicao({ opcoes: o, onMudar }: OpcoesDaRequisicaoProps) {
  return (
    <Box data-opcoes-http sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 11 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 150, color: 'text.secondary' }}>Timeout (ms)</Box>
        <Box
          component="input"
          aria-label="Timeout em milissegundos"
          type="number"
          min={0}
          step={1000}
          value={o.timeoutMs}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const n = Number(e.target.value);
            onMudar({ ...o, timeoutMs: Number.isFinite(n) && n > 0 ? Math.round(n) : 0 });
          }}
          sx={{ ...estiloDoCampo, flex: 'none', width: 120 }}
        />
        <Box sx={{ color: 'text.secondary' }}>0 = sem limite</Box>
      </Box>
      <Caixa
        rotulo="Seguir redirecionamentos"
        dica="Desmarcado, a resposta é o próprio 301/302, com o Location."
        marcado={o.seguirRedirecionamentos}
        onMudar={(seguirRedirecionamentos) => onMudar({ ...o, seguirRedirecionamentos })}
      />
      <Caixa
        rotulo="Ignorar certificado inválido"
        dica="Para servidor interno com certificado próprio. Quem está no meio pode ler a conversa."
        marcado={o.ignorarCertificado}
        onMudar={(ignorarCertificado) => onMudar({ ...o, ignorarCertificado })}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 150, color: 'text.secondary' }}>Proxy</Box>
        <Box
          component="input"
          aria-label="Proxy desta célula"
          value={o.proxy}
          placeholder="vazio = o do sistema (HTTP_PROXY / HTTPS_PROXY / NO_PROXY)"
          spellCheck={false}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onMudar({ ...o, proxy: e.target.value })}
          sx={estiloDoCampo}
        />
      </Box>
      <Box sx={{ color: 'text.secondary' }}>
        Proxy http:// (com usuário e senha: http://usuario:senha@proxy:3128). O da célula não olha o NO_PROXY.
      </Box>
    </Box>
  );
}
