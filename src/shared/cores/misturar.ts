// Mistura duas cores, para tirar uma borda discreta de um tema qualquer.
//
// Existe por um defeito visível: a borda dos blocos do caderno vinha de
// `--vscode-panel-border`, e no Dracula essa variável é `#BD93F9` — um roxo
// forte. É a cor certa para o papel dela, que é UMA linha separando o painel do
// editor; usada em volta de cada bloco, vira uma tela de caixas berrantes.
//
// A saída não é escolher outra variável e torcer: tema nenhum é obrigado a
// declarar `editorWidget.border`, e o que sobra varia. Uma borda é o primeiro
// plano diluído no fundo — e isso se calcula a partir das cores que o tema já
// deu, sem depender de ele ter pensado no caso.

/** Uma cor como `#rgb`, `#rrggbb` ou `rgb()/rgba()`. Devolve `null` se não der. */
export function lerCor(valor: string): readonly [number, number, number] | null {
  const t = valor.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (hex !== null) {
    const c = hex[1] as string;
    const largo = c.length === 3 ? c.split('').map((d) => d + d).join('') : c;
    return [
      Number.parseInt(largo.slice(0, 2), 16),
      Number.parseInt(largo.slice(2, 4), 16),
      Number.parseInt(largo.slice(4, 6), 16),
    ];
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t);
  if (rgb !== null) {
    const n = (i: number): number => Math.round(Number(rgb[i]));
    const [r, g, b] = [n(1), n(2), n(3)];
    if ([r, g, b].some((v) => !Number.isFinite(v))) return null;
    return [r, g, b];
  }

  return null;
}

/**
 * `frente` diluída em `fundo`, com `peso` de 0 a 1.
 *
 * Devolve `null` quando alguma das duas não for legível — quem chama decide o
 * que fazer, e inventar uma cor aqui seria pior que manter a de antes.
 */
export function misturar(frente: string, fundo: string, peso: number): string | null {
  const a = lerCor(frente);
  const b = lerCor(fundo);
  if (a === null || b === null) return null;
  const p = Math.min(1, Math.max(0, peso));
  const canal = (i: number): number =>
    Math.round((a[i] as number) * p + (b[i] as number) * (1 - p));
  return `rgb(${canal(0)}, ${canal(1)}, ${canal(2)})`;
}
