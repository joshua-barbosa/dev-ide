// Uma aba de terminal: a barra em cima, o emulador embaixo (spec 058).
//
// O `TerminalHost` continua sendo só o emulador — ele guarda o socket e o
// buffer, e não deve saber de snippet nenhum. O que junta os dois é esta casca.
import { useState } from 'react';
import Box from '@mui/material/Box';
import { TerminalHost } from './TerminalHost';
import { BarraDoTerminal } from './BarraDoTerminal';
import { TERMINAL_LOCAL } from '../../shared/terminal/chaves';
import type { NomeDoTema } from '../../shared/temas';
import type { Tab } from '../../shared/tabs';
import type { AparenciaDoTerminal } from '../../shared/terminal/aparencia';

export interface AbaDeTerminalProps {
  readonly aba: Tab;
  /**
   * O que digitar quando o prompt aparecer — vem da sessão (spec 061).
   *
   * `null` significa "ainda não sei": a capacidade vem do `connect`, e montar o
   * emulador antes dela faria o terminal abrir no home e nunca mais corrigir.
   */
  readonly comandoDeAbertura: string | null;
  readonly ativo: boolean;
  readonly fontSize: number;
  readonly tema: NomeDoTema;
  onDuplicar(aba: Tab): void;
  pedir(o: { titulo: string; placeholder: string; valorInicial?: string }): Promise<string | null>;
  confirmar(o: { mensagem: string; rotuloConfirmar?: string; destrutivo?: boolean }): Promise<boolean>;
  onErro(erro: unknown): void;
  /** Abre um arquivo no editor, para o `{}` da barra (T085). */
  abrirArquivo(caminho: string): Promise<void>;
}

export function AbaDeTerminal({
  aba, comandoDeAbertura, ativo, fontSize, tema, onDuplicar, pedir, confirmar, onErro,
  abrirArquivo,
}: AbaDeTerminalProps) {
  const conexaoId = typeof aba.meta.connectionId === 'string' ? aba.meta.connectionId : null;
  const [comando, setComando] = useState<{ id: number; texto: string } | null>(null);
  // `sessaoId` muda para forçar um socket novo: é o `Reconnect` da barra.
  const [sessao, setSessao] = useState(0);
  // A aparência DESTE terminal (T086). Nasce vazia: herda tudo do
  // `config.json`, e some no F5 — é marcação, não preferência.
  const [aparencia, setAparencia] = useState<AparenciaDoTerminal>({});

  return (
    <>
      <BarraDoTerminal
        // O terminal geral não pertence a conexão nenhuma, e ainda assim guarda
        // snippets — os comandos que ele repete na própria máquina.
        conexaoId={conexaoId ?? TERMINAL_LOCAL}
        onEnviar={(texto) => setComando({ id: Date.now(), texto })}
        onReconectar={() => setSessao((n) => n + 1)}
        onDuplicar={() => onDuplicar(aba)}
        pedir={pedir}
        confirmar={confirmar}
        onErro={onErro}
        abrirArquivo={abrirArquivo}
        aparencia={aparencia}
        onAparencia={setAparencia}
      />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {comandoDeAbertura === null ? (
          <Box sx={{ p: 1.5, fontSize: 12, color: 'text.secondary' }}>conectando…</Box>
        ) : (
        <TerminalHost
          ativo={ativo}
          fontSize={fontSize}
          tema={tema}
          connectionId={conexaoId}
          comandoInicial={comandoDeAbertura === '' ? null : comandoDeAbertura}
          comandoParaEnviar={comando}
          sessaoId={`${aba.id}#${sessao}`}
          aparencia={aparencia}
        />
        )}
      </Box>
    </>
  );
}
