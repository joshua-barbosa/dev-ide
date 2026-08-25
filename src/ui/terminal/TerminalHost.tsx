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
import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { tokens } from '../theme';
import { escapaDoTerminal, formatarAtalho } from '../../shared/commands';
import { TEMAS, type NomeDoTema } from '../../shared/temas';

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
  const p = TEMAS[nome];
  return { background: p.bgEditor, foreground: p.fg, cursor: p.accent, ...p.ansi };
}

export function TerminalHost({
  connectionId = null, ativo = true, onFim, fontSize = 13, tema = 'escuro',
  comandoInicial = null, comandoParaEnviar = null, sessaoId,
}: TerminalHostProps) {
  const caixa = useRef<HTMLDivElement>(null);
  const aoFim = useRef(onFim);
  aoFim.current = onFim;
  // Por ref, e não por dependência: o efeito que cria o emulador NÃO pode
  // depender do tamanho da fonte. Remontar mataria o processo e apagaria o
  // buffer — a regressão que a spec 008 já viveu ao trocar de aba.
  const tamanhoDaFonte = useRef(fontSize);
  tamanhoDaFonte.current = fontSize;
  const ativoAgora = useRef(ativo);
  ativoAgora.current = ativo;
  const temaAtual = useRef(tema);
  temaAtual.current = tema;
  const comandoPendente = useRef(comandoInicial);
  const enviarRef = useRef<((msg: unknown) => void) | null>(null);
  const reconectado = useRef(false);
  const emUso = useRef<{
    term: Terminal;
    fit: FitAddon;
    enviar: (msg: unknown) => void;
  } | null>(null);

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
    term.options.fontSize = fontSize;
    try {
      fit.fit();
      enviar({ tipo: 'tamanho', cols: term.cols, rows: term.rows });
    } catch {
      // A aba pode estar escondida, e aí a medida dá zero.
    }
  }, [fontSize]);

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
      cursorBlink: true,
      // O buffer limita a memória quando um `cat` de arquivo grande despeja
      // tudo de uma vez; sem teto, a aba engoliria a máquina.
      scrollback: 5_000,
      theme: coresDoTerminal(temaAtual.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    // Deixa alguns atalhos da IDE passarem em vez de virarem bytes no shell.
    // Devolver `false` faz o emulador NÃO tratar a tecla, e aí ela sobe até o
    // ouvinte do documento. Sem isto, `Ctrl+J` com o foco aqui só escrevia uma
    // nova linha — o painel nunca se escondia.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      return !escapaDoTerminal(formatarAtalho(e));
    });

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
        // A primeira saída é o prompt: o shell carregou o perfil e está pronto
        // para receber. Enviar antes disso faria a linha se perder no meio da
        // inicialização. É heurística, e é a mesma que uma pessoa usa — ela
        // também espera o `$` aparecer.
        if (comandoPendente.current !== null) {
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
    emUso.current = { term, fit, enviar };
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

  return (
    <Box
      ref={caixa}
      data-terminal={connectionId ?? 'shell'}
      sx={{
        flex: 1,
        minHeight: 0,
        bgcolor: tokens.bgEditor,
        px: 1,
        py: 0.5,
        '& .xterm': { height: '100%' },
      }}
    />
  );
}
