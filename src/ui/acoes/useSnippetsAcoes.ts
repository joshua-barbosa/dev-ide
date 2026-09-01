// As ações da caixa de snippets (spec 019).
//
// Mesmo corte do `useComandosAcoes`: os fluxos de um assunto, com as
// dependências vindas de fora, para o `App` voltar a caber no teto de 800 linhas
// do Artigo IV.
import { Api } from '../api';
import { LINGUAGEM_TODAS, rotuloDaLinguagem } from '../../shared/snippets';
import { LINGUAGENS } from '../../shared/editor/idiomas';
import type { QuickInputController } from '../useQuickInput';
import type { Workspace } from '../useWorkspace';
import type { Snippets } from '../useSnippets';

export interface SnippetsAcoesDeps {
  readonly qi: QuickInputController;
  readonly ws: Workspace;
  readonly snippets: Snippets;
  /** Linguagem do editor em foco — decide quais snippets aparecem. */
  readonly linguagem: string;
  avisar(mensagem: string, titulo?: string): Promise<void>;
}

export interface SnippetsAcoes {
  abrir(): Promise<void>;
}

export function useSnippetsAcoes(deps: SnippetsAcoesDeps): SnippetsAcoes {
  const { qi, ws, snippets, linguagem, avisar } = deps;

  /**
   * A caixa de snippets: inserir, criar e remover.
   *
   * Mesma forma da caixa de comandos salvos — uma entrada de menu só, com a
   * gestão dentro da própria lista. O usuário tem poucos snippets; uma tela de
   * gerenciamento seria mais interface que conteúdo.
   */
  const abrir = async (): Promise<void> => {
    const doEditor = snippets.lista.filter(
      (s) => s.linguagem === linguagem || s.linguagem === LINGUAGEM_TODAS
    );
    const escolhido = await qi.pedir({
      titulo: 'Snippets',
      placeholder: 'Escolha um snippet para inserir',
      opcoes: [
        ...doEditor.map((s) => ({
          valor: `inserir:${s.id}`,
          rotulo: s.prefixo,
          detalhe: s.nome,
          icone: 'lucide:files',
          sufixo: rotuloDaLinguagem(s.linguagem),
        })),
        { valor: 'novo:', rotulo: 'Salvar um snippet novo…', icone: 'lucide:plus' },
        { valor: 'importar:', rotulo: 'Importar snippets do VS Code…', icone: 'lucide:download' },
        ...(snippets.lista.length === 0
          ? []
          : [{ valor: 'remover:', rotulo: 'Remover um snippet…', icone: 'lucide:trash-2' }]),
      ],
    });
    if (escolhido === null) return;

    if (escolhido === 'novo:') return salvar();
    if (escolhido === 'importar:') return importar();
    if (escolhido === 'remover:') return remover();

    const alvo = snippets.lista.find((s) => s.id === escolhido.slice('inserir:'.length));
    if (alvo !== undefined) ws.editorRef.current?.inserirSnippet(alvo.corpo);
  };

  /**
   * Importa os snippets que ele já tem no VS Code (T017).
   *
   * O campo abre com o caminho padrão do Linux preenchido: é onde eles estão em
   * quase todo caso, e quem os tem em outro lugar apaga e digita o dele. Pedir
   * um caminho vazio faria todo mundo ir procurar a pasta.
   *
   * Aceita ARQUIVO ou PASTA. A pasta é o caso comum — são muitos arquivos, um
   * por linguagem.
   */
  const importar = async (): Promise<void> => {
    const caminho = await qi.pedir({
      titulo: 'Importar snippets do VS Code',
      placeholder: 'Arquivo ou pasta de snippets',
      valorInicial: `${'~'}/.config/Code/User/snippets`,
    });
    if (caminho === null) return;

    const { importados, repetidos } = await Api.importSnippets(caminho);
    // Dizer QUANTOS entraram e quantos já existiam: importar em silêncio
    // deixaria quem importou sem saber se funcionou.
    await snippets.recarregar();
    await avisar(
      importados === 0 && repetidos === 0
        ? 'Nenhum snippet foi encontrado nesse caminho.'
        : `${importados} snippet(s) importado(s).` +
            (repetidos === 0 ? '' : ` ${repetidos} já existia(m) e não entrou(ram) de novo.`),
      'Importar snippets'
    );
  };

  /**
   * Cria um snippet a partir da SELEÇÃO, quando houver.
   *
   * É o caminho natural: o trecho que se quer guardar quase sempre já está na
   * tela. Pedir para digitar de novo seria pedir duas vezes a mesma coisa.
   */
  const salvar = async (): Promise<void> => {
    const selecionado = ws.editorRef.current?.getSelection() ?? '';

    const prefixo = await qi.pedir({
      titulo: 'Novo snippet',
      placeholder: 'Prefixo — a palavra que dispara, ex.: log',
    });
    if (prefixo === null) return;

    const corpo = await qi.pedir({
      titulo: `Corpo de "${prefixo}"`,
      placeholder: 'Use $1, ${1:valor} e $0 para os pontos de parada',
      valorInicial: selecionado,
    });
    if (corpo === null) return;

    const alvo = await qi.pedir({
      titulo: 'Em que linguagem este snippet vale?',
      placeholder: 'Linguagem',
      opcoes: [
        {
          valor: LINGUAGEM_TODAS,
          rotulo: 'Todas as linguagens',
          detalhe: 'para o que não é de linguagem nenhuma',
          icone: 'lucide:boxes',
        },
        ...LINGUAGENS.map(([valor, rotulo, icone]) => ({ valor, rotulo, icone })),
      ],
    });
    if (alvo === null) return;

    await snippets.criar({ nome: prefixo, prefixo, corpo, linguagem: alvo });
  };

  const remover = async (): Promise<void> => {
    const escolhido = await qi.pedir({
      titulo: 'Remover snippet',
      placeholder: 'Escolha o que remover',
      opcoes: snippets.lista.map((s) => ({
        valor: s.id,
        rotulo: s.prefixo,
        detalhe: s.corpo.split('\n')[0],
        sufixo: rotuloDaLinguagem(s.linguagem),
      })),
    });
    if (escolhido !== null) await snippets.remover(escolhido);
  };


  return { abrir };
}
