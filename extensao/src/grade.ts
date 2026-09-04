// A grade de resultados, numa webview.
//
// Aqui, sim, precisa de webview: o VS Code não tem tabela nativa. É a parte que
// seria reescrita de verdade numa migração — mas note o tamanho dela comparado
// com o motor, que não mudou uma linha.
//
// A webview NÃO fala com o motor. Ela recebe o resultado já pronto por
// `postMessage` e só desenha: assim não há porta, token nem CSP de rede para
// acertar, e nada do que ela recebe pode virar pedido ao banco.

import * as vscode from 'vscode';

interface ColunaDoMotor {
  readonly name: string;
}

export interface ResultadoDoMotor {
  readonly columns: readonly ColunaDoMotor[];
  readonly rows: readonly (readonly unknown[])[];
  readonly rowCount: number;
  readonly durationMs: number;
  readonly truncated: boolean;
  readonly message?: string;
}

let painel: vscode.WebviewPanel | null = null;

export function mostrarResultado(resultado: ResultadoDoMotor, titulo: string): void {
  if (painel === null) {
    painel = vscode.window.createWebviewPanel(
      'braytech.resultado',
      'Resultado',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false }
    );
    painel.onDidDispose(() => {
      painel = null;
    });
  }
  painel.title = `Resultado — ${titulo}`;
  painel.webview.html = desenhar(resultado);
  painel.reveal(vscode.ViewColumn.Beside, true);
}

/**
 * O HTML da grade.
 *
 * Sem script (`enableScripts: false`): uma tabela não precisa de JavaScript, e
 * uma webview sem script não tem por onde um valor vindo do banco virar código.
 * Escapar continua obrigatório de todo jeito — o dado é dele, e um `<script>`
 * dentro de uma célula é um dado perfeitamente legítimo.
 */
function desenhar(r: ResultadoDoMotor): string {
  const cabecalho = r.columns.map((c) => `<th>${escapar(c.name)}</th>`).join('');
  const corpo = r.rows
    .map((linha) => `<tr>${linha.map((v) => `<td>${celula(v)}</td>`).join('')}</tr>`)
    .join('');

  const resumo = [
    `${r.rowCount} linha${r.rowCount === 1 ? '' : 's'}`,
    `${r.durationMs} ms`,
    r.truncated ? 'cortado pelo limite' : null,
    r.message ?? null,
  ]
    .filter((p): p is string => p !== null)
    .join(' · ');

  return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font: 12px var(--vscode-editor-font-family, monospace); margin: 0;
         color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .resumo { padding: 6px 10px; color: var(--vscode-descriptionForeground);
            border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0;
            background: var(--vscode-editor-background); }
  .rolagem { overflow: auto; }
  table { border-collapse: collapse; white-space: nowrap; }
  th, td { padding: 3px 10px; border-right: 1px solid var(--vscode-panel-border);
           border-bottom: 1px solid var(--vscode-panel-border); text-align: left;
           max-width: 40ch; overflow: hidden; text-overflow: ellipsis; }
  th { position: sticky; top: 0; background: var(--vscode-editorWidget-background); font-weight: 600; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  .nulo { color: var(--vscode-descriptionForeground); font-style: italic; }
</style>
<div class="resumo">${escapar(resumo)}</div>
<div class="rolagem"><table><thead><tr>${cabecalho}</tr></thead><tbody>${corpo}</tbody></table></div>`;
}

/** `NULL` é a ausência de valor, e mostrar `""` no lugar seria uma mentira. */
function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return '<span class="nulo">NULL</span>';
  return escapar(typeof valor === 'object' ? JSON.stringify(valor) : String(valor));
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
