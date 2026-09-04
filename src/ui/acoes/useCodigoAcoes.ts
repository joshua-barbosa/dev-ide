// Navegação por código: ir para a definição, para o tipo e ver as referências.
//
// Mesmo corte dos outros arquivos daqui. O que este assunto tem de próprio é a
// forma da resposta: **uma lista de lugares**, que pode ter zero, um ou muitos.
// A regra é a mesma para as três perguntas — um leva direto, muitos abrem a
// escolha rápida, nenhum avisa em vez de não fazer nada em silêncio.
import { nomeParaExibir } from '../../shared/caminho-local';
import { Api, type Alvo, type PerguntaDeCodigo } from '../api';
import { iconeDeArquivo } from '../../shared/editor/arquivos';
import type { QuickInputController } from '../useQuickInput';
import type { Workspace } from '../useWorkspace';

export interface CodigoAcoesDeps {
  readonly qi: QuickInputController;
  readonly ws: Workspace;
  avisar(mensagem: string, titulo?: string): Promise<void>;
}

export interface CodigoAcoes {
  irParaDefinicao(): Promise<void>;
  irParaDefinicaoDeTipo(): Promise<void>;
  verReferencias(): Promise<void>;
}

const nomeDe = nomeParaExibir;

export function useCodigoAcoes({ qi, ws, avisar }: CodigoAcoesDeps): CodigoAcoes {
  /**
   * Onde o cursor está, com o texto da TELA.
   *
   * O conteúdo vai junto de propósito: navegar não pode exigir salvar antes, e
   * uma definição escrita há dois segundos ainda não está em disco.
   */
  const ondeEstou = (): PerguntaDeCodigo | null => {
    const aba = ws.active;
    if (aba === null) return null;
    const caminho = (aba.meta as { path?: string | null }).path ?? null;
    if (caminho === null) return null;
    const editor = ws.editorRef.current;
    if (editor === null) return null;
    return {
      caminho,
      linha: ws.cursor.linha,
      coluna: ws.cursor.coluna,
      conteudo: editor.getValue(),
    };
  };

  const navegar = async (alvos: readonly Alvo[], titulo: string, vazio: string): Promise<void> => {
    if (alvos.length === 0) {
      // Avisar, e não ficar quieto: sem resposta, "não achei" e "não funciona"
      // se parecem, e o usuário aperta a tecla de novo.
      await avisar(vazio, titulo);
      return;
    }
    if (alvos.length === 1) {
      const alvo = alvos[0]!;
      await ws.abrirArquivoEm(alvo.caminho, alvo.linha, alvo.coluna);
      return;
    }
    const escolha = await qi.pedir({
      titulo,
      placeholder: 'Filtrar…',
      opcoes: alvos.map((alvo, i) => ({
        valor: String(i),
        rotulo: alvo.previa === '' ? nomeDe(alvo.caminho) : alvo.previa,
        detalhe: `${nomeDe(alvo.caminho)}:${alvo.linha}`,
        icone: iconeDeArquivo(alvo.caminho),
      })),
    });
    if (escolha === null) return;
    const alvo = alvos[Number(escolha)];
    if (alvo !== undefined) await ws.abrirArquivoEm(alvo.caminho, alvo.linha, alvo.coluna);
  };

  const perguntar = async (
    consulta: (p: PerguntaDeCodigo) => Promise<{ alvos: Alvo[] }>,
    titulo: string,
    vazio: string
  ): Promise<void> => {
    const onde = ondeEstou();
    if (onde === null) return;
    const { alvos } = await consulta(onde);
    await navegar(alvos, titulo, vazio);
  };

  // A mensagem de "nada encontrado" diz TAMBÉM o que a IDE entende, porque a
  // resposta vazia num arquivo `.py` significa outra coisa: não é que não
  // exista definição, é que ninguém sabe procurá-la ainda.
  const semResposta = (o: string): string =>
    `Nada encontrado para ${o}.\n\nA navegação por código entende TypeScript e ` +
    'JavaScript; nas outras linguagens ela ainda não sabe procurar.';

  return {
    irParaDefinicao: () =>
      perguntar(Api.definition, 'Ir para a definição', semResposta('a definição')),
    irParaDefinicaoDeTipo: () =>
      perguntar(Api.typeDefinition, 'Ir para a definição do tipo', semResposta('o tipo')),
    verReferencias: () =>
      perguntar(Api.references, 'Referências', semResposta('as referências')),
  };
}
