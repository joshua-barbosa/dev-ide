// O provedor de tema das webviews da extensão — e o que vale em TODAS elas.
//
// Existe como componente porque `useTemaDoEditor` é hook: ele precisa de um
// lugar que remonte quando o editor troca de tema.
//
// A área de transferência entra AQUI, e não em cada entrada, porque as cinco
// telas passam por este envoltório: assim nenhuma pode esquecer, e o Ctrl+C que
// o hospedeiro cancela é atendido no caderno, na grade e no formulário sem
// cinco fiações iguais. Ver `areaDeTransferencia.ts`.
import { useEffect, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { ligarAreaDeTransferencia } from './areaDeTransferencia';
import { chamarHost, pedirAoHost } from './ponte';
import { useTemaDoEditor } from './tema';
import { ligarWorkersDoMonaco } from './workersDoMonaco';

// Antes de qualquer editor existir: é na criação do primeiro que o Monaco pede
// um worker. Ver `workersDoMonaco.ts`.
ligarWorkersDoMonaco();

/** A área do EDITOR, quando o navegador nega a dele. Ver `ponteDoHost.ts`. */
const RESERVA = {
  ler: () => chamarHost<string>('lerAreaDeTransferencia'),
  escrever: (texto: string) => chamarHost<void>('escreverNaAreaDeTransferencia', { texto }),
};

export function ComTemaDoEditor({ children }: { readonly children: ReactNode }) {
  useEffect(
    () =>
      ligarAreaDeTransferencia(document, RESERVA, (erro) => {
        pedirAoHost({
          tipo: 'erro',
          mensagem: erro instanceof Error ? erro.message : String(erro),
        });
      }),
    []
  );

  return (
    <ThemeProvider theme={useTemaDoEditor()}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
