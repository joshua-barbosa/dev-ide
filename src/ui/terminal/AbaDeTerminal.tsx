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

export interface AbaDeTerminalProps {
  readonly aba: Tab;
  readonly ativo: boolean;
  readonly fontSize: number;
  readonly tema: NomeDoTema;
  onDuplicar(aba: Tab): void;
  pedir(o: { titulo: string; placeholder: string; valorInicial?: string }): Promise<string | null>;
  confirmar(o: { mensagem: string; rotuloConfirmar?: string; destrutivo?: boolean }): Promise<boolean>;
  onErro(erro: unknown): void;
}

export function AbaDeTerminal({
  aba, ativo, fontSize, tema, onDuplicar, pedir, confirmar, onErro,
}: AbaDeTerminalProps) {
  const conexaoId = typeof aba.meta.connectionId === 'string' ? aba.meta.connectionId : null;
  const [comando, setComando] = useState<{ id: number; texto: string } | null>(null);
  // `sessaoId` muda para forçar um socket novo: é o `Reconnect` da barra.
  const [sessao, setSessao] = useState(0);

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
      />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <TerminalHost
          ativo={ativo}
          fontSize={fontSize}
          tema={tema}
          connectionId={conexaoId}
          comandoParaEnviar={comando}
          sessaoId={`${aba.id}#${sessao}`}
        />
      </Box>
    </>
  );
}
