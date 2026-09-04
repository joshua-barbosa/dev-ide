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
      // `^/api/` como EXPRESSÃO, e não `/api` como prefixo.
      //
      // Prefixo casava também `/api.ts` — que é o módulo `src/ui/api.ts` sendo
      // servido pelo Vite. O pedido ia para o Express, voltava 404, o módulo
      // nunca carregava e o `npm run dev` abria uma TELA BRANCA. Nada no
      // console dizia isso com todas as letras; só o 404 de um arquivo que
      // ninguém esperava ver na rede.
      // O alvo sai por variável para dar para apontar o `npm run dev` a um
      // motor de teste, sem editar este arquivo e sem risco de commitar a
      // edição por engano.
      '^/api/': process.env.BRAYTECH_MOTOR ?? 'http://127.0.0.1:4321',
    },
  },
});
