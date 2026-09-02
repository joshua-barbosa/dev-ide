// Renomear um símbolo em todos os arquivos (T038).
//
// A nota dele é a decisão: *"mostrando os arquivos afetados antes de aplicar"*.
// É a mesma regra do Structure Sync (spec 079) e do Timeline (spec 080) — a IDE
// mostra o que vai fazer, e quem manda é ele.
//
// A conta que aplica as trocas mora em `shared/renomear.ts`, testada sem disco:
// é ela que erra, porque trocar do começo para o fim move os alvos seguintes.
import { Api } from '../api';
import type { TrocaDeNome } from '../api';
import type { QuickInputController } from '../useQuickInput';
import type { Workspace } from '../useWorkspace';
import { aplicarTrocas, porArquivo } from '../../shared/renomear';

export interface RenomearDeps {
  readonly qi: QuickInputController;
  readonly ws: Workspace;
  pastaAtual(): string;
  confirmar(o: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
  notificar(mensagem: string, tipo?: 'info' | 'sucesso' | 'atencao' | 'erro'): void;
  onErro(erro: unknown): void;
}

export function useRenomearSimbolo(deps: RenomearDeps): () => Promise<void> {
  const { qi, ws, confirmar, notificar, onErro } = deps;

  return async (): Promise<void> => {
    const editor = ws.editorRef.current;
    const trecho = editor?.trechoDeTrabalho();
    const caminho = ((ws.active?.meta ?? {}) as { path?: string | null }).path ?? null;
    const pasta = deps.pastaAtual();

    if (editor === null || trecho === null || caminho === null || pasta === '') {
      notificar('Abra um arquivo do projeto e ponha o cursor sobre o nome.', 'atencao');
      return;
    }

    const posicao = ws.cursor;
    let lugares: readonly TrocaDeNome[];
    try {
      const r = await Api.lugaresParaRenomear({
        // A PASTA não vai na pergunta: o servidor a lê do estado dele, que é a
        // mesma fonte que a árvore e a busca usam. Mandá-la daqui criaria duas
        // verdades sobre qual projeto está aberto.
        caminho,
        linha: posicao.linha,
        coluna: posicao.coluna,
        conteudo: editor.getValue(),
      });
      lugares = r.lugares;
    } catch (e) {
      onErro(e);
      return;
    }

    if (lugares.length === 0) {
      // Cursor num comentário, numa string, ou numa linguagem sem serviço.
      notificar('Não há o que renomear nesta posição.', 'atencao');
      return;
    }

    // O nome velho sai do PRÓPRIO texto, na posição que o serviço devolveu — e
    // não da palavra sob o cursor. Os dois quase sempre coincidem; quando não
    // coincidem, quem está certo é o serviço.
    const daqui = lugares.find((l) => l.caminho === caminho);
    const linhaDoTexto = editor.getValue().split('\n')[(daqui?.linha ?? 1) - 1] ?? '';
    const nomeVelho = /^[A-Za-z0-9_$]+/.exec(
      linhaDoTexto.slice((daqui?.coluna ?? 1) - 1)
    )?.[0] ?? '';

    const nomeNovo = await qi.pedir({
      titulo: `Renomear "${nomeVelho}"`,
      placeholder: 'Novo nome',
      valorInicial: nomeVelho,
    });
    if (nomeNovo === null || nomeNovo.trim() === '' || nomeNovo === nomeVelho) return;

    const arquivos = porArquivo(lugares);
    const lista = [...arquivos.entries()]
      .slice(0, 10)
      .map(([arq, ls]) => `${arq}  (${ls.length}×)`)
      .join('\n');

    const ok = await confirmar({
      titulo: 'Renomear em todos os arquivos',
      mensagem:
        `Trocar "${nomeVelho}" por "${nomeNovo}" em ${lugares.length} ` +
        `lugar(es), ${arquivos.size} arquivo(s):\n\n${lista}` +
        (arquivos.size > 10 ? `\n… e mais ${arquivos.size - 10}.` : ''),
      rotuloConfirmar: 'renomear',
    });
    if (!ok) return;

    let mudados = 0;
    const falhas: string[] = [];
    for (const [arquivo, doArquivo] of arquivos) {
      try {
        // Lê do DISCO, e não da tela: a maioria dos arquivos afetados não está
        // aberta, e os que estão são recarregados no fim.
        const { content } = await Api.readFile(arquivo);
        const novo = aplicarTrocas(content, doArquivo, nomeVelho, nomeNovo);
        if (novo === content) continue;
        await Api.saveFile(arquivo, novo);
        mudados += 1;
      } catch (e) {
        falhas.push(`${arquivo}: ${(e as Error).message}`);
      }
    }

    // As abas abertas precisam ver o texto novo: sem isto, salvar uma delas
    // depois desfaria a renomeação naquele arquivo.
    await ws.recarregarDoDisco([...arquivos.keys()]);

    if (falhas.length > 0) {
      notificar(
        `${mudados} arquivo(s) renomeados; ${falhas.length} falharam:\n${falhas.join('\n')}`,
        'erro'
      );
    } else {
      notificar(`"${nomeVelho}" virou "${nomeNovo}" em ${mudados} arquivo(s).`, 'sucesso');
    }
  };
}
