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
import { useCallback, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { TabBar } from './tabs/TabBar';
import { ZonaDeSoltura } from './ZonaDeSoltura';
import { EditorHost, type AcaoDeMenuDoEditor, type EditorHandle } from './editor/EditorHost';
import type { ContextoDeLinguagem } from './editor/provedores';
import { AbaDeTerminal } from './terminal/AbaDeTerminal';
import { ResultGrid } from './grid/ResultGrid';
import { TabelaHost } from './tabela/TabelaHost';
import { ProcessosHost } from './processos/ProcessosHost';
import { CadernoHost } from './caderno/CadernoHost';
import { ServidorHost } from './servidor/ServidorHost';
import type { QuickInputController } from './useQuickInput';
import { MarkdownPreview } from './editor/MarkdownPreview';
import { VisualizadorDeArquivo } from './editor/VisualizadorDeArquivo';
import { ChaveHost } from './chaves/ChaveHost';
import { BarraDoArquivo } from './editor/BarraDoArquivo';
import type { Visualizador } from '../shared/editor/visualizadores';
import { tokens } from './theme';
import type { EntradaMenu } from './ContextMenu';
import type { Tab } from '../shared/tabs';
import type { NomeDoTema } from '../shared/temas';
import type { QueryResult, SessionCapabilities } from '../shared/contracts';
import type { Vinculo } from '../shared/sql/vinculo';
import type { ResultadoSalvo } from '../shared/sql/caderno';
import type { Snippet } from '../shared/snippets';
import type { ConfiguracaoDoEmmet } from '../shared/emmet';
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
  /** Abre o menu de botão direito da tabela SFTP (T079). */
  abrirMenu(e: React.MouseEvent, entradas: readonly EntradaMenu[]): void;
  /** Os bancos de uma conexão, para o Structure Sync (T070). */
  bancosDaConexao(conexaoId: string): readonly string[];
  /** Abre um SQL gerado numa aba do editor — quem executa é o usuário (T070). */
  onAbrirSql(titulo: string, sql: string): void;
  /** Pergunta antes do que não tem volta — kill e excluir remoto (T079, T080). */
  confirmar(o: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
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
  /** Abre um arquivo no editor — o `{}` da barra do terminal usa (T085). */
  readonly onAbrirArquivo: (caminho: string) => Promise<void>;
  readonly onConfirmarSnippet: (o: {
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }) => Promise<boolean>;
  /** Pergunta a linguagem de um bloco (spec 051). */
  readonly onPedirLinguagem: (atual: string) => Promise<string | null>;
  /** Pergunta o nome do resultado a guardar no caderno (T072). */
  readonly onPedirNomeDoResultado: (sqlDoBloco: string) => Promise<string | null>;
  /** Abre um resultado guardado numa aba de grade (T072). */
  readonly onAbrirResultadoSalvo: (titulo: string, resultado: ResultadoSalvo) => void;
  /** Contra quem um caderno roda, e como trocar (spec 051). */
  readonly vinculoDoCaderno: (aba: Tab) => Vinculo | null;
  readonly onTrocarVinculoDoCaderno: (aba: Tab) => void;
  readonly onRodarBloco: (
    modo: 'run' | 'tab' | 'json',
    sql: string,
    caminho: string | null,
    titulo: string
  ) => Promise<QueryResult | null>;
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
  /** Como o Emmet está configurado (T022). */
  readonly emmet: ConfiguracaoDoEmmet;
  /** Comando pedido de DENTRO do editor, por tecla que o Monaco reserva. */
  readonly onComando: (id: string) => void;

  readonly grades: ReadonlyMap<string, EstadoGrade>;
  /** Abas mostrando o conteúdo renderizado em vez do texto (spec 024). */
  readonly emPreview: ReadonlySet<string>;
  conteudoDaAba(id: string): string;
  /** Grava conteúdo novo numa aba e a suja — o CSV editado pela grade (P5). */
  onConteudoDaAba?: (id: string, texto: string) => void;
  /** Ausente quando a aba ativa não é pré-visualizável. */
  readonly onPreview?: () => void;
  /** O formulário de conexão é montado pelo `App`, que conhece os drivers. */
  readonly formulario: React.ReactNode;
  /** A tela de configurações (T001), montada pelo `App`, que tem as prefs. */
  readonly preferencias: React.ReactNode;
  readonly requisitos: React.ReactNode;
  readonly codesnap: React.ReactNode;
  /** Itens próprios no menu de botão direito do editor (spec 077). */
  readonly acoesDeMenu?: readonly AcaoDeMenuDoEditor[];
  /** O que a inteligência de código precisa saber (lote E). */
  readonly contextoDeLinguagem?: ContextoDeLinguagem;
  /** A trilha acima do editor (T075). Montada pelo `App`, que tem os símbolos. */
  readonly breadcrumb?: React.ReactNode;

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
  /** Soltou uma aba na BARRA deste grupo, antes da aba dita (T029). */
  onReordenarAba(id: string, antesDe: string | null): void;
}

export function EditorGroup({
  grupo, abas, ativaId, focado, dividido,
  fontSize, tabSize, wordWrap, terminalFontSize, tema, snippets, emmet,
  grades, formulario, preferencias, requisitos, codesnap, acoesDeMenu,
  contextoDeLinguagem, breadcrumb, emPreview, conteudoDaAba, onConteudoDaAba, onPreview,
  registrarEditor, onFocar, onAtivar, onFechar, onMudar, onCursor, onExecutar, onSoltar,
  onReordenarAba,
  onComando, onExportar, onConfirmarEscrita, conexaoSomenteLeitura,
  qi, abrirMenu, bancosDaConexao, onAbrirSql, confirmar, abrirComando, onErroDaTabela, onMudarCaderno, onRodarBloco, onAbrirArquivo,
  capacidadesDe, onAbrirArquivoRemoto, onAbrirTerminalDoServidor,
  onDuplicarTerminal, onConfirmarSnippet,
  onRodarCodigoDoBloco, onPedirLinguagem, vinculoDoCaderno, onTrocarVinculoDoCaderno,
  onPedirNomeDoResultado, onAbrirResultadoSalvo,
}: EditorGroupProps) {
  /**
   * O editor DESTE grupo, para focá-lo ao clicar numa aba.
   *
   * Um ref próprio em vez de subir até o `App`: quem sabe qual editor é o deste
   * grupo é este componente, e a tela dividida tem dois.
   */
  const editorDoGrupo = useRef<EditorHandle | null>(null);

  /**
   * ESTÁVEL, e não uma arrow inline.
   *
   * Uma função nova a cada render faz o React chamar o `ref` com `null` e de
   * novo com o handle em toda passagem — e o registro do editor entra em ciclo,
   * derrubando a IDE antes de ela abrir. Foi o que aconteceu na primeira versão
   * disto.
   */
  const guardarEditor = useCallback(
    (h: EditorHandle | null) => {
      editorDoGrupo.current = h;
      registrarEditor(h);
    },
    [registrarEditor]
  );

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
    // Pasta não abre no editor (T090): ela arrasta porque o SFTP a recebe, e
    // tentar abrir um diretório aqui daria um erro sem sentido para quem só
    // errou o alvo.
    if (carga?.tipo === 'arquivo' && carga.pasta === true) return;
    if (carga !== null && alvo !== null) onSoltar(alvo, carga);
  };
  const ativa = abas.find((t) => t.id === ativaId) ?? null;
  const semAbas = abas.length === 0;
  const mostrandoPreview = ativa !== null && emPreview.has(ativa.id);
  const mostrarEditor =
    !semAbas &&
    ativa !== null &&
    !mostrandoPreview &&
    ![
      'grid', 'conexao', 'terminal', 'tabela', 'processos', 'caderno', 'servidor', 'chave',
      'preferencias', 'requisitos', 'codesnap',
      // Imagem, PDF e CSV têm tela própria (T027) — o Monaco não abre nenhum
      // dos três de um jeito útil.
      'visualizador',
    ].includes(ativa.type);

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
        onActivate={(id) => {
          onAtivar(id);
          // O FOCO vai para o editor — e só neste gesto.
          //
          // Clicar numa aba põe o foco no elemento da aba. O Monaco restaura os
          // cursores mas fica sem foco no DOM, e aí ele nem desenha o cursor
          // primário nem aceita tecla: os cursores aparecem e o editor parece
          // travado. Foi o que ele descreveu — *"o cursor está lá, mas está
          // travado, se eu digito não faz nada"*.
          //
          // **Aqui, e não no efeito que restaura a aba.** Ativar uma aba também
          // acontece ao clicar um arquivo na ÁRVORE, e lá o foco tem de ficar
          // na árvore: é dele que o `F2` e o `Delete` dependem. Focar em toda
          // ativação trocaria um defeito por outro.
          // DEPOIS do commit, e não agora.
          //
          // O React agrupa a mudança de estado e só a aplica ao fim do evento:
          // focar aqui seria focar ANTES de a aba nova carregar o modelo dela, e
          // a troca de modelo desfaz o foco. Medido — com o `focus()` síncrono o
          // editor continuava mudo. O `requestAnimationFrame` roda depois do
          // efeito que restaura a aba.
          requestAnimationFrame(() => editorDoGrupo.current?.focus());
        }}
        onClose={onFechar}
        onExecutar={onExecutar}
        ehSql={ativa?.type === 'sql'}
        onArrastarNaBarra={() => definirZona(null)}
        onSoltarNaBarra={(carga, antesDe) => {
          definirZona(null);
          // Arquivo solto na barra abre neste grupo, no fim da fila: escolher
          // posição para algo que ainda nem é aba seria promessa a mais.
          if (carga.tipo === 'aba') onReordenarAba(carga.id, antesDe);
          else onSoltar('centro', carga);
        }}
      />

      {/* A faixa abaixo das abas (T025). O switch morava DENTRO da barra de
          abas e aparecia no meio da tela com vários arquivos abertos. */}
      <BarraDoArquivo onPreview={onPreview} emPreview={mostrandoPreview} />

      {/* A trilha (T075). Só com editor à vista: numa grade ou num terminal
          ela mostraria o caminho do último arquivo aberto ali, que é mentira. */}
      {mostrarEditor && breadcrumb}

      {/* Montado sempre: desmontá-lo ao ficar sem abas perderia a instância e a
          fachada imperativa. Some de vista, não do DOM. */}
      <Box sx={{ flex: 1, display: mostrarEditor ? 'flex' : 'none', minHeight: 0 }}>
        <EditorHost
          ref={guardarEditor}
          acoesDeMenu={acoesDeMenu}
          contextoDeLinguagem={contextoDeLinguagem}
          onChange={onMudar}
          onCursor={onCursor}
          fontSize={fontSize}
          tabSize={tabSize}
          wordWrap={wordWrap}
          tema={tema}
          snippets={snippets}
          emmet={emmet}
          onComando={onComando}
        />
      </Box>

      {/* O editor continua MONTADO atrás do preview — a regra de sempre. Trocar
          para o renderizado não pode custar histórico de desfazer nem rolagem. */}
      {mostrandoPreview && ativa !== null && (
        <MarkdownPreview fonte={conteudoDaAba(ativa.id)} />
      )}

      {/* Imagem, PDF e CSV (T027). Montado só quando é a aba ativa: um PDF
          escondido continuaria sendo desenhado pelo navegador, e um CSV grande
          continuaria ocupando a memória da grade. */}
      {ativa?.type === 'visualizador' && (
        <VisualizadorDeArquivo
          tipo={(ativa.meta.visualizador as Visualizador | undefined) ?? 'texto'}
          // Arquivo remoto não tem `path` — o caminho dele é o `remotePath`, e
          // o `path` fica nulo de propósito para `Ctrl+S` nunca gravar aqui.
          caminho={String(ativa.meta.remotePath ?? ativa.meta.path ?? '')}
          {...(typeof ativa.meta.remoteConnectionId === 'string'
            ? { conexaoRemota: ativa.meta.remoteConnectionId }
            : {})}
          conteudo={conteudoDaAba(ativa.id)}
          // P5: editar CSV pela grade. Escreve na ABA e a suja; quem salva
          // continua sendo o Ctrl+S.
          onConteudo={
            onConteudoDaAba === undefined
              ? undefined
              : (texto) => onConteudoDaAba(ativa.id, texto)
          }
        />
      )}

      {/* A chave de chave-valor (spec 089). Montada só quando ativa: ela busca
          do servidor ao nascer, e manter as escondidas vivas faria cada troca
          de aba disparar leituras que ninguém está olhando. */}
      {ativa?.type === 'chave' && (
        <ChaveHost
          conexaoId={String(ativa.meta.connectionId ?? '')}
          chave={String(ativa.meta.chave ?? '')}
          somenteLeitura={conexaoSomenteLeitura(ativa)}
        />
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
              onPedirNome={onPedirNomeDoResultado}
              onAbrirResultadoSalvo={onAbrirResultadoSalvo}
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
              ativa={ativaId === t.id}
              bancos={bancosDaConexao(
                String((t.meta as { connectionId?: string }).connectionId ?? '')
              )}
              somenteLeitura={conexaoSomenteLeitura(t)}
              onConfirmar={onConfirmarEscrita}
              onAbrirSql={onAbrirSql}
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
              tema={tema}
              fontSize={fontSize}
              tabSize={tabSize}
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
              abrirArquivo={onAbrirArquivo}
            />
          </Box>
        ))}

      {ativa?.type === 'conexao' && formulario}

      {/* A tela de configurações (T001). Montada só quando é a aba ativa: ela
          não guarda estado nenhum — o que vale está no `config.json`. */}
      {ativa?.type === 'preferencias' && preferencias}
      {ativa?.type === 'requisitos' && requisitos}
      {ativa?.type === 'codesnap' && codesnap}

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
              abrirMenu={abrirMenu}
              confirmar={confirmar}
              pedirTexto={(o) =>
                qi.pedir({
                  titulo: o.titulo,
                  placeholder: '',
                  ...(o.valorInicial === undefined ? {} : { valorInicial: o.valorInicial }),
                })
              }
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
