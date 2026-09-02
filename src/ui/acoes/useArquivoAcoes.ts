// As ações de arquivo: salvar, salvar tudo, auto-save e reverter (specs 006 e 015).
//
// Mesmo corte dos outros arquivos daqui: os fluxos de um assunto, com as
// dependências vindas de fora, para o `App` caber no teto do Artigo IV.
//
// O que junta os quatro não é o menu — é o **disco**. Todos gravam ou releem
// arquivo, e todos precisam avisar a árvore de pastas de que algo mudou.
import { pedirComRetentativa, type QuickInputController } from '../useQuickInput';
import type { PastaAberta } from '../files/usePasta';
import type { PrefsController } from '../usePrefs';
import type { Workspace } from '../useWorkspace';

export interface ArquivoAcoesDeps {
  readonly qi: QuickInputController;
  readonly ws: Workspace;
  readonly pasta: PastaAberta;
  readonly prefs: PrefsController;
  avisar(mensagem: string, titulo?: string): Promise<void>;
  confirmar(opcoes: {
    titulo: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
  /**
   * Chamado depois de cada gravação bem-sucedida (T010).
   *
   * Existe para o Timeline pedir a lista de novo: quem cria a versão é o
   * servidor, e a tela só sabe QUE gravou.
   */
  aoSalvar?(): void;
}

export interface ArquivoAcoes {
  salvarArquivo(): Promise<void>;
  salvarTudo(): Promise<void>;
  alternarAutoSave(): Promise<void>;
  reverterArquivo(): Promise<void>;
}

export function useArquivoAcoes(deps: ArquivoAcoesDeps): ArquivoAcoes {
  const { qi, ws, pasta, prefs, avisar, confirmar } = deps;

  /**
   * Confirma antes de sobrescrever um arquivo que mudou em disco (spec 037).
   *
   * É o buraco que o vigia existe para fechar: com o arquivo alterado por fora
   * — um `git checkout`, um script, o outro editor —, salvar apagava aquilo sem
   * uma palavra. A IDE não tem como saber qual das duas versões vale, e por
   * isso não escolhe.
   */
  const podeSobrescrever = async (): Promise<boolean> => {
    const aba = ws.active;
    if (aba === null || !ws.conflitos.has(aba.id)) return true;
    const ok = await confirmar({
      titulo: 'O arquivo mudou em disco',
      mensagem:
        `"${aba.title}" foi alterado fora da IDE depois de você começar a editar.\n\n` +
        'Salvar agora substitui a versão do disco pela que está na tela.',
      rotuloConfirmar: 'sobrescrever',
      destrutivo: true,
    });
    if (ok) ws.limparConflito(aba.id);
    return ok;
  };

  /** Grava a aba ativa, pedindo o nome se ela ainda não tem arquivo. */
  const salvarArquivo = async (): Promise<void> => {
    if (!(await podeSobrescrever())) return;
    const caminho = await ws.salvar();
    if (caminho !== null) {
      deps.aoSalvar?.();
      // Salvou o próprio `config.json`? Relê — é o que faz editar a preferência
      // no editor surtir efeito sem recarregar a página.
      if (caminho === prefs.caminho) await prefs.recarregar();
      await pasta.recarregar();
      return;
    }
    const aba = ws.active;
    if (aba === null || aba.type === 'grid' || aba.type === 'conexao') return;

    const conteudo = ws.editorRef.current?.getValue() ?? '';
    const criado = await pedirComRetentativa(
      qi,
      { titulo: 'Nome do arquivo', placeholder: 'ex.: utils.ts, script.py' },
      (nome) => pasta.criarArquivo(nome, conteudo)
    );
    // Cancelar mantém a aba como está, com o conteúdo intacto (AC-18).
    if (criado === null) return;
    ws.adotarArquivo(aba.id, criado);
  };

  /** Grava tudo que está sujo e diz o que ficou de fora, sem enfileirar caixas. */
  const salvarTudo = async (): Promise<void> => {
    const { gravadas, semNome } = await ws.salvarTodas();
    await pasta.recarregar();
    if (semNome > 0) {
      await avisar(
        `${gravadas} arquivo(s) gravado(s).\n\n` +
          `${semNome} aba(s) ainda sem nome — use Salvar (Ctrl+S) em cada uma para escolher o arquivo.`,
        'Save All'
      );
    }
  };

  /** Alterna entre não salvar e salvar por atraso. É o interruptor do menu. */
  const alternarAutoSave = async (): Promise<void> => {
    const atual = prefs.prefs['editor.autoSave'];
    await prefs.definir({ 'editor.autoSave': atual === 'off' ? 'afterDelay' : 'off' });
  };

  /**
   * Volta ao que está em disco, confirmando quando há o que perder.
   *
   * A ORDEM importa, e o teste pegou isto: a aba sem título nasce suja, então
   * confirmar antes de checar o disco fazia a IDE perguntar "descartar tudo?"
   * para só depois dizer que não havia para onde voltar. Primeiro se checa se
   * a pergunta faz sentido; depois se pergunta.
   */
  const reverterArquivo = async (): Promise<void> => {
    const caminho = (ws.active?.meta as { path?: string | null } | undefined)?.path ?? null;
    if (caminho === null) {
      await avisar(
        'Esta aba ainda não foi salva — não há versão em disco para voltar.',
        'Reverter arquivo'
      );
      return;
    }
    if (ws.active?.dirty === true) {
      const ok = await confirmar({
        titulo: 'Reverter arquivo',
        mensagem:
          `"${ws.active.title}" tem alterações não salvas.\n\n` +
          'Voltar ao que está em disco descarta tudo que foi feito desde o último salvamento.',
        rotuloConfirmar: 'reverter',
        destrutivo: true,
      });
      if (!ok) return;
    }
    await ws.reverter();
  };

  return { salvarArquivo, salvarTudo, alternarAutoSave, reverterArquivo };
}
