// O nome que uma cópia recebe (T043, spec 073).
//
// `utils.ts` vira `utils copy.ts`, e a segunda vira `utils copy 2.ts` — a
// convenção do VS Code, escolhida por ser a que o usuário já reconhece.
//
// Mora em `shared` e recebe o "já existe?" como função porque a regra é de
// NOME, não de disco: assim ela se testa sem criar arquivo nenhum, e o mesmo
// código serve para o disco local e, um dia, para o servidor remoto.

/** Onde termina o nome e começa a extensão. `.gitignore` não tem extensão. */
function partir(nome: string): { readonly base: string; readonly ext: string } {
  const ponto = nome.lastIndexOf('.');
  // Ponto na primeira posição é arquivo oculto, não extensão: `.env` inteiro é
  // o nome, e `env copy` perderia o ponto que o define.
  if (ponto <= 0) return { base: nome, ext: '' };
  return { base: nome.slice(0, ponto), ext: nome.slice(ponto) };
}

/**
 * O primeiro nome livre para uma cópia de `nome`.
 *
 * O laço não tem teto: com mil cópias do mesmo arquivo, a milésima primeira
 * ainda tem de sair. Ele termina sempre, porque cada volta tenta um número
 * diferente.
 */
export function nomeDeCopia(nome: string, existe: (candidato: string) => boolean): string {
  const { base, ext } = partir(nome);
  const primeiro = `${base} copy${ext}`;
  if (!existe(primeiro)) return primeiro;
  for (let n = 2; ; n += 1) {
    const candidato = `${base} copy ${n}${ext}`;
    if (!existe(candidato)) return candidato;
  }
}

/**
 * O caminho de um arquivo depois que ele — ou uma pasta acima dele — mudou de
 * nome (T043).
 *
 * Devolve `null` quando o arquivo não foi afetado. Existe separado porque a
 * comparação erra de dois jeitos silenciosos: `startsWith(de)` sozinho casaria
 * `src2/a.ts` ao renomear `src`, e esquecer o caso `caminho === de` deixaria de
 * fora justamente o arquivo renomeado.
 */
export function caminhoRenomeado(caminho: string, de: string, para: string): string | null {
  if (caminho === de) return para;
  if (caminho.startsWith(`${de}/`)) return para + caminho.slice(de.length);
  return null;
}
