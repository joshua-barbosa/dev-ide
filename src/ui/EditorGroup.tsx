// Um grupo de editor: barra de abas mais o conteúdo da aba ativa dele.
//
// Nasceu da spec 020, quando a tela passou a poder ser dividida. Antes havia uma
// barra de abas e um editor, escritos direto no `App`; com dois lados, o mesmo
// bloco precisava existir duas vezes — e duplicá-lo seria garantir que os dois
// divergissem.
//
// **A regra que este arquivo repete três vezes, porque ela já custou dois
// defeitos:** editor e terminais ficam MONTADOS e apenas somem de vista.
// Desmontar perde a instância imperativa, mata o processo e apaga o buffer.
import Box from '@mui/material/Box';
import { TabBar } from './tabs/TabBar';
import { EditorHost, type EditorHandle } from './editor/EditorHost';
import { TerminalHost } from './terminal/TerminalHost';
import { ResultGrid } from './grid/ResultGrid';
import { MarkdownPreview } from './editor/MarkdownPreview';
import { tokens } from './theme';
import type { Tab } from '../shared/tabs';
import type { NomeDoTema } from '../shared/temas';
import type { Snippet } from '../shared/snippets';
import type { EstadoGrade } from './useExecution';

export interface EditorGroupProps {
  readonly grupo: number;
  readonly abas: readonly Tab[];
  readonly ativaId: string | null;
  /** Verdadeiro no grupo que recebe os comandos e dita a barra de status. */
  readonly focado: boolean;
  /** Verdadeiro quando há mais de um grupo — muda o que a tela vazia diz. */
  readonly dividido: boolean;

  readonly fontSize: number;
  readonly tabSize: number;
  readonly wordWrap: boolean;
  readonly terminalFontSize: number;
  readonly tema: NomeDoTema;
  readonly snippets: readonly Snippet[];

  readonly grades: ReadonlyMap<string, EstadoGrade>;
  /** Abas mostrando o conteúdo renderizado em vez do texto (spec 024). */
  readonly emPreview: ReadonlySet<string>;
  conteudoDaAba(id: string): string;
  /** Ausente quando a aba ativa não é pré-visualizável. */
  readonly onPreview?: () => void;
  /** O formulário de conexão é montado pelo `App`, que conhece os drivers. */
  readonly formulario: React.ReactNode;

  registrarEditor(handle: EditorHandle | null): void;
  onFocar(): void;
  onAtivar(id: string): void;
  onFechar(id: string): void;
  onMudar(): void;
  onCursor(linha: number, coluna: number): void;
  /** Ausente quando não há o que executar; aí o botão não aparece. */
  readonly onExecutar?: () => void;
}

export function EditorGroup({
  grupo, abas, ativaId, focado, dividido,
  fontSize, tabSize, wordWrap, terminalFontSize, tema, snippets,
  grades, formulario, emPreview, conteudoDaAba, onPreview,
  registrarEditor, onFocar, onAtivar, onFechar, onMudar, onCursor, onExecutar,
}: EditorGroupProps) {
  const ativa = abas.find((t) => t.id === ativaId) ?? null;
  const semAbas = abas.length === 0;
  const mostrandoPreview = ativa !== null && emPreview.has(ativa.id);
  const mostrarEditor =
    !semAbas &&
    ativa !== null &&
    !mostrandoPreview &&
    !['grid', 'conexao', 'terminal'].includes(ativa.type);

  return (
    <Box
      data-grupo-editor={grupo}
      data-grupo-focado={focado ? 'true' : 'false'}
      // `onFocusCapture` e não `onClick`: clicar no editor não dispara clique no
      // contêiner (o Monaco engole), mas o foco sobe sempre.
      onFocusCapture={onFocar}
      onMouseDown={onFocar}
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        // A divisa entre os dois lados. Só a partir do segundo, para o primeiro
        // não ganhar uma borda solta na esquerda.
        ...(grupo > 0 ? { borderLeft: 1, borderColor: 'divider' } : {}),
      }}
    >
      <TabBar
        tabs={abas}
        activeId={ativaId}
        onActivate={onAtivar}
        onClose={onFechar}
        onExecutar={onExecutar}
        ehSql={ativa?.type === 'sql'}
        onPreview={onPreview}
        emPreview={mostrandoPreview}
      />

      {/* Montado sempre: desmontá-lo ao ficar sem abas perderia a instância e a
          fachada imperativa. Some de vista, não do DOM. */}
      <Box sx={{ flex: 1, display: mostrarEditor ? 'flex' : 'none', minHeight: 0 }}>
        <EditorHost
          ref={registrarEditor}
          onChange={onMudar}
          onCursor={onCursor}
          fontSize={fontSize}
          tabSize={tabSize}
          wordWrap={wordWrap}
          tema={tema}
          snippets={snippets}
        />
      </Box>

      {/* O editor continua MONTADO atrás do preview — a regra de sempre. Trocar
          para o renderizado não pode custar histórico de desfazer nem rolagem. */}
      {mostrandoPreview && ativa !== null && (
        <MarkdownPreview fonte={conteudoDaAba(ativa.id)} />
      )}

      {ativa?.type === 'grid' && (
        <ResultGrid {...(grades.get(ativa.id) ?? { resultado: null })} />
      )}

      {/* Mesma regra do editor: cada terminal fica montado e apenas some de
          vista. Renderizar só o ativo mataria o processo ao trocar de aba. */}
      {abas
        .filter((t) => t.type === 'terminal')
        .map((t) => (
          <Box
            key={t.id}
            sx={{ flex: 1, minHeight: 0, display: ativaId === t.id ? 'flex' : 'none' }}
          >
            <TerminalHost
              ativo={ativaId === t.id}
              fontSize={terminalFontSize}
              tema={tema}
              connectionId={typeof t.meta.connectionId === 'string' ? t.meta.connectionId : null}
            />
          </Box>
        ))}

      {ativa?.type === 'conexao' && formulario}

      {semAbas && (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: tokens.bgEditor,
            color: 'text.secondary',
            fontSize: 13,
            textAlign: 'center',
            px: 2,
          }}
        >
          {dividido
            ? 'Este lado está vazio — arraste uma aba para cá ou use Split Editor.'
            : 'Nenhuma aba aberta — abra um arquivo pela árvore lateral.'}
        </Box>
      )}
    </Box>
  );
}
