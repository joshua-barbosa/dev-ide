// Qual gesto de área de transferência uma tecla é — e só isso.
//
// Existe separado porque quem decide é a webview da extensão, onde o gesto
// precisa ser ATENDIDO POR NÓS: o hospedeiro cancela Ctrl+C/X/V antes de a
// página vê-los (ver `src/ui/extensao/areaDeTransferencia.ts`). A parte que
// erra é esta — reconhecer a tecla sem confundir `AltGr` com `Ctrl` —, e ela
// não precisa de navegador para ser conferida.
import { formatarAtalho, type TeclaPressionada } from '../commands';

export type GestoDaArea = 'copiar' | 'recortar' | 'colar';

/**
 * As teclas, incluindo as antigas do X11 (`Shift+Insert` e companhia).
 *
 * `Shift+Insert` está aqui porque o próprio VS Code o cancela junto com as
 * outras três — deixá-lo de fora faria a tecla morrer sem substituto.
 */
const GESTOS: Readonly<Record<string, GestoDaArea>> = {
  'Ctrl+C': 'copiar',
  'Ctrl+X': 'recortar',
  'Ctrl+V': 'colar',
  'Ctrl+Insert': 'copiar',
  'Shift+Insert': 'colar',
  'Shift+Delete': 'recortar',
};

export function gestoDaArea(e: TeclaPressionada): GestoDaArea | null {
  return GESTOS[formatarAtalho(e)] ?? null;
}
