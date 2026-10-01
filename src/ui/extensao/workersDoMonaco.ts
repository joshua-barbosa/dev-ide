// Os workers do Monaco dentro da webview da extensão.
//
// Na IDE o Vite monta o endereço de cada worker a partir de `import.meta.url`.
// Os pacotes da extensão são IIFE, onde isso não existe: o endereço saía
// inválido e cada tecla numa célula JavaScript do notebook jogava "Invalid
// base URL" no console — e o autocomplete de JS/TS não existia.
//
// Mesmo com o endereço certo, a webview não abre um worker direto da origem
// dos recursos (é outra origem). Então o worker nasce de um BLOB da própria
// página, que faz `importScripts` do arquivo do pacote — a CSP libera os dois
// (`politica-da-webview.ts`).
declare const BRAYTECH: { readonly recursos?: string } | undefined;

/** O rótulo que o Monaco pede → o arquivo em `webview/assets/`. */
function arquivoDoWorker(rotulo: string): string {
  if (rotulo === 'typescript' || rotulo === 'javascript') return 'ts.worker.js';
  if (rotulo === 'json') return 'json.worker.js';
  if (rotulo === 'css' || rotulo === 'scss' || rotulo === 'less') return 'css.worker.js';
  if (rotulo === 'html' || rotulo === 'handlebars' || rotulo === 'razor') return 'html.worker.js';
  return 'editor.worker.js';
}

/** A pasta dos workers: a que a extensão informa, ou a do próprio script. */
function pastaDosWorkers(): string {
  const informada = typeof BRAYTECH === 'undefined' ? undefined : BRAYTECH.recursos;
  if (informada !== undefined) return informada;
  const script = Array.from(document.scripts).map((s) => s.src).find((s) => /\.js(\?|$)/.test(s));
  return new URL('assets/', script ?? document.baseURI).href;
}

export function ligarWorkersDoMonaco(): void {
  const alvo = self as unknown as { MonacoEnvironment?: unknown };
  alvo.MonacoEnvironment = {
    getWorker(_id: string, rotulo: string): Worker {
      const url = new URL(arquivoDoWorker(rotulo), pastaDosWorkers()).href;
      const blob = new Blob([`importScripts(${JSON.stringify(url)});`], { type: 'text/javascript' });
      return new Worker(URL.createObjectURL(blob), { name: rotulo });
    },
  };
}
