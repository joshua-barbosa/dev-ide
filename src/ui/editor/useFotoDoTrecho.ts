// De onde a foto do CodeSnap lê a seleção (spec 077).
//
// Saiu do `App` porque ele voltou a bater no teto de 800 do Artigo IV. O
// assunto é um só, e não é montar tela: **qual editor é a origem da foto**.
//
// A resposta não é "o grupo em foco". Assim que a aba da foto recebe um clique,
// o foco passa a ser dela, e a imagem congelaria no trecho de antes. O grupo de
// origem é gravado no `meta` da aba quando ela nasce, e é dele que se lê.
import type { AcaoDeMenuDoEditor, EditorHandle } from './EditorHost';
import type { Workspace } from '../useWorkspace';

export interface FotoDoTrecho {
  /** O editor do arquivo — o que tem a seleção que vira foto. */
  readonly editorDeOrigem: EditorHandle | null;
  /** O caminho do arquivo de origem, que dá nome ao PNG. */
  readonly caminhoDeOrigem: string | null;
}

/**
 * O item da foto no menu de botão direito DO EDITOR.
 *
 * `editorHasSelection` é do próprio Monaco: sem trecho marcado o item aparece
 * apagado, em vez de aceitar o clique e avisar depois que não dava.
 */
export function acaoDeMenuDaFoto(aoRodar: () => void): readonly AcaoDeMenuDoEditor[] {
  return [{
    id: 'dev-ide.codesnap',
    rotulo: 'Foto do trecho (CodeSnap)',
    quando: 'editorHasSelection',
    aoRodar,
  }];
}

export function useFotoDoTrecho(ws: Workspace): FotoDoTrecho {
  const origem = ((ws.store.get('codesnap')?.meta ?? {}) as { origem?: number }).origem ?? 0;
  const aba = ws.store.get(ws.store.ativaDoGrupo(origem) ?? '');
  return {
    editorDeOrigem: ws.editorDoGrupo(origem),
    caminhoDeOrigem: ((aba?.meta ?? {}) as { path?: string | null }).path ?? null,
  };
}
