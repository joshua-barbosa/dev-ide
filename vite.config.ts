import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A fonte da interface fica em `src/ui/` e o artefato em `dist/ui/`, seguindo a
 * convenção do projeto (fonte em src, saída em dist, já ignorada pelo git).
 *
 * No desenvolvimento o Vite serve a interface e repassa `/api` para o Express.
 * Ele escuta em localhost, então a guarda de Host/Origin do servidor aceita a
 * origem — a proteção continua valendo sem exceção nenhuma.
 */
export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4321',
    },
  },
});
