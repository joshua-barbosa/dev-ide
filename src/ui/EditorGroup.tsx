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
import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { TabBar } from './tabs/TabBar';
import { ZonaDeSoltura } from './ZonaDeSoltura';
import { EditorHost, type EditorHandle } from './editor/EditorHost';
import { AbaDeTerminal } from './terminal/AbaDeTerminal';
import { ResultGrid } from './grid/ResultGrid';
import { TabelaHost } from './tabela/TabelaHost';
import { ProcessosHost } from './processos/ProcessosHost';
import { CadernoHost } from './caderno/CadernoHost';
import { ServidorHost } from './servidor/ServidorHost';
import type { QuickInputController } from './useQuickInput';
import { MarkdownPreview } from './editor/MarkdownPreview';
import { tokens } from './theme';
import type { Tab } from '../shared/tabs';
import type { NomeDoTema } from '../shared/temas';
import type { SessionCapabilities } from '../shared/contracts';
import type { Vinculo } from '../shared/sql/vinculo';
import type { Snippet } from '../shared/snippets';
import type { EstadoGrade } from './useExecution';
import {
  decodificarCarga, MIME_DE_ARRASTE, zonaDoPonto, type CargaDeArraste, type Zona,
} from '../shared/arrastar';

export interface EditorGroupProps {
  readonly grupo: number;
  readonly abas: readonly Tab[];
  readonly ativaId: string | null;
  /** Abre um texto exportado numa aba sem título (spec 041). */
  readonly onExportar: (conteudo: string, linguagem: string) => void;
  /** Mostra o SQL de escrita e espera o sim (spec 044). */
  readonly onConfirmarEscrita: (mensagem: string, titulo: string) => Promise<boolean>;
  /** A conexão desta aba é somente-leitura? Aí a edição nem aparece. */
  readonly conexaoSomenteLeitura: (aba: Tab) => boolean;
  /** A entrada rápida e a abertura de comando, para as alterações (spec 046). */
  readonly qi: QuickInputController;
  readonly abrirComando: (id: string, titulo: string, sql: string) => void;
  readonly onErroDaTabela: (erro: unknown) => void;
  /** O Query Book (spec 048): mudar o conteúdo e rodar um bloco. */
  readonly onMudarCaderno: (id: string, conteudo: string) => void;
  /** Roda um bloco de caderno no runner (spec 051). */
  readonly onRodarCodigoDoBloco: (linguagem: string, codigo: string) => Promise<void>;
  /** O que a aba de servidor precisa (spec 055). */
  readonly capacidadesDe: (conexaoId: string) => SessionCapabilities | null;
  readonly onAbrirArquivoRemoto: (conexaoId: string, caminho: string) => Promise<void>;
  readonly onAbrirTerminalDoServidor: (aba: Tab) => void;
  /** Abre outro terminal da mesma conexão (spec 058). */
  readonly onDuplicarTerminal: (aba: Tab) => void;
  readonly onConfirmarSnippet: (o: {
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }) => Promise<boolean>;
  /** Pergunta a linguagem de um bloco (spec 051). */
  readonly onPedirLinguagem: (atual: string) => Promise<string | null>;
  /** Contra quem um caderno roda, e como trocar (spec 051). */
  readonly vinculoDoCaderno: (aba: Tab) => Vinculo | null;
  readonly onTrocarVinculoDoCaderno: (aba: Tab) => void;
  readonly onRodarBloco: (
    modo: 'run' | 'tab' | 'json',
    sql: string,
    caminho: string | null,
    titulo: string
  ) => Promise<boolean>;
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
  /** Comando pedido de DENTRO do editor, por tecla que o Monaco reserva. */
  readonly onComando: (id: string) => void;

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
  /** Soltou algo neste grupo, na zona dada (spec 025). */
  onSoltar(zona: Zona, carga: CargaDeArraste): void;
}

