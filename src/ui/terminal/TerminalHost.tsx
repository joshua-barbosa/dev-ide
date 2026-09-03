// A aba de terminal: emulador ligado ao PTY do servidor.
//
// O `xterm.js` é um emulador de terminal de verdade — ele interpreta as
// sequências de escape que o programa emite ("mova o cursor", "pinte de
// vermelho", "limpe a tela"), que é o protocolo dos terminais físicos ainda em
// uso. Sem ele a saída chegaria como texto sujo de caracteres de controle.
//
// Fica fora do React na parte que importa: o emulador desenha numa `<div>` que
// ele mesmo gerencia. É a mesma exceção que o editor tem — DOM imperativo por
// natureza, e reconciliar isso a cada render seria pior de todas as formas.
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { tokens } from '../theme';
import { pareceProntoParaComando } from '../../shared/terminal/prompt';
import { acaoDoTerminal, textoParaCopiar } from '../../shared/terminal-copiar';
import { escapaDoTerminal, formatarAtalho } from '../../shared/commands';
import { paletaDe, type NomeDoTema } from '../../shared/temas';
import { resolverAparencia, type AparenciaDoTerminal } from '../../shared/terminal/aparencia';

export interface TerminalHostProps {
  /** Ausente = shell do usuário; presente = cliente daquela conexão. */
  readonly connectionId?: string | null;
  /**
   * Falso quando a aba está aberta mas escondida.
   *
   * O componente continua montado — é isso que preserva o processo e o buffer —
   * e só o foco e o reajuste de tamanho dependem de estar à vista.
   */
  readonly ativo?: boolean;
  readonly onFim?: (exitCode: number) => void;
  /** Vem do arquivo de preferências (spec 011). */
  readonly fontSize?: number;
  /**
   * O que ESTE terminal sobrescreve do `config.json` (T086).
   *
   * Vazio = herda tudo. Vive na aba e some no F5, como a largura de coluna da
   * grade — é marcação para distinguir um terminal dos outros três abertos ao
   * lado, e não preferência da IDE. Foi o motivo que ele deu.
   */
  readonly aparencia?: AparenciaDoTerminal;
  /**
   * Tema (spec 017).
   *
   * O xterm pinta em canvas, então recebe a COR de verdade — variável CSS não
   * chega lá. É o mesmo motivo pelo qual o Monaco recebe a paleta.
   */
  readonly tema?: NomeDoTema;
  /**
   * Comando a executar assim que o shell estiver de pé.
   *
   * Enviado como **digitação**, e não como executável: é o que o usuário faria
   * com as mãos, e não abre superfície nova — o socket já aceita texto
   * arbitrário. Mandar o servidor montar o comando daria ao navegador o poder
   * de escolher o executável, que a spec 008 fechou de propósito.
   */
  readonly comandoInicial?: string | null;
  /**
   * Um comando para enviar AGORA — o snippet da barra (spec 058).
   *
   * É um objeto com id porque o gatilho é a MUDANÇA: enviar o mesmo texto duas
   * vezes é um caso legítimo (rodar o mesmo snippet de novo), e comparar só o
   * texto engoliria a segunda vez.
   */
  readonly comandoParaEnviar?: { readonly id: number; readonly texto: string } | null;
  /**
   * Id da sessão, escolhido pelo cliente (spec 023).
   *
   * É o que permite reatar o mesmo processo depois de um F5: o servidor não tem
   * como saber sozinho que o socket novo é a mesma aba de antes.
   */
  readonly sessaoId?: string;
}

/**
 * Cores do emulador. O fundo acompanha o do editor, para não haver emenda.
 *
 * A paleta ANSI vai junto: o shell colore o prompt e o `ls` supondo fundo
 * escuro, e sobre branco o amarelo e o ciano padrão somem. Sem isso o tema
 * claro entregaria um terminal com metade do texto invisível.
 */
