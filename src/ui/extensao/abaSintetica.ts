// Uma `Tab` da IDE montada à mão, para os painéis dela rodarem aqui.
//
// Os `*Host` da IDE recebem uma `Tab` e leem só o `meta` dela — o resto
// (título, grupo, sujeira) é da barra de abas, que quem desenha aqui é o VS
// Code. Sintetizar a `Tab` é o que permite usar os painéis ORIGINAIS em vez de
// escrever cópias que envelhecem.
import type { Tab } from '../../shared/tabs';

export function abaSintetica(
  tipo: string,
  titulo: string,
  meta: Readonly<Record<string, unknown>>
): Tab {
  return { id: `vscode:${tipo}`, type: tipo, title: titulo, dirty: false, meta, grupo: 0 };
}
