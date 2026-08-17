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
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { tokens } from '../theme';

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
}

export function TerminalHost({ connectionId = null, ativo = true, onFim }: TerminalHostProps) {
  const caixa = useRef<HTMLDivElement>(null);
  const aoFim = useRef(onFim);
  aoFim.current = onFim;
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

  useEffect(() => {
    const alvo = caixa.current;
    if (alvo === null) return;

    const term = new Terminal({
      fontFamily: tokens.fontMono,
      fontSize: 13,
      cursorBlink: true,
      // O buffer limita a memória quando um `cat` de arquivo grande despeja
      // tudo de uma vez; sem teto, a aba engoliria a máquina.
      scrollback: 5_000,
      theme: { background: tokens.bgEditor },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(alvo);
    fit.fit();

    const url = new URL('/api/terminal', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);

    const enviar = (msg: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.onopen = () => {
      enviar({
        tipo: 'abrir',
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
      if (msg.tipo === 'dados') term.write(msg.dados ?? '');
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

    return () => {
      observador.disconnect();
      emUso.current = null;
      ws.close();
      term.dispose();
    };
  }, [connectionId]);

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
