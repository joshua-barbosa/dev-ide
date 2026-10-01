// A política de segurança (CSP) das webviews da extensão.
//
// Função própria, e não texto solto no HTML, porque a guarda do navegador
// (`conferir-notebook-extensao.mjs`) aplica a MESMA política na página dela:
// um worker bloqueado pela CSP só aparece no Cursor, e a guarda tem de vê-lo.
//
// `worker-src blob:` e `script-src <origem>`: os workers do Monaco (o
// autocomplete de JS/TS, o JSON) nascem de um blob que faz `importScripts` do
// arquivo do pacote. Worker direto da origem dos recursos não abre — ela não é
// a mesma da página.
//
// Sem `import`: é copiado para a extensão (`copiar-compartilhado.mjs`).

export function politicaDaWebview(origem: string, script: string): string {
  return [
    "default-src 'none'",
    `img-src ${origem} data:`,
    `style-src ${origem} 'unsafe-inline'`,
    `font-src ${origem} data:`,
    `script-src ${script} ${origem}`,
    'worker-src blob:',
  ].join('; ') + ';';
}
