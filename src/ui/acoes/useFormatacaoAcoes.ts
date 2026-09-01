// Beautify, Minify e a foto do trecho (spec 077).
//
// O que os três têm em comum, e por isso vivem juntos: todos pegam **o que está
// selecionado e, sem seleção, o documento inteiro**. É a regra do `Format
// Selection` de qualquer editor, e ela vale aqui para os três.
//
// O resultado volta por `executeEdits`, e não por `setValue`: é o que faz o
// `Ctrl+Z` desfazer o Beautify inteiro num toque. `setValue` limpa a pilha de
// desfazer, e um formatador que não se desfaz é um formatador que ninguém usa
// em arquivo grande.
import { Api } from '../api';
import { capacidadeDe, podeFormatar, type ModoDeFormatacao } from '../../shared/formatacao';
import type { PedidoDeCodeSnap } from '../editor/CodeSnapDialog';
import type { TrechoDeTrabalho } from '../editor/EditorHost';
import type { Workspace } from '../useWorkspace';

export interface FormatacaoAcoesDeps {
  readonly ws: Workspace;
  /** O `editor.tabSize` de agora — o que sai tem de casar com o que ele vê. */
  readonly tabSize: number;
  /** O dialeto da conexão ativa, quando houver: muda como o SQL quebra. */
  readonly dialetoAtivo: string | null;
  avisar(mensagem: string, titulo?: string): Promise<void>;
  /** Abre a janela do CodeSnap. */
  abrirCodeSnap(pedido: PedidoDeCodeSnap): void;
}

export interface FormatacaoAcoes {
  formatar(modo: ModoDeFormatacao): Promise<void>;
  foto(): Promise<void>;
}

export function useFormatacaoAcoes(deps: FormatacaoAcoesDeps): FormatacaoAcoes {
  const { ws, tabSize, dialetoAtivo, avisar, abrirCodeSnap } = deps;

  /** O editor em foco e o trecho em que os comandos agem. */
  const trecho = (): {
    readonly editor: NonNullable<Workspace['editorRef']['current']>;
    readonly alvo: TrechoDeTrabalho;
  } | null => {
    const editor = ws.editorRef.current;
    if (editor === null) return null;
    const alvo = editor.trechoDeTrabalho();
    return alvo === null ? null : { editor, alvo };
  };

  // A linguagem que a ABA declara. `ws.linguagemAtiva`, e não uma leitura
  // própria de `meta`: a chave lá se chama `language`, e ler errado devolvia
  // "texto" para todo arquivo — o Beautify recusava tudo, calado.
  const linguagemDaAba = (): string => ws.linguagemAtiva;

  const formatar = async (modo: ModoDeFormatacao): Promise<void> => {
    const atual = trecho();
    const titulo = modo === 'beautify' ? 'Beautify' : 'Minify';
    if (atual === null) {
      await avisar('Abra um arquivo no editor primeiro.', titulo);
      return;
    }

    const linguagem = linguagemDaAba();
    // A recusa é conferida AQUI antes de ir ao servidor, para a mensagem sair
    // na hora. O servidor confere de novo — ele é a fronteira de verdade, e
    // quem chamar a rota direto recebe a mesma resposta.
    const veredito = podeFormatar(capacidadeDe(linguagem), modo);
    if (!veredito.pode && linguagem !== 'python') {
      await avisar(veredito.motivo, titulo);
      return;
    }

    let saida: string;
    try {
      const r = await Api.format({
        texto: atual.alvo.texto,
        linguagem,
        modo,
        tabSize,
        ...(dialetoAtivo === null ? {} : { dialeto: dialetoAtivo }),
      });
      saida = r.texto;
    } catch (e) {
      await avisar((e as Error).message, titulo);
      return;
    }

    // O `\n` do fim só vale no documento inteiro: numa seleção ele empurraria a
    // linha seguinte para baixo a cada Beautify.
    const texto = atual.alvo.inteiro ? saida : saida.replace(/\n$/, '');
    if (texto === atual.alvo.texto) {
      await avisar(
        modo === 'beautify'
          ? 'Já estava formatado — nada mudou.'
          : 'Já estava numa linha só — nada mudou.',
        titulo
      );
      return;
    }

    atual.editor.substituirTrecho(atual.alvo, texto);
  };

  /**
   * A foto do trecho (CodeSnap).
   *
   * Sem seleção ela sairia com o arquivo inteiro, o que quase nunca é o que se
   * quer — mas recusar seria pior. Ela sai, e o aviso é a própria prévia: se
   * veio o arquivo todo, dá para ver e fechar.
   */
  const foto = async (): Promise<void> => {
    const atual = trecho();
    if (atual === null) {
      await avisar('Abra um arquivo e selecione o trecho que você quer fotografar.', 'CodeSnap');
      return;
    }
    if (atual.alvo.texto.trim() === '') {
      await avisar('Não há nada selecionado para fotografar.', 'CodeSnap');
      return;
    }
    const aba = ws.active;
    abrirCodeSnap({
      texto: atual.alvo.texto,
      // A do MONACO, e não a da IDE: é ela que o `colorize` entende.
      linguagem: atual.alvo.linguagemDoMonaco,
      primeiraLinha: atual.alvo.primeiraLinha,
      caminho: ((aba?.meta ?? {}) as { path?: string | null }).path ?? null,
    });
  };

  return { formatar, foto };
}
