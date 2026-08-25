// Para onde cada arquivo arrastado vai (spec 060).
//
// A parte que decide caminho é pura e testada; a que lê o disco do usuário
// depende do navegador e mora na tela. O corte é aqui porque **a conta de
// caminho é onde um upload erra sem avisar**: um separador a mais e a pasta
// `src` vira `//src`; um a menos e ela se funde com o nome do arquivo.
import { juntar } from './caminho';

/** Um arquivo escolhido para subir, com o caminho relativo à raiz do arraste. */
export interface ArquivoParaSubir {
  /** `src/main.ts` — relativo ao que foi arrastado. */
  readonly relativo: string;
  readonly bytes: number;
}

export interface DestinoDeUpload {
  readonly relativo: string;
  /** O caminho absoluto no servidor. */
  readonly destino: string;
}

/**
 * Onde cada arquivo cai.
 *
 * **Conciliação por sobreposição**: o que já existe do lado de lá é
 * sobrescrito, e a estrutura de pastas é reproduzida. É o que "upload" quer
 * dizer — você está empurrando a sua versão — e é a decisão D46, tomada por
 * mim porque a pergunta ficou sem resposta.
 */
export function destinosDe(
  pastaRemota: string,
  arquivos: readonly ArquivoParaSubir[]
): readonly DestinoDeUpload[] {
  return arquivos
    .filter((a) => a.relativo !== '')
    .map((a) => ({
      relativo: a.relativo,
      // `juntar` normaliza: `src//main.ts` e `./src/main.ts` chegam iguais do
      // outro lado, e é o que impede uma pasta `.` de nascer no servidor.
      destino: juntar(pastaRemota, ...a.relativo.split('/').filter((p) => p !== '')),
    }));
}

/**
 * Recusa o que não pode subir.
 *
 * Um nome com `..` viraria escrita fora da pasta escolhida — e o arraste é o
 * único caminho da IDE em que o nome vem de FORA, do disco do usuário, sem
 * passar por uma caixa de texto que alguém leu.
 */
export function seguros(
  destinos: readonly DestinoDeUpload[],
  pastaRemota: string
): { readonly ok: readonly DestinoDeUpload[]; readonly recusados: readonly string[] } {
  const ok: DestinoDeUpload[] = [];
  const recusados: string[] = [];
  const prefixo = pastaRemota === '/' ? '/' : `${pastaRemota}/`;

  for (const d of destinos) {
    if (d.destino === pastaRemota || !d.destino.startsWith(prefixo)) {
      recusados.push(d.relativo);
      continue;
    }
    ok.push(d);
  }
  return { ok, recusados };
}

/** Quanto vai subir, para a tela dizer antes de começar. */
export function totalDeBytes(arquivos: readonly ArquivoParaSubir[]): number {
  return arquivos.reduce((soma, a) => soma + a.bytes, 0);
}
