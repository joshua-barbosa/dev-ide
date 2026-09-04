// O painel `Status` de um servidor chave-valor (spec 089).
//
// O que o `INFO` conta: versão, modo, tempo de pé, memória, clientes e quantas
// chaves há em cada banco. O que o servidor não disser fica em branco, e não
// vira zero — servidor gerenciado esconde seções inteiras.
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { Api } from '../api';
import { tokens } from '../theme';
import { tempoDePe, type InfoDoServidor } from '../../shared/sql/redis-chave';

export function EstadoDoServidor({ conexaoId }: { readonly conexaoId: string }) {
  const [info, setInfo] = useState<InfoDoServidor | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    Api.estadoDoServidor(conexaoId)
      .then((i) => { if (vivo) setInfo(i); })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      });
    return () => { vivo = false; };
  }, [conexaoId]);

  if (erro !== null) {
    return <Box role="alert" sx={{ p: 1, color: 'error.main', fontSize: 12 }}>{erro}</Box>;
  }
  if (info === null) {
    return <Box sx={{ p: 1, fontSize: 12, color: 'text.secondary' }}>Lendo o servidor…</Box>;
  }

  const cartoes: readonly (readonly [string, string])[] = [
    ['Uptime', tempoDePe(info.uptime)],
    ['Memory Usage', info.memoria],
    ['Connected Clients', String(info.clientes)],
  ];

  return (
    <Box data-estado-do-servidor sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
        {[info.versao, info.modo, info.papel]
          .filter((t) => t !== '')
          .map((t) => <Chip key={t} size="small" label={t} sx={{ fontSize: 11, height: 20 }} />)}
        {info.so !== '' && (
          <Box sx={{ fontSize: 11, color: 'text.secondary', alignSelf: 'center' }}>
            OS {info.so}
          </Box>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        {cartoes.filter(([, v]) => v !== '').map(([rotulo, v]) => (
          <Box
            key={rotulo}
            sx={{
              flex: '1 1 160px', p: 1.5, border: `1px solid ${tokens.border}`, borderRadius: 1,
            }}
          >
            <Box sx={{ fontSize: 11, color: 'text.secondary' }}>{rotulo}</Box>
            <Box sx={{ fontSize: 18 }}>{v}</Box>
          </Box>
        ))}
      </Box>

      <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <Box component="thead">
          <Box component="tr">
            {['DB', 'Keys', 'Expires', 'Avg TTL'].map((c) => (
              <Box
                key={c}
                component="th"
                sx={{ textAlign: 'left', px: 1.5, py: 0.5, borderBottom: `1px solid ${tokens.border}` }}
              >
                {c}
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {info.bancos.map((b) => (
            <Box component="tr" key={b.nome}>
              <Box component="td" sx={{ px: 1.5, py: 0.5 }}>{b.nome}</Box>
              <Box component="td" sx={{ px: 1.5, py: 0.5 }}>{b.chaves}</Box>
              <Box component="td" sx={{ px: 1.5, py: 0.5 }}>{b.expiram}</Box>
              <Box component="td" sx={{ px: 1.5, py: 0.5 }}>{b.ttlMedio}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
