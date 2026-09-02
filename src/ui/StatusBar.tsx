// Barra de status.
//
// Saiu de dentro do `App` quando ganhou o seletor de linguagem, que antes vivia
// na barra de ferramentas. O lugar é o do VS Code: canto inferior direito, e
// clicar abre a lista — não um `<select>` ocupando a barra de cima.
import Box from '@mui/material/Box';
import { rotuloDaLinguagem } from '../shared/editor/idiomas';
import { tokens } from './theme';
import type { Vinculo } from '../shared/sql/vinculo';

export interface StatusBarProps {
  readonly titulo: string | null;
  readonly sujo: boolean;
  readonly linha: number;
  readonly coluna: number;
  readonly linguagem: string;
  /** Ausente quando não há editor: aí a linguagem é só informação. */
  readonly onTrocarLinguagem?: () => void;
  /** Ausente quando não há editor: aí a posição é só informação (spec 026). */
  readonly onIrParaPosicao?: () => void;
  /**
   * Contra quem o arquivo SQL em foco roda (spec 038).
   *
   * `null` quando não há vínculo, e ausente quando o arquivo nem é SQL — são
   * coisas diferentes: a primeira mostra "sem conexão" e convida a escolher, a
   * segunda não mostra nada.
   */
  readonly vinculo?: Vinculo | null;
  readonly onTrocarVinculo?: () => void;
  /** O sino de notificações (T107). Montado pelo `App`, que tem o estado. */
  readonly sino?: React.ReactNode;
}

export function StatusBar({
  titulo, sujo, linha, coluna, linguagem, onTrocarLinguagem, onIrParaPosicao,
  vinculo, onTrocarVinculo, sino,
}: StatusBarProps) {
  const rotulo = rotuloDaLinguagem(linguagem);

  /** Os dois botões da direita são iguais em tudo menos no que fazem. */
  const estiloDeBotao = (ativo: boolean) => ({
    border: 0,
    bgcolor: 'transparent',
    color: 'inherit',
    font: 'inherit',
    px: 0.75,
    py: 0.2,
    borderRadius: 0.5,
    cursor: ativo ? 'pointer' : 'default',
    opacity: ativo ? 1 : 0.5,
    '&:hover': { bgcolor: ativo ? 'action.hover' : 'transparent' },
  });

  return (
    <Box
      component="footer"
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, px: 1.25, py: 0.4,
        bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider',
        color: 'text.secondary', fontFamily: tokens.fontMono, fontSize: 11,
      }}
    >
      <span>{titulo ?? 'nenhum arquivo'}</span>
      {sujo && (
        <Box component="span" sx={{ color: 'primary.main' }}>
          ● não salvo
        </Box>
      )}

      {onTrocarVinculo !== undefined && (
        <Box
          component="button"
          onClick={onTrocarVinculo}
          aria-label="Trocar a conexão desta query"
          title={
            vinculo === null || vinculo === undefined
              ? 'Esta query ainda não tem conexão. Clique para escolher.'
              : `Roda em ${vinculo.database}. Clique para trocar.`
          }
          data-vinculo={vinculo === null || vinculo === undefined ? '' : vinculo.database}
          sx={{ ml: 'auto', ...estiloDeBotao(true) }}
        >
          {vinculo === null || vinculo === undefined
            ? '⚠ sem conexão'
            : `⛁ ${vinculo.database}`}
        </Box>
      )}

      <Box
        component="button"
        disabled={onIrParaPosicao === undefined}
        onClick={onIrParaPosicao}
        aria-label="Ir para linha e coluna"
        title="Ir para linha e coluna (Ctrl+G)"
        sx={{
          // `ml: auto` empurra tudo para a direita, e só pode estar no PRIMEIRO
          // botão da direita — que é o do vínculo quando ele aparece.
          ...(onTrocarVinculo === undefined ? { ml: 'auto' } : {}),
          ...estiloDeBotao(onIrParaPosicao !== undefined),
        }}
      >
        Ln {linha}, Col {coluna}
      </Box>

      <Box
        component="button"
        disabled={onTrocarLinguagem === undefined}
        onClick={onTrocarLinguagem}
        aria-label="Selecionar linguagem"
        sx={estiloDeBotao(onTrocarLinguagem !== undefined)}
      >
        {rotulo}
      </Box>

      {/* O sino do histórico de avisos (T107), no canto direito — é onde toda
          IDE o põe, e onde o olho já procura. */}
      {sino}
    </Box>
  );
}
