import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Os pacotes das webviews da extensão (spec 093).
 *
 * Separado do `vite.config.ts` da IDE de propósito: aquele carrega o Monaco, que
 * são 5,5 MB e não têm nada a ver com um painel de conexões.
 *
 * São DOIS pacotes, escolhidos por `BRAYTECH_ALVO`, porque o formato IIFE aceita
 * uma entrada por build. A divisão também é útil: a barra lateral não carrega o
 * formulário para desenhar a árvore, nem a aba do formulário carrega a árvore
 * para cadastrar uma conexão.
 */
const alvos = {
  painel: { entrada: 'extensao/painel.tsx', nome: 'BraytechPainel', arquivo: 'painel.js' },
  formulario: {
    entrada: 'extensao/formulario.tsx',
    nome: 'BraytechFormulario',
    arquivo: 'formulario.js',
  },
} as const;

const alvo = alvos[(process.env.BRAYTECH_ALVO ?? 'painel') as keyof typeof alvos];

export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '../../extensao/webview',
    // Só o primeiro build limpa: o segundo apagaria o pacote do primeiro.
    emptyOutDir: alvo.arquivo === 'painel.js',
    lib: { entry: alvo.entrada, formats: ['iife'], name: alvo.nome, fileName: () => alvo.arquivo },
  },
});
