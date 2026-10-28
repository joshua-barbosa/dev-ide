// A tabela chave / valor / descrição da célula HTTP (spec 120): Params,
// Headers, form-data e x-www-form-urlencoded.
//
// Como no Postman: a ÚLTIMA linha está sempre vazia, e escrever nela cria a
// próxima. Assim não existe botão "adicionar" para achar — é só escrever.
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../../Icon';
import { tokens } from '../../theme';
import type { LinhaHttp } from '../../../shared/notebook/http';

export interface TabelaDeLinhasProps<L extends LinhaHttp> {
  readonly rotulo: string;
  readonly linhas: readonly L[];
  readonly novaLinha: () => L;
  onMudar(linhas: L[]): void;
  /** Uma coluna a mais, entre a chave e o valor (o tipo do campo do form-data). */
  readonly colunaExtra?: (linha: L, mudar: (l: L) => void) => ReactNode;
  readonly dicaDoValor?: (linha: L) => string;
}


const estiloDoCampo = {
  width: '100%', border: 0, outline: 'none', bgcolor: 'transparent', color: 'text.primary',
  fontFamily: tokens.fontMono, fontSize: 12, px: 0.75, py: 0.5,
  '&:focus': { bgcolor: 'action.hover' },
} as const;

export function TabelaDeLinhas<L extends LinhaHttp>(p: TabelaDeLinhasProps<L>) {
  // A linha fantasma do fim: não está no modelo até ganhar texto.
  const exibidas = [...p.linhas, p.novaLinha()];
  const mudar = (i: number, nova: L): void => {
    const linhas = i < p.linhas.length ? p.linhas.map((l, j) => (j === i ? nova : l)) : [...p.linhas, nova];
    p.onMudar(linhas);
  };
  const remover = (i: number): void => p.onMudar(p.linhas.filter((_, j) => j !== i));

  const campo = (linha: L, i: number, qual: 'chave' | 'valor' | 'descricao', dica: string) => (
    <Box
      component="input"
      aria-label={`${p.rotulo}: ${qual === 'chave' ? 'chave' : qual === 'valor' ? 'valor' : 'descrição'} da linha ${i + 1}`}
      value={linha[qual]}
      placeholder={dica}
      spellCheck={false}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => mudar(i, { ...linha, [qual]: e.target.value })}
      sx={estiloDoCampo}
    />
  );

  return (
    <Box
      role="table"
      aria-label={p.rotulo}
      data-tabela-http={p.rotulo}
      sx={{
        display: 'grid',
        gridTemplateColumns: p.colunaExtra === undefined ? '28px 1fr 1.4fr 1fr 28px' : '28px 1fr auto 1.4fr 1fr 28px',
        border: 1, borderColor: 'divider', borderRadius: 0.5, fontSize: 11,
        '& > *': { borderBottom: 1, borderColor: 'divider', minWidth: 0, display: 'flex', alignItems: 'center' },
      }}
    >
      <Box />
      <Box sx={{ px: 0.75, py: 0.5, color: 'text.secondary' }}>Chave</Box>
      {p.colunaExtra !== undefined && <Box />}
      <Box sx={{ px: 0.75, py: 0.5, color: 'text.secondary' }}>Valor</Box>
      <Box sx={{ px: 0.75, py: 0.5, color: 'text.secondary' }}>Descrição</Box>
      <Box />
      {exibidas.map((linha, i) => {
        const fantasma = i === p.linhas.length;
        return [
          <Box key={`l${i}`} sx={{ justifyContent: 'center' }}>
            {!fantasma && (
              <input
                type="checkbox"
                aria-label={`${p.rotulo}: mandar a linha ${i + 1}`}
                checked={linha.ligado}
                onChange={(e) => mudar(i, { ...linha, ligado: e.target.checked })}
              />
            )}
          </Box>,
          <Box key={`c${i}`}>{campo(linha, i, 'chave', fantasma ? 'Chave' : '')}</Box>,
          ...(p.colunaExtra === undefined ? [] : [<Box key={`x${i}`}>{p.colunaExtra(linha, (l) => mudar(i, l))}</Box>]),
          <Box key={`v${i}`}>{campo(linha, i, 'valor', p.dicaDoValor?.(linha) ?? (fantasma ? 'Valor' : ''))}</Box>,
          <Box key={`d${i}`}>{campo(linha, i, 'descricao', fantasma ? 'Descrição' : '')}</Box>,
          <Box key={`r${i}`} sx={{ justifyContent: 'center' }}>
            {!fantasma && (
              <Box
                component="button"
                type="button"
                aria-label={`${p.rotulo}: apagar a linha ${i + 1}`}
                title="Apagar a linha"
                onClick={() => remover(i)}
                sx={{ border: 0, bgcolor: 'transparent', cursor: 'pointer', color: 'text.secondary', display: 'flex' }}
              >
                <Icon name="lucide:x" size={12} />
              </Box>
            )}
          </Box>,
        ];
      })}
    </Box>
  );
}
