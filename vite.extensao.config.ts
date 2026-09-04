import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * O pacote da webview da extensão (spec 093).
 *
 * Separado do `vite.config.ts` da IDE de propósito: aquele carrega o Monaco, que
 * são 5,5 MB e não têm nada a ver com um painel de conexões.
 */
export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '../../extensao/webview',
    emptyOutDir: true,
    lib: { entry: 'extensao/painel.tsx', formats: ['iife'], name: 'BraytechPainel', fileName: () => 'painel.js' },
  },
});
