// As aberturas que passam pela entrada rápida.
//
// Saiu do `App` quando ele passou do teto de 800 linhas do Artigo IV ao ganhar
// o menu da árvore (T043). O corte é por assunto: *"o que a entrada rápida abre
// ou escolhe"* — arquivo, preferências e tema —, e o `App` fica só com a
// montagem da tela.
import { Api } from '../api';
import { NOMES_DE_TEMA, ROTULO_DO_TEMA, type NomeDoTema } from '../../shared/temas';
import type { QuickInputController } from '../useQuickInput';

export interface AberturasDeps {
  readonly qi: QuickInputController;
  abrirArquivo(caminho: string): Promise<void>;
  readonly tema: NomeDoTema;
  definirTema(nome: NomeDoTema): Promise<void>;
}

export interface Aberturas {
  abrirPreferencias(): Promise<void>;
  /** `File → Open File…`: caminho absoluto, digitado. */
  abrirPorCaminho(): Promise<void>;
  escolherTema(): Promise<void>;
}

export function useAberturas({ qi, abrirArquivo, tema, definirTema }: AberturasDeps): Aberturas {
  /**
   * Abre o `config.json` como aba do editor.
   *
   * É a "tela de configurações" desta IDE, e de propósito: a IDE já sabe abrir,
   * editar e salvar arquivo, então isto custa uma linha e cobre 100% das
   * chaves. Um formulário custaria um campo por preferência, e ficaria para
   * trás a cada chave nova.
   */
  const abrirPreferencias = async (): Promise<void> => {
    const { path } = await Api.prefsFile();
    await abrirArquivo(path);
  };

  const abrirPorCaminho = async (): Promise<void> => {
    const caminho = await qi.pedir({
      titulo: 'Abrir arquivo',
      placeholder: 'Caminho absoluto do arquivo',
    });
    if (caminho !== null) await abrirArquivo(caminho);
  };

  /** Escolhe o tema. Vale para moldura, editor e terminal ao mesmo tempo. */
  const escolherTema = async (): Promise<void> => {
    const escolhido = await qi.pedir({
      titulo: 'Tema da interface',
      placeholder: 'Escolha um tema',
      opcoes: NOMES_DE_TEMA.map((nome) => ({
        valor: nome,
        rotulo: ROTULO_DO_TEMA[nome],
        detalhe: nome === tema ? 'atual' : undefined,
        icone: nome === tema ? 'lucide:check' : 'lucide:circle-dot',
      })),
    });
    if (escolhido !== null) await definirTema(escolhido as NomeDoTema);
  };

  return { abrirPreferencias, abrirPorCaminho, escolherTema };
}
