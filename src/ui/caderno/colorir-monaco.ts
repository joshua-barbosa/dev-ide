// A parte de `colorir.ts` que TOCA o Monaco (P7, spec 101).
//
// Separada para que o `useColorido` — usado pelo visor de célula e pelo campo
// colorido, telas que não têm editor nenhum — possa ser importado sem arrastar
// os 5 MB do Monaco para o primeiro desenho da IDE. Quem precisa da cor pede
// este módulo por `import()`, já com a tela de pé.
import * as monaco from 'monaco-editor';
import { LINGUAGEM_PADRAO_MONACO } from '../../shared/editor/monaco-ids';
import { NOME_DO_TEMA, registrarTema } from '../editor/tema';
import type { NomeDoTema } from '../../shared/temas';

/**
 * As linguagens cujo tokenizador já foi carregado nesta página.
 *
 * O `colorize` do Monaco espera o tokenizador por um instante e, se ele não
 * chegar, devolve o texto SEM COR — sem erro, sem aviso. E o tokenizador de uma
 * linguagem só é carregado quando alguém abre um editor nela: numa página que
 * nunca abriu um `.json`, colorir JSON devolvia tudo na mesma classe `mtk1`.
 *
 * Criar um modelo vazio dispara o carregamento. Um por linguagem, descartado
 * logo em seguida — o registro do tokenizador é global e sobrevive ao descarte.
 */
const AQUECIDAS = new Set<string>();

function aquecer(id: string): void {
  if (AQUECIDAS.has(id)) return;
  AQUECIDAS.add(id);
  const modelo = monaco.editor.createModel('', id);
  modelo.dispose();
}

/**
 * O resultado saiu sem cor?
 *
 * `colorize` sempre devolve `<span class="mtkN">`; quando o tokenizador não
 * respondeu a tempo, TODOS saem como `mtk1` — o padrão. Uma classe só é o
 * sintoma, e é o que distingue "não deu tempo" de "este texto é mesmo de uma
 * cor só" (que também é `mtk1`, mas aí colorir de novo não custa nada).
 */
export function saiuSemCor(html: string): boolean {
  const classes = new Set(html.match(/mtk\d+/g) ?? []);
  return classes.size <= 1;
}

/** A linguagem cujo `saiuSemCor` não vale a pena repetir. */
export { LINGUAGEM_PADRAO_MONACO };

/**
 * Prepara o tema e o tokenizador, e devolve o HTML pintado.
 *
 * O tema tem que existir no Monaco antes de colorir. Num caderno aberto
 * sozinho pode não haver nenhum editor montado ainda, e sem isto as cores
 * sairiam as do `vs-dark` de fábrica em vez das nossas.
 */
export async function colorirComMonaco(
  texto: string,
  id: string,
  tema: NomeDoTema,
  tabSize: number
): Promise<string> {
  registrarTema(tema);
  monaco.editor.setTheme(NOME_DO_TEMA);
  aquecer(id);
  return monaco.editor.colorize(texto, id, { tabSize });
}
