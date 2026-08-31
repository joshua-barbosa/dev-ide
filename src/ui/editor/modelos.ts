// Os modelos de texto do Monaco, um por ARQUIVO — não por editor (T028).
//
// É a peça que faz "o mesmo arquivo aberto em dois grupos" ser correto em vez
// de perigoso. Duas abas do mesmo arquivo apontam para o mesmo modelo, e um
// modelo é um texto só: digitar de um lado aparece no outro na mesma tecla,
// desfazer é um histórico só, e **não existe a versão que sobrescreve a outra
// ao salvar**. É como o VS Code faz, pela mesma razão.
//
// Quem cria não é quem descarta: o modelo vive enquanto alguma aba o usa, e é
// o `useWorkspace` que o descarta ao fechar a última. Descartar no desmontar do
// editor mataria o texto do outro grupo — e a remontagem do editor acontece
// toda vez que o arranjo muda de forma.
import * as monaco from 'monaco-editor';
import { idDoMonaco } from '../../shared/editor/monaco-ids';

/**
 * A URI de um modelo.
 *
 * `inmemory:` é o mesmo esquema que o Monaco usa nos modelos anônimos que
 * criava antes desta mudança. Trocar para `file:` mudaria o que o serviço de
 * TypeScript embutido enxerga como projeto — efeito colateral que esta spec não
 * pediu e não mediu.
 */
function uriDe(chave: string): monaco.Uri {
  return monaco.Uri.parse(`inmemory://aba/${encodeURIComponent(chave)}`);
}

/**
 * O modelo desta chave, criando-o se ainda não houver.
 *
 * **Modelo que já existe não recebe o conteúdo de novo.** Ele é a versão viva —
 * pode ter o que a outra aba acabou de digitar, e o `conteudo` que chega aqui
 * é a cópia guardada no `meta`, de um instante atrás. Sobrescrever seria perder
 * teclas e ainda por cima zerar o desfazer.
 */
export function modeloDe(
  chave: string,
  conteudo: string,
  linguagem: string
): monaco.editor.ITextModel {
  const uri = uriDe(chave);
  return monaco.editor.getModel(uri) ?? monaco.editor.createModel(conteudo, idDoMonaco(linguagem), uri);
}

/** Joga fora o modelo desta chave. Só quem sabe que ninguém mais o usa chama. */
export function descartarModelo(chave: string): void {
  monaco.editor.getModel(uriDe(chave))?.dispose();
}
