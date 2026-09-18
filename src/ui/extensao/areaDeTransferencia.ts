// Ctrl+C, Ctrl+X e Ctrl+V dentro da webview — porque o hospedeiro não entrega.
//
// Ele relatou, nos dois editores: *"o CTRL + C e CTRL + V e CTRL + X não está
// funcionando, principalmente nos .sqlbook, eu preciso apertar botão direito
// para copiar, colar e recortar, é extremamente frustrante"*.
//
// **A causa não é nossa.** A moldura da webview do VS Code (o mesmo código roda
// no Cursor) cancela as três teclas quando está no Electron:
//
//     } else if (isCopyPasteOrCut(e)) {
//       if (onElectron) { e.preventDefault(); }   // pre/index.html
//
// Ela conta que o editor faça o serviço depois — mas o comando dele age no
// campo de texto do WORKBENCH, e o foco está aqui dentro. A tecla morre no
// meio. O botão direito funciona porque quem copia ali é o menu nativo do
// Electron, abaixo da página.
//
// **Só agimos quando a tecla chega CANCELADA.** É o que separa um hospedeiro do
// outro sem precisar farejar qual é: no navegador (e no `vscode.dev`) a moldura
// deixa passar, o `defaultPrevented` é falso e nós ficamos fora do caminho —
// senão colaríamos duas vezes.
//
// O gesto é REENCENADO como evento de área de transferência em cima do foco, em
// vez de reimplementado: assim quem já sabe copiar continua sendo quem copia —
// o Monaco leva junto o multi-cursor e o "copiar a linha inteira sem seleção",
// e a grade leva o formato dela. Só quando ninguém atende é que fazemos na mão.
import { gestoDaArea, type GestoDaArea } from '../../shared/editor/gesto-da-area';

/** Lê e escreve pelo editor, quando o navegador não deixa. Ver `ponte.ts`. */
export interface ReservaDoHost {
  ler(): Promise<string>;
  escrever(texto: string): Promise<void>;
}

function ehCampoDeTexto(alvo: Element | null): alvo is HTMLInputElement | HTMLTextAreaElement {
  return alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement;
}

/** O texto selecionado quando ninguém atendeu o evento. */
function selecaoDe(doc: Document, alvo: Element | null): string {
  if (ehCampoDeTexto(alvo)) {
    return alvo.value.slice(alvo.selectionStart ?? 0, alvo.selectionEnd ?? 0);
  }
  return doc.getSelection()?.toString() ?? '';
}

/**
 * Encena o evento em cima do foco e devolve o texto, ou `null` se ninguém
 * atendeu — `dispatchEvent` retorna falso quando o ouvinte cancela, e é assim
 * que Monaco e grade dizem "esse copiar é meu".
 */
function encenar(alvo: Element, tipo: 'copy' | 'cut' | 'paste', texto?: string): string | null {
  const dados = new DataTransfer();
  if (texto !== undefined) dados.setData('text/plain', texto);
  const atendido = !alvo.dispatchEvent(
    new ClipboardEvent(tipo, { clipboardData: dados, bubbles: true, cancelable: true })
  );
  return atendido ? dados.getData('text/plain') : null;
}

async function escrever(texto: string, reserva: ReservaDoHost | null): Promise<void> {
  if (texto === '') return;
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Permissão negada ou área indisponível: o editor sempre consegue.
    await reserva?.escrever(texto);
  }
}

async function ler(reserva: ReservaDoHost | null): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return reserva === null ? '' : await reserva.ler();
  }
}

async function executar(
  gesto: GestoDaArea,
  doc: Document,
  reserva: ReservaDoHost | null
): Promise<void> {
  const alvo = doc.activeElement ?? doc.body;

  if (gesto === 'colar') {
    const texto = await ler(reserva);
    if (texto === '') return;
    // Quem atende o `paste` insere sozinho; quem não atende recebe na mão.
    if (encenar(alvo, 'paste', texto) === null) doc.execCommand('insertText', false, texto);
    return;
  }

  const tipo = gesto === 'recortar' ? 'cut' : 'copy';
  const atendido = encenar(alvo, tipo);
  const texto = atendido ?? selecaoDe(doc, alvo);
  await escrever(texto, reserva);
  // Quem atendeu o `cut` já tirou o texto; quem não atendeu, tiramos aqui.
  if (gesto === 'recortar' && atendido === null && texto !== '') {
    doc.execCommand('insertText', false, '');
  }
}

/**
 * Liga o atendimento. Devolve como desligar (o React desmonta em teste).
 *
 * `aoFalhar` existe porque isto roda dentro de um ouvinte de tecla: uma promessa
 * rejeitada aqui sumiria sem deixar rastro, e o sintoma seria de novo "a tecla
 * não faz nada" — exatamente o que estamos consertando.
 */
export function ligarAreaDeTransferencia(
  doc: Document = document,
  reserva: ReservaDoHost | null = null,
  aoFalhar: (erro: unknown) => void = () => undefined
): () => void {
  const aoTeclar = (e: KeyboardEvent): void => {
    if (!e.defaultPrevented) return;
    const gesto = gestoDaArea(e);
    if (gesto === null) return;
    executar(gesto, doc, reserva).catch(aoFalhar);
  };
  doc.addEventListener('keydown', aoTeclar);
  return () => doc.removeEventListener('keydown', aoTeclar);
}