function coresDoTerminal(nome: NomeDoTema): ITheme {
  const p = paletaDe(nome);
  return { background: p.bgEditor, foreground: p.fg, cursor: p.accent, ...p.ansi };
}

export function TerminalHost({
  connectionId = null, ativo = true, onFim, fontSize = 13, tema = 'escuro',
  comandoInicial = null, comandoParaEnviar = null, sessaoId, aparencia = {},
}: TerminalHostProps) {
  const caixa = useRef<HTMLDivElement>(null);
  /**
   * O emulador, para o MENU poder ler a seleção.
   *
   * O menu de botão direito existe porque atalho não se descobre: quem nunca
   * usou `Ctrl+Shift+C` num terminal não vai adivinhá-lo, e foi assim que ele
   * ficou sem conseguir copiar.
   */
  const emulador = useRef<{ getSelection(): string } | null>(null);
  // O que de fato vai para o emulador: o da aba, com o `config.json` atrás.
  const visual = resolverAparencia(aparencia, { fontSize });
  const aoFim = useRef(onFim);
  aoFim.current = onFim;
  // Por ref, e não por dependência: o efeito que cria o emulador NÃO pode
  // depender do tamanho da fonte. Remontar mataria o processo e apagaria o
  // buffer — a regressão que a spec 008 já viveu ao trocar de aba.
  const tamanhoDaFonte = useRef(visual.fontSize);
  tamanhoDaFonte.current = visual.fontSize;
  const visualAtual = useRef(visual);
  visualAtual.current = visual;
  const ativoAgora = useRef(ativo);
  ativoAgora.current = ativo;
  const temaAtual = useRef(tema);
  temaAtual.current = tema;
  /**
   * O comando de abertura, capturado UMA vez na montagem.
   *
   * Chegou a ser sincronizado a cada renderização, para o caso de a capacidade
   * chegar depois — e isso o re-armava depois de enviado, num laço que encheu
   * o terminal de prompts. A suíte pegou. Quem espera a capacidade agora é a
   * aba, que só monta este componente quando ela existe.
   */
  const comandoPendente = useRef(comandoInicial);
  const enviarRef = useRef<((msg: unknown) => void) | null>(null);
  // O que já chegou, para a heurística do prompt olhar o FIM. Dois mil
  // caracteres bastam: o prompt é a última coisa impressa.
  const recebido = useRef('');
  const reconectado = useRef(false);
  const emUso = useRef<{
    term: Terminal;
    fit: FitAddon;
    busca: SearchAddon;
    enviar: (msg: unknown) => void;
  } | null>(null);
  /** A barra de busca do terminal (T108). `null` = fechada. */
  const [procurando, setProcurando] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; selecao: string | null } | null>(null);
  const [semResultado, setSemResultado] = useState(false);

  // Ao voltar para a aba: refaz a medida e devolve o foco. Enquanto escondida a
  // caixa mede zero, então o tamanho guardado é o de antes de sumir.
  useEffect(() => {
    if (!ativo || emUso.current === null) return;
    const { term, fit, enviar } = emUso.current;
    try {
      fit.fit();
      enviar({ tipo: 'tamanho', cols: term.cols, rows: term.rows });
    } catch {
      // A aba pode ainda não ter medida no primeiro quadro.
    }
    term.focus();
  }, [ativo]);

  // Fonte nova nos terminais já abertos: muda a opção, remede e avisa o PTY —
  // o programa do outro lado pergunta o tamanho ao terminal, não ao navegador.
  useEffect(() => {
    const emUsoAgora = emUso.current;
    if (emUsoAgora === null) return;
    const { term, fit, enviar } = emUsoAgora;
    term.options.fontSize = visual.fontSize;
    // Cursor e scrollback também mudam ao vivo (T086): remontar o emulador
    // mataria o processo e apagaria o buffer, que é a regra constitucional.
    term.options.cursorBlink = visual.cursorBlink;
    term.options.cursorStyle = visual.cursorStyle;
    term.options.scrollback = visual.scrollback;
    try {
      fit.fit();
      enviar({ tipo: 'tamanho', cols: term.cols, rows: term.rows });
    } catch {
      // A aba pode estar escondida, e aí a medida dá zero.
    }
  }, [visual.fontSize, visual.cursorBlink, visual.cursorStyle, visual.scrollback]);

  // Trocar de tema com o terminal aberto: `options.theme` repinta o buffer que
  // já está na tela, sem remontar — e sem matar o processo.
  useEffect(() => {
    if (emUso.current === null) return;
    emUso.current.term.options.theme = coresDoTerminal(tema);
  }, [tema]);

  useEffect(() => {
    const alvo = caixa.current;
    if (alvo === null) return;

    const term = new Terminal({
      fontFamily: tokens.fontMono,
      fontSize: tamanhoDaFonte.current,
      cursorBlink: visualAtual.current.cursorBlink,
      cursorStyle: visualAtual.current.cursorStyle,
      // O buffer limita a memória quando um `cat` de arquivo grande despeja
      // tudo de uma vez; sem teto, a aba engoliria a máquina.
      scrollback: visualAtual.current.scrollback,
      theme: coresDoTerminal(temaAtual.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Busca dentro do terminal (T108) e links clicáveis (T109). Os dois vinham
    // de `Non-Goals` da spec 008 onde eu não tinha escrito desculpa nenhuma —
    // só listei.
    const busca = new SearchAddon();
    term.loadAddon(busca);
    term.loadAddon(
      new WebLinksAddon((_evento, uri) => {
        // `noopener` sempre: sem ele a página aberta ganha `window.opener` e
        // pode navegar a IDE para outro lugar. O terminal mostra saída de
        // programa, e endereço em saída de programa não é confiável.
        window.open(uri, '_blank', 'noopener,noreferrer');
      })
    );

    // Deixa alguns atalhos da IDE passarem em vez de virarem bytes no shell.
    // Devolver `false` faz o emulador NÃO tratar a tecla, e aí ela sobe até o
    // ouvinte do documento. Sem isto, `Ctrl+J` com o foco aqui só escrevia uma
    // nova linha — o painel nunca se escondia.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      // Copiar e colar (03/09/2026). O emulador desenha o texto ele mesmo, e a
      // seleção NÃO é seleção do DOM — então o `Ctrl+C` do navegador não tem o
      // que copiar. E o `Ctrl+C` do terminal é o SIGINT, que não se toma
      // emprestado. Ver `shared/terminal-copiar.ts`.
      const acao = acaoDoTerminal(e);
      if (acao === 'copiar') {
        e.preventDefault();
        const texto = textoParaCopiar(term.getSelection());
        if (texto !== null) void navigator.clipboard.writeText(texto);
        return false;
      }
      if (acao === 'colar') {
        e.preventDefault();
        void navigator.clipboard.readText().then(
          (t) => enviarRef.current?.({ tipo: 'dados', dados: t }),
          () => undefined
        );
        return false;
      }

      // `Ctrl+F` abre a busca em vez de virar byte no shell (T108). No shell,
      // `Ctrl+F` é "avançar um caractere" no modo emacs do readline — quase
      // ninguém usa, e quem usa tem a seta.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setProcurando((atual) => atual ?? '');
        return false;
      }
      return !escapaDoTerminal(formatarAtalho(e));
    });

    emulador.current = term;
    term.open(alvo);
    fit.fit();

    const url = new URL('/api/terminal', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);

    const enviar = (msg: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    // Guardado num ref para a barra poder mandar um snippet depois (spec 058):
    // o socket vive dentro deste efeito, e o botão está fora dele.
    enviarRef.current = enviar;

    ws.onopen = () => {
      enviar({
        tipo: 'abrir',
        id: sessaoId,
        opcoes: { connectionId, cols: term.cols, rows: term.rows },
      });
    };

    ws.onmessage = (evento) => {
      const msg = JSON.parse(String(evento.data)) as {
        tipo: string;
        dados?: string;
        mensagem?: string;
        exitCode?: number;
      };
      if (msg.tipo === 'reconectado') {
        // Reatou a sessão de antes do F5. O histórico vem logo em seguida, e a
        // tela precisa estar limpa para não duplicar o que já estava nela.
        term.reset();
        reconectado.current = true;
        // Comando de abertura não roda de novo: ele já rodou na sessão original.
        comandoPendente.current = null;
        return;
      }
      if (msg.tipo === 'dados') {
        term.write(msg.dados ?? '');
        // Espera o PROMPT, e não a primeira saída (spec 061).
        //
        // "A primeira saída é o prompt" era verdade no shell local e falso no
        // SSH, onde ela é o banner de login. O comando de abertura era enviado
        // no meio dele, o TTY o ecoava, e ele não executava — visto no servidor
        // real do usuário.
        recebido.current = (recebido.current + (msg.dados ?? '')).slice(-2_000);
        if (comandoPendente.current !== null && pareceProntoParaComando(recebido.current)) {
          const comando = comandoPendente.current;
          comandoPendente.current = null;
          enviar({ tipo: 'dados', dados: `${comando}\r` });
        }
      }
      else if (msg.tipo === 'erro') term.writeln(`\r\n\x1b[31m${msg.mensagem ?? 'Erro.'}\x1b[0m`);
      else if (msg.tipo === 'fim') {
        // A aba fica: ler o código de saída depois de o processo morrer é
        // metade da utilidade de um terminal.
        term.writeln(`\r\n\x1b[90m[processo encerrado com código ${msg.exitCode ?? 0}]\x1b[0m`);
        aoFim.current?.(msg.exitCode ?? 0);
      }
    };

    ws.onclose = () => term.writeln('\r\n\x1b[90m[sessão encerrada]\x1b[0m');

    term.onData((dados) => enviar({ tipo: 'dados', dados }));

    // O programa pergunta o tamanho ao TERMINAL, não ao navegador — por isso
    // cada mudança precisa descer até o PTY.
    const observador = new ResizeObserver(() => {
      try {
        fit.fit();
        enviar({ tipo: 'tamanho', cols: term.cols, rows: term.rows });
      } catch {
        // A aba pode estar escondida, e aí a medida dá zero.
      }
    });
    observador.observe(alvo);
    emUso.current = { term, fit, busca, enviar };
    // Foco na montagem, e não só no efeito de `ativo`: aquele roda antes de o
    // emulador existir, e sem isto abrir um terminal deixava o cursor piscando
    // sem receber tecla nenhuma — dava a impressão de terminal morto.
    if (ativoAgora.current) term.focus();

    return () => {
      observador.disconnect();
      emUso.current = null;
      // Esta limpeza roda quando o COMPONENTE é desmontado — ou seja, quando o
      // usuário fechou o terminal. Ela NÃO roda ao recarregar a página, e é
      // justamente essa diferença que o servidor usa para decidir entre matar
      // agora e esperar o navegador voltar.
      enviar({ tipo: 'fechar' });
      ws.close();
      term.dispose();
    };
  }, [connectionId, sessaoId]);

  // O snippet da barra: vai como DIGITAÇÃO, exatamente como o comando inicial —
  // é o que o usuário faria com as mãos, e não abre superfície nova.
  const ultimoEnviado = useRef<number>(-1);
  useEffect(() => {
    if (comandoParaEnviar === null || comandoParaEnviar.id === ultimoEnviado.current) return;
    ultimoEnviado.current = comandoParaEnviar.id;
    enviarRef.current?.({ tipo: 'dados', dados: `${comandoParaEnviar.texto}\r` });
  }, [comandoParaEnviar]);

  /** Procura, e diz quando não achou — silêncio pareceria travamento. */
  const procurar = (texto: string, paraTras = false): void => {
    const atual = emUso.current;
    if (atual === null || texto === '') {
      setSemResultado(false);
      return;
    }
    const achou = paraTras
      ? atual.busca.findPrevious(texto, { incremental: false })
      : atual.busca.findNext(texto, { incremental: false });
    setSemResultado(!achou);
  };

  const fecharBusca = (): void => {
    setProcurando(null);
    setSemResultado(false);
    emUso.current?.busca.clearDecorations();
    // O foco volta para o terminal: fechar a busca e ficar digitando no vazio
    // seria a pior saída possível.
    emUso.current?.term.focus();
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {procurando !== null && (
        <Box
          data-busca-do-terminal
          sx={{
            position: 'absolute', top: 4, right: 8, zIndex: 3,
            display: 'flex', alignItems: 'center', gap: 0.5,
            bgcolor: 'background.paper', border: 1, borderColor: 'divider',
            borderRadius: 0.5, px: 0.75, py: 0.4,
          }}
        >
          <Box
            component="input"
            autoFocus
            aria-label="Procurar no terminal"
            value={procurando}
            placeholder="procurar…"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setProcurando(e.target.value);
              procurar(e.target.value);
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Escape') fecharBusca();
              // `Shift+Enter` volta, como em todo campo de busca.
              if (e.key === 'Enter') procurar(procurando, e.shiftKey);
            }}
            sx={{
              border: 0, outline: 'none', bgcolor: 'transparent',
              color: semResultado ? 'error.main' : 'text.primary',
              fontFamily: tokens.fontMono, fontSize: 11, width: 150,
            }}
          />
          <BotaoDaBusca rotulo="Anterior" texto="‹" onClick={() => procurar(procurando, true)} />
          <BotaoDaBusca rotulo="Próximo" texto="›" onClick={() => procurar(procurando)} />
          <BotaoDaBusca rotulo="Fechar a busca" texto="×" onClick={fecharBusca} />
        </Box>
      )}
      <Box
        ref={caixa}
        data-terminal={connectionId ?? 'shell'}
        onContextMenu={(e: React.MouseEvent) => {
          e.preventDefault();
          const selecao = textoParaCopiar(emulador.current?.getSelection() ?? '');
          setMenu({ x: e.clientX, y: e.clientY, selecao });
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          bgcolor: tokens.bgEditor,
          px: 1,
          py: 0.5,
          '& .xterm': { height: '100%' },
        }}
      />

      {/* O menu de botão direito: copiar e colar sem precisar saber o atalho.
          `Ctrl+Shift+C` é o costume dos terminais de Linux há décadas, mas quem
          nunca o usou não o adivinha — e foi assim que ele ficou sem conseguir
          copiar. */}
      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu === null ? undefined : { top: menu.y, left: menu.x }}
      >
        <MenuItem
          disabled={menu?.selecao == null}
          onClick={() => {
            if (menu?.selecao != null) void navigator.clipboard.writeText(menu.selecao);
            setMenu(null);
          }}
        >
          Copiar (Ctrl+Shift+C)
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenu(null);
            void navigator.clipboard.readText().then(
              (t) => enviarRef.current?.({ tipo: 'dados', dados: t }),
              () => undefined
            );
          }}
        >
          Colar (Ctrl+Shift+V)
        </MenuItem>
      </Menu>
    </Box>
  );
}

function BotaoDaBusca({
  rotulo, texto, onClick,
}: {
  readonly rotulo: string;
  readonly texto: string;
  readonly onClick: () => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      sx={{
        border: 0, bgcolor: 'transparent', color: 'text.secondary',
        font: 'inherit', fontSize: 13, lineHeight: 1, px: 0.4, cursor: 'pointer',
        '&:hover': { color: 'text.primary' },
      }}
    >
      {texto}
    </Box>
  );
}
