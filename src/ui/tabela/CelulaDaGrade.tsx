// A CÉLULA da grade: o que ela mostra, o que ela deixa editar, a lupa.
//
// Saiu do `GradeDaTabela` quando ele passou do teto de 800 linhas do Artigo IV.
// O corte é o natural: lá ficou o que sabe montar a TABELA (colunas, larguras,
// arrasto, linha aberta), e aqui o que sabe o que é uma célula — inclusive o
// recorte do desenho, que é a razão de a lupa poder mostrar o valor inteiro.
import { useState } from 'react';
import Box from '@mui/material/Box';
import { Icon } from '../Icon';
import { tokens } from '../theme';
import type { CellValue } from '../../shared/contracts';

/**
 * Quantos caracteres a célula PINTA — o resto está lá, só não vai para o DOM.
 *
 * A grade não é virtualizada: as 500 linhas vão inteiras para a página. Pintar
 * 2048 caracteres numa célula que mostra uma linha custava 63 ms por página
 * contra 27 ms recortando (medido no Chrome, 500 × 6). Nenhuma fonte cabe 300
 * caracteres numa coluna de grade, então o que sobra é custo puro — e o valor
 * inteiro continua na memória, que é de onde a lupa o tira.
 */
const RECORTE_NO_DESENHO = 300;

function recortar(texto: string): string {
  return texto.length > RECORTE_NO_DESENHO ? `${texto.slice(0, RECORTE_NO_DESENHO)}…` : texto;
}

export function Celula({
  valor, editavel = false, mexida = false, riscada = false, titulo, rotulo, onEditar, onAbrir,
  alinhamento = 'left', nomeDaColuna,
}: {
  readonly valor: CellValue;
  readonly editavel?: boolean;
  readonly mexida?: boolean;
  readonly riscada?: boolean;
  readonly titulo?: string;
  readonly rotulo?: string;
  readonly onEditar?: (novo: CellValue) => void;
  /** Abre o visor. Ausente na linha nova, que ainda não tem valor guardado. */
  readonly onAbrir?: () => void;
  readonly alinhamento?: 'left' | 'center' | 'right';
  /**
   * A coluna a que esta célula pertence, escrita no DOM.
   *
   * Sem ela, quem lê a grade — inclusive os testes — só consegue apontar uma
   * célula pela POSIÇÃO. Acrescentar uma coluna de controle à esquerda
   * quebrava tudo que fazia isso, e a quebra não dizia o que tinha mudado.
   */
  readonly nomeDaColuna?: string;
}) {
  const nulo = valor === null;
  const [editando, setEditando] = useState(false);

  if (editando && editavel) {
    return (
      <Box component="td" sx={{ p: 0 }}>
        <Box
          component="input"
          autoFocus
          aria-label={rotulo ?? 'Valor da célula'}
          defaultValue={nulo ? '' : String(valor)}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            setEditando(false);
            onEditar?.(e.target.value);
          }}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            // `Escape` desiste: sai sem chamar `onEditar`, e o valor fica como
            // estava. Sem isto, começar a editar por engano já sujaria o rascunho.
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditando(false);
            }
            // `Ctrl+0` põe NULL. Um botão por célula seria ruído; digitar a
            // palavra "NULL" gravaria o TEXTO, que é outra coisa.
            if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              setEditando(false);
              onEditar?.(null);
            }
          }}
          sx={{
            width: '100%', border: 0, outline: 'none', px: 1, py: '3px',
            bgcolor: 'primary.main', color: 'background.default',
            font: 'inherit', fontFamily: tokens.fontMono, fontSize: 12,
          }}
        />
      </Box>
    );
  }

  const texto = nulo ? '(NULL)' : String(valor);

  return (
    <Box
      component="td"
      {...(nomeDaColuna === undefined ? {} : { 'data-celula-da-coluna': nomeDaColuna })}
      title={titulo ?? recortar(texto)}
      onDoubleClick={editavel ? () => setEditando(true) : undefined}
      // Clicar copia: o caso mais comum é levar um id para a próxima consulta.
      // Editar é DUPLO clique, para não brigar com isso.
      onClick={() => void navigator.clipboard?.writeText(nulo ? '' : String(valor))}
      sx={{
        cursor: 'pointer',
        textAlign: alinhamento,
        // `relative` para a lupa se pendurar no canto direito da célula.
        position: 'relative',
        color: nulo ? 'text.secondary' : 'text.primary',
        fontStyle: nulo ? 'italic' : 'normal',
        textDecoration: riscada ? 'line-through' : 'none',
        opacity: riscada ? 0.5 : 1,
        bgcolor: mexida ? 'warning.main' : undefined,
        ...(mexida ? { color: 'background.default' } : {}),
        '&:hover': { bgcolor: mexida ? 'warning.main' : 'action.hover' },
        // A lupa só sob o mouse: uma por célula, sempre visível, encheria a
        // grade de ícones e roubaria a leitura do dado, que é o que importa.
        '& [data-lupa]': { opacity: 0 },
        '&:hover [data-lupa]': { opacity: 1 },
      }}
    >
      {/* `(NULL)` com parênteses, como na ferramenta que ele usava. Os
          parênteses fazem o trabalho que o itálico sozinho não fazia: dizer que
          aquilo é a AUSÊNCIA de valor, e não uma célula cujo texto é "NULL" —
          que é uma coisa que existe e que a grade precisa saber distinguir. */}
      {recortar(texto)}
      {onAbrir !== undefined && (
        <Box
          component="button"
          type="button"
          data-lupa
          aria-label="Ver o valor inteiro"
          title="Ver o valor inteiro"
          onClick={(e: React.MouseEvent) => {
            // Sem isto o clique da célula copia o valor no mesmo gesto.
            e.stopPropagation();
            onAbrir();
          }}
          onDoubleClick={(e: React.MouseEvent) => e.stopPropagation()}
          sx={{
            position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
            border: 0, borderRadius: 0.5, p: 0.2, display: 'flex', cursor: 'pointer',
            bgcolor: 'background.paper', color: 'text.secondary',
            '&:hover': { color: 'primary.main' },
          }}
        >
          <Icon name="lucide:zoom-in" size={13} />
        </Box>
      )}
    </Box>
  );
}
