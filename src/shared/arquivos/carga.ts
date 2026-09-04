// A carga de um arquivo que atravessa a fronteira webview ↔ host.
//
// Entre a webview do editor e o processo da extensão só passa JSON, e JSON não
// tem bytes: um `Uint8Array` posto num `postMessage` chega do outro lado como
// `{"0":137,"1":80,…}`. O arquivo salvaria, o tamanho até pareceria plausível,
// e só ao ABRIR é que se veria que não é um PNG. Por isso a carga é base64 —
// feia, 33% maior, e correta.
//
// Não usa `Buffer`: este arquivo roda também dentro do navegador. `btoa` e
// `atob` existem nos dois lados.

/** Quantos bytes por vez viram texto. */
const PEDACO = 0x8000;

/**
 * Bytes (ou texto) → base64.
 *
 * O laço em pedaços não é preciosismo: `String.fromCharCode(...bytes)` com um
 * arquivo de alguns megabytes estoura a pilha de chamadas do JavaScript.
 */
export function paraCarga(conteudo: Uint8Array | string): string {
  const bytes = typeof conteudo === 'string' ? new TextEncoder().encode(conteudo) : conteudo;
  if (bytes.length === 0) return '';

  let binario = '';
  for (let i = 0; i < bytes.length; i += PEDACO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + PEDACO));
  }
  return btoa(binario);
}

/** base64 → bytes. O par exato de `paraCarga`. */
export function daCarga(carga: string): Uint8Array {
  if (carga === '') return new Uint8Array();
  const binario = atob(carga);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/**
 * O último pedaço de um caminho, para sugerir o nome ao salvar.
 *
 * Corta nas DUAS barras porque o caminho pode vir de um servidor remoto POSIX
 * ou de um Windows, e quem salva pode estar no outro. E devolve só o nome —
 * um `..` vindo de fora não pode virar caminho na máquina de quem salva.
 */
export function nomeDeArquivo(caminho: string): string {
  const ultimo = caminho.split(/[/\\]/).filter((p) => p !== '' && p !== '.' && p !== '..').pop();
  return ultimo ?? 'arquivo';
}
