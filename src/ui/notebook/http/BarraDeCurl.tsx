// Importar e copiar cURL na célula HTTP (spec 120, etapa 3).
//
// Importar: o botão abre um campo para colar — ou cole direto na URL, como no
// Postman. Copiar: bash (Linux, macOS, Git Bash) ou cmd (Windows).
import { useState } from 'react';
import Box from '@mui/material/Box';
import { tokens } from '../../theme';

export interface BarraDeCurlProps {
  onImportar(texto: string): void;
  onCopiar(estilo: 'bash' | 'cmd'): void;
  /** O resultado do último gesto: "copiado", os avisos do import, ou o erro. */
  readonly recado: { readonly texto: string; readonly erro: boolean } | null;
}

const estiloDoBotao = {
  border: 0, bgcolor: 'transparent', cursor: 'pointer', fontSize: 11, color: 'text.secondary', px: 0.5,
  '&:hover': { color: 'text.primary' },
} as const;

export function BarraDeCurl({ onImportar, onCopiar, recado }: BarraDeCurlProps) {
  const [colando, setColando] = useState(false);
  const [texto, setTexto] = useState('');
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11 }}>
        <Box component="button" type="button" onClick={() => setColando((c) => !c)} sx={estiloDoBotao}>Importar cURL</Box>
        <Box sx={{ color: 'text.disabled' }}>·</Box>
        <Box component="button" type="button" onClick={() => onCopiar('bash')} sx={estiloDoBotao}
          title="Linux, macOS, Git Bash">Copiar cURL (bash)</Box>
        <Box component="button" type="button" onClick={() => onCopiar('cmd')} sx={estiloDoBotao}
          title="Prompt de comando do Windows">Copiar cURL (cmd)</Box>
        {recado !== null && (
          <Box data-recado-curl sx={{ ml: 1, color: recado.erro ? 'error.main' : 'text.secondary', whiteSpace: 'pre-wrap' }}>
            {recado.texto}
          </Box>
        )}
      </Box>
      {colando && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box
            component="textarea"
            aria-label="Comando cURL para importar"
            autoFocus
            spellCheck={false}
            rows={5}
            value={texto}
            placeholder="curl 'https://…' -H '…' --data-raw '…'"
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTexto(e.target.value)}
            sx={{
              border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'transparent', color: 'text.primary',
              fontFamily: tokens.fontMono, fontSize: 12, p: 0.75, outline: 'none', resize: 'vertical',
            }}
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Box
              component="button"
              type="button"
              onClick={() => {
                onImportar(texto);
                setColando(false);
                setTexto('');
              }}
              sx={{ ...estiloDoBotao, color: 'primary.main' }}
            >
              Importar (substitui a requisição)
            </Box>
            <Box component="button" type="button" onClick={() => setColando(false)} sx={estiloDoBotao}>Cancelar</Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
