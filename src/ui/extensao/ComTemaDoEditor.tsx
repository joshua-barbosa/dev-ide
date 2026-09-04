// O provedor de tema das webviews da extensão.
//
// Existe como componente porque `useTemaDoEditor` é hook: ele precisa de um
// lugar que remonte quando o editor troca de tema.
import type { ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { useTemaDoEditor } from './tema';

export function ComTemaDoEditor({ children }: { readonly children: ReactNode }) {
  return (
    <ThemeProvider theme={useTemaDoEditor()}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
