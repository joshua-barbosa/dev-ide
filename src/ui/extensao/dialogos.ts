// Os diálogos de pergunta e aviso, usando a caixa do PRÓPRIO editor.
//
// Ele mandou o print do "Excluir conexão" desenhado dentro da coluna de 300 px
// da barra lateral — cinza sobre cinza, texto cortado, botões espremidos — e
// disse que tudo que abre diálogo tem de sair dali.
//
// A caixa nativa do VS Code é centralizada na janela inteira, segue o tema e o
// teclado dele, e não rouba espaço do painel. É a mesma escolha que já valia
// para `pedirTexto`.
import type { DialogsController } from '../useDialogs';
import { chamarHost } from './ponte';

/**
 * O mesmo contrato do `useDialogs` da IDE, atendido pelo editor.
 *
 * Ser o mesmo contrato é o que permite passar isto para `useConnections`,
 * `useAcoesRemotas` e `ConnectionsPanel` sem que nenhum deles saiba onde está
 * rodando.
 */
export function dialogosNativos(): DialogsController {
  const confirmar: DialogsController['confirmar'] = (o) =>
    chamarHost<boolean>('confirmar', {
      titulo: o.titulo ?? '',
      mensagem: o.mensagem,
      rotuloConfirmar: o.rotuloConfirmar ?? 'OK',
    });

  const avisar: DialogsController['avisar'] = async (mensagem, titulo) => {
    await chamarHost('avisar', { mensagem, titulo: titulo ?? '' });
  };

  return {
    confirmar,
    avisar,
    aoFalhar: (erro: unknown) => {
      void avisar(erro instanceof Error ? erro.message : String(erro), 'Erro');
    },
    // Não há nada a desenhar: quem desenha é o editor.
    elemento: null,
  };
}
