// A linha ABAIXO da barra de abas (T025).
//
// Existe porque o switch `Markdown` | `Preview` estava DENTRO da barra de abas,
// grudado no fim da última aba — com três arquivos abertos ele aparecia no meio
// da tela. Ele mandou o print e a referência: no VS Code essa faixa é uma linha
// própria, e o controle fica encostado à direita.
//
// Junto veio um defeito de verdade: os dois controles usavam
// `ml: auto` CONDICIONAL ao outro não existir. Com `Markdown|Preview` e `▷` na
// tela ao mesmo tempo, nenhum dos dois ganhava o empurrão.
//
// Esta faixa é também onde o breadcrumb (T075, lote E) vai morar — é a mesma
// linha no VS Code, e por isso ela nasce como uma barra, e não como um botão
// solto.
import Box from '@mui/material/Box';
import { Icon } from '../Icon';

export interface BarraDoArquivoProps {
  /** Ausente = o arquivo não tem o que pré-visualizar, e a faixa não aparece. */
  readonly onPreview?: () => void;
  readonly emPreview: boolean;
}

export function BarraDoArquivo({ onPreview, emPreview }: BarraDoArquivoProps) {
  if (onPreview === undefined) return null;

  return (
    <Box
      data-barra-do-arquivo
      sx={{
        display: 'flex', alignItems: 'center', minHeight: 26,
        px: 1, borderBottom: 1, borderColor: 'divider',
        bgcolor: 'background.paper', flexShrink: 0,
      }}
    >
      {/* O espaço à esquerda é do breadcrumb (T075). Fica vazio por enquanto —
          e é ele que empurra o switch para a direita. */}
      <Box sx={{ flex: 1, minWidth: 0 }} />

      {/* `radiogroup` e não dois botões: são estados mutuamente exclusivos de
          uma coisa só, e é isso que o leitor de tela precisa ouvir. */}
      <Box
        role="radiogroup"
        aria-label="Como mostrar o arquivo"
        sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}
      >
        <ModoDoArquivo
          rotulo="Markdown"
          icone="lucide:file-code"
          ativo={!emPreview}
          onClick={() => {
            if (emPreview) onPreview();
          }}
        />
        <ModoDoArquivo
          rotulo="Preview"
          icone="lucide:book-open"
          ativo={emPreview}
          onClick={() => {
            if (!emPreview) onPreview();
          }}
        />
      </Box>
    </Box>
  );
}

/**
 * Um dos dois modos de ver o arquivo.
 *
 * Clicar no que JÁ ESTÁ ativo não faz nada — quem chama confere antes. Alternar
 * ali seria transformar o switch num botão de novo, e quem clica em `Preview`
 * estando no preview espera continuar nele.
 */
function ModoDoArquivo({
  rotulo, icone, ativo, onClick,
}: {
  readonly rotulo: string;
  readonly icone: string;
  readonly ativo: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      role="radio"
      aria-checked={ativo}
      aria-label={rotulo}
      onClick={onClick}
      sx={{
        border: 1, borderColor: ativo ? 'primary.main' : 'transparent',
        bgcolor: ativo ? 'action.selected' : 'transparent',
        color: ativo ? 'primary.main' : 'text.secondary',
        cursor: 'pointer', borderRadius: 0.5,
        px: 0.75, py: 0.15, display: 'flex', alignItems: 'center', gap: 0.4, fontSize: 11,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Icon name={icone} size={12} />
      {rotulo}
    </Box>
  );
}
