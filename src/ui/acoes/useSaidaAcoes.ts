// O que fazer com a SAÍDA da execução.
//
// Saiu do `App` quando ele bateu no teto de 800 do Artigo IV pela sexta vez. O
// corte é o de sempre: um assunto por arquivo. "O que fazer com a saída" é um
// assunto, e as duas coisas que se faz com ela — abrir numa aba e gravar num
// arquivo — partem do mesmo texto e da mesma recusa quando ele está vazio.
import { pedirComRetentativa, type QuickInputController } from '../useQuickInput';
import type { Execution } from '../useExecution';
import type { PastaAberta } from '../files/usePasta';
import type { Workspace } from '../useWorkspace';

export interface SaidaAcoesDeps {
  readonly qi: QuickInputController;
  readonly ws: Workspace;
  readonly exec: Execution;
  readonly pasta: PastaAberta;
  avisar(mensagem: string, titulo?: string): Promise<void>;
}

export interface SaidaAcoes {
  /** Tudo o que saiu, já emendado — é o que as duas ações levam. */
  texto(): string;
  /** Leva a saída para uma aba do editor, sem passar por arquivo. */
  abrirNoEditor(): void;
  /** Grava a saída na pasta aberta, com o nome pedido pela entrada rápida. */
  salvarComo(): Promise<void>;
}

export function useSaidaAcoes({ qi, ws, exec, pasta, avisar }: SaidaAcoesDeps): SaidaAcoes {
  const texto = (): string => exec.saida.map((l) => l.texto).join('');

  const abrirNoEditor = (): void => {
    const conteudo = texto();
    // Saída vazia não abre aba nenhuma: uma aba em branco chamada `output.log`
    // parece defeito, não resultado.
    if (conteudo === '') return;
    ws.abrirTexto('saida:editor', 'output.log', conteudo, 'plaintext');
  };

  const salvarComo = async (): Promise<void> => {
    const conteudo = texto();
    if (conteudo === '') return;
    if (pasta.pasta === '') {
      await avisar(
        'Abra uma pasta antes de salvar a saída — é nela que o arquivo será gravado.',
        'Salvar saída'
      );
      return;
    }
    await pedirComRetentativa(
      qi,
      { titulo: 'Salvar saída como', placeholder: 'ex.: saida.log', valorInicial: 'saida.log' },
      (nome) => pasta.criarArquivo(nome, conteudo)
    );
  };

  return { texto, abrirNoEditor, salvarComo };
}
