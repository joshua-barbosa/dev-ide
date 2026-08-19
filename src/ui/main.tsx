import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const raiz = document.getElementById('root');
if (raiz === null) throw new Error('Elemento #root não encontrado no index.html.');

// O `ThemeProvider` mora DENTRO do `App` desde a spec 017: o tema vem das
// preferências, que o `App` carrega. Deixá-lo aqui exigiria um segundo gancho de
// preferências só para escolher a cor — e dois carregamentos do mesmo arquivo.
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>
);