export function EditorGroup({
  grupo, abas, ativaId, focado, dividido,
  fontSize, tabSize, wordWrap, terminalFontSize, tema, snippets,
  grades, formulario, emPreview, conteudoDaAba, onPreview,
  registrarEditor, onFocar, onAtivar, onFechar, onMudar, onCursor, onExecutar, onSoltar,
  onComando, onExportar, onConfirmarEscrita, conexaoSomenteLeitura,
  qi, abrirComando, onErroDaTabela, onMudarCaderno, onRodarBloco,
  capacidadesDe, onAbrirArquivoRemoto, onAbrirTerminalDoServidor,
  onDuplicarTerminal, onConfirmarSnippet,
  onRodarCodigoDoBloco, onPedirLinguagem, vinculoDoCaderno, onTrocarVinculoDoCaderno,
}: EditorGroupProps) {
  const caixa = useRef<HTMLDivElement>(null);
  // A zona vive num `ref` E num estado: o `ref` é a verdade que a soltura lê, o
  // estado só desenha o indicador.
  //
  // Ler do estado no `drop` parece funcionar porque o `dragover` dispara dezenas
  // de vezes e o React tem tempo de reconciliar entre elas. Mas soltar logo após
  // entrar no grupo cai numa closure com `zona` ainda `null`, e o arraste se
  // perde sem dizer nada. Foi assim que o teste automatizado o pegou.
  const zonaAtual = useRef<Zona | null>(null);
  const [zona, setZona] = useState<Zona | null>(null);

  const definirZona = (nova: Zona | null): void => {
    zonaAtual.current = nova;
    setZona(nova);
  };

  /** Só arraste NOSSO acende o indicador — um arquivo do sistema não conta. */
  const ehNosso = (e: React.DragEvent): boolean =>
    [...e.dataTransfer.types].includes(MIME_DE_ARRASTE);

  const aoArrastarSobre = (e: React.DragEvent): void => {
    if (!ehNosso(e)) return;
    // Sem `preventDefault` o navegador recusa a soltura — é o modo de dizer
    // "aceito aqui".
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const r = caixa.current?.getBoundingClientRect();
    if (r === undefined) return;
    definirZona(
      zonaDoPonto(
        { x: r.left, y: r.top, largura: r.width, altura: r.height },
        e.clientX,
        e.clientY
      )
    );
  };

  const aoSoltar = (e: React.DragEvent): void => {
    if (!ehNosso(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const alvo = zonaAtual.current;
    definirZona(null);
    // O conteúdo só pode ser lido no `drop`; durante o `dragover` o navegador
    // entrega apenas os TIPOS. É por isso que o indicador se decide pelo tipo.
    const carga = decodificarCarga(e.dataTransfer.getData(MIME_DE_ARRASTE));
    if (carga !== null && alvo !== null) onSoltar(alvo, carga);
  };
  const ativa = abas.find((t) => t.id === ativaId) ?? null;
  const semAbas = abas.length === 0;
  const mostrandoPreview = ativa !== null && emPreview.has(ativa.id);
  const mostrarEditor =
    !semAbas &&
    ativa !== null &&
    !mostrandoPreview &&
    !['grid', 'conexao', 'terminal', 'tabela', 'processos', 'caderno', 'servidor'].includes(
      ativa.type
    );

  return (
    <Box
      ref={caixa}
      data-grupo-editor={grupo}
      data-grupo-focado={focado ? 'true' : 'false'}
      // `onFocusCapture` e não `onClick`: clicar no editor não dispara clique no
      // contêiner (o Monaco engole), mas o foco sobe sempre.
      onFocusCapture={onFocar}
      onMouseDown={onFocar}
      onDragOver={aoArrastarSobre}
      onDragEnter={aoArrastarSobre}
      // `dragleave` dispara também ao passar sobre um filho; comparar o alvo
      // com a própria caixa evita o indicador piscar dentro do grupo.
      onDragLeave={(e) => {
        if (!caixa.current?.contains(e.relatedTarget as Node | null)) definirZona(null);
      }}
      onDrop={aoSoltar}
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // `relative` porque o indicador de soltura é posicionado sobre o grupo.
        position: 'relative',
      }}
    >
      <ZonaDeSoltura zona={zona} />
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
          onComando={onComando}
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

      {/* O Query Book (spec 048). Montado e escondido como as outras abas:
          remontar perderia o bloco em foco e a rolagem. */}
      {abas
        .filter((t) => t.type === 'caderno')
        .map((t) => (
          <Box
            key={t.id}
            sx={{ flex: 1, minHeight: 0, display: ativaId === t.id ? 'flex' : 'none' }}
          >
            <CadernoHost
              aba={t}
              fontSize={fontSize}
              tabSize={tabSize}
              tema={tema}
              onMudar={onMudarCaderno}
              onRodar={onRodarBloco}
              onRodarCodigo={onRodarCodigoDoBloco}
              onPedirLinguagem={onPedirLinguagem}
              vinculo={vinculoDoCaderno(t)}
              onTrocarVinculo={() => onTrocarVinculoDoCaderno(t)}
            />
          </Box>
        ))}

      {/* A aba de processos (spec 047). Montada e escondida como as outras:
          voltar a ela não pode custar outra consulta ao servidor. */}
      {abas
        .filter((t) => t.type === 'processos')
        .map((t) => (
          <Box
            key={t.id}
            sx={{ flex: 1, minHeight: 0, display: ativaId === t.id ? 'flex' : 'none' }}
          >
            <ProcessosHost
              aba={t}
              somenteLeitura={conexaoSomenteLeitura(t)}
              onConfirmar={onConfirmarEscrita}
              onErro={onErroDaTabela}
            />
          </Box>
        ))}

      {/* A aba de tabela (spec 041). Cada uma fica MONTADA e apenas some de
          vista: remontar perderia a página, a ordenação e os filtros, e
          custaria outra ida ao banco a cada troca de aba. */}
      {abas
        .filter((t) => t.type === 'tabela')
        .map((t) => (
          <Box
            key={t.id}
            sx={{ flex: 1, minHeight: 0, display: ativaId === t.id ? 'flex' : 'none' }}
          >
            <TabelaHost
              aba={t}
              onExportar={onExportar}
              onConfirmar={onConfirmarEscrita}
              somenteLeitura={conexaoSomenteLeitura(t)}
              qi={qi}
              abrirComando={abrirComando}
              onErro={onErroDaTabela}
            />
          </Box>
        ))}

      {/* Mesma regra do editor: cada terminal fica montado e apenas some de
          vista. Renderizar só o ativo mataria o processo ao trocar de aba. */}
      {abas
        .filter((t) => t.type === 'terminal')
        .map((t) => (
          <Box
            key={t.id}
            sx={{
              flex: 1, minHeight: 0, flexDirection: 'column',
              display: ativaId === t.id ? 'flex' : 'none',
            }}
          >
            <AbaDeTerminal
              aba={t}
              comandoDeAbertura={
                // Terminal sem conexão (o do painel) não tem capacidade nenhuma
                // para esperar: abre já, sem comando.
                typeof t.meta.connectionId !== 'string'
                  ? ''
                  : (capacidadesDe(t.meta.connectionId)?.comandoDeTerminal ?? null)
              }
              ativo={ativaId === t.id}
              fontSize={terminalFontSize}
              tema={tema}
              onDuplicar={onDuplicarTerminal}
              pedir={(o) => qi.pedir(o)}
              confirmar={onConfirmarSnippet}
              onErro={onErroDaTabela}
            />
          </Box>
        ))}

      {ativa?.type === 'conexao' && formulario}

      {/*
        A aba de servidor (spec 055). Como todas as outras, ela é escondida com
        `display: none` e não desmontada: dentro dela há a pasta em que o
        usuário estava no SFTP.
      */}
      {abas
        .filter((t) => t.type === 'servidor')
        .map((t) => (
          <Box
            key={t.id}
            sx={{
              flex: 1, minHeight: 0,
              display: ativa?.id === t.id ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <ServidorHost
              conexaoId={String((t.meta as { connectionId?: string }).connectionId ?? '')}
              rotulo={t.title}
              capacidades={capacidadesDe(String((t.meta as { connectionId?: string }).connectionId ?? ''))}
              somenteLeitura={conexaoSomenteLeitura(t)}
              onAbrirArquivo={onAbrirArquivoRemoto}
              onAbrirTerminal={() => onAbrirTerminalDoServidor(t)}
              onErro={onErroDaTabela}
            />
          </Box>
        ))}

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
