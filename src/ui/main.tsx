import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from './Icon';

const raiz = document.getElementById('root');
if (raiz === null) throw new Error('Elemento #root não encontrado no index.html.');

createRoot(raiz).render(
  <StrictMode>
    <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Icon name="database" size={18} /> dev-ide
    </p>
  </StrictMode>
);
