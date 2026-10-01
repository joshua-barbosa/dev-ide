// O campo de pesquisa rápida da lista de arquivos remotos, como o do
// FileZilla (relato de 01/10). A regra mora em `shared/sftp/pesquisa-rapida.ts`.
//
// O contador diz o que ficou escondido: um filtro esquecido numa pasta faz
// parecer que os arquivos sumiram — "1 de 138 · 137 filtrados" não deixa.
import { forwardRef } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { tokens } from '../theme';

export interface PesquisaRapidaProps {
  readonly valor: string;
  onMudar(valor: string): void;
  /** Quantos aparecem e quantos a pasta tem. */
  readonly visiveis: number;
  readonly total: number;
}

export const PesquisaRapida = forwardRef<HTMLInputElement, PesquisaRapidaProps>(function PesquisaRapida(
  { valor, onMudar, visiveis, total },
  ref
) {
  const filtrando = valor.trim() !== '';
  return (
    <Box data-pesquisa-rapida sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, ml: 'auto' }}>
      {filtrando && (
        <Box data-contagem-filtrada sx={{ fontSize: 11, color: 'warning.main', whiteSpace: 'nowrap' }}>
          {visiveis} de {total} · {total - visiveis} filtrado(s)
        </Box>
      )}
      <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <Box component="span" sx={{ position: 'absolute', left: 6, display: 'inline-flex', color: 'text.secondary' }}>
          <Icon name="lucide:search" size={12} />
        </Box>
        <Box
          component="input"
          ref={ref}
          aria-label="Pesquisa rápida na pasta"
          title="Filtra a pasta aberta: um trecho do nome, ou * e ? como coringa (*.inf). Ctrl+F"
          placeholder="Pesquisa rápida (Ctrl+F)"
          value={valor}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onMudar(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Escape') onMudar('');
          }}
          sx={{
            width: 200, fontFamily: tokens.fontMono, fontSize: 11.5, pl: 3, pr: filtrando ? 3 : 1, py: 0.25,
            border: 1, borderRadius: 0.5, bgcolor: 'transparent', color: 'text.primary',
            borderColor: filtrando ? 'warning.main' : 'divider', outline: 'none',
            '&:focus': { borderColor: 'primary.main' },
          }}
        />
        {filtrando && (
          <Box
            component="button"
            type="button"
            aria-label="Limpar a pesquisa"
            onClick={() => onMudar('')}
            sx={{
              position: 'absolute', right: 2, display: 'inline-flex', border: 0, bgcolor: 'transparent',
              color: 'text.secondary', cursor: 'pointer', p: 0.25,
            }}
          >
            <Icon name="lucide:x" size={12} />
          </Box>
        )}
      </Box>
    </Box>
  );
});
