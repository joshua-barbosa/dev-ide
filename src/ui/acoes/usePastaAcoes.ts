// As ações de pasta e projeto (spec 012).
//
// Mesmo corte dos outros arquivos daqui: os fluxos de um assunto, com as
// dependências vindas de fora, para o `App` caber no teto do Artigo IV.
import { Api } from '../api';
import { pedirComRetentativa, type QuickInputController } from '../useQuickInput';
import type { PastaAberta } from '../files/usePasta';

export interface PastaAcoesDeps {
  readonly qi: QuickInputController;
  readonly pasta: PastaAberta;
  avisar(mensagem: string, titulo?: string): Promise<void>;
}

export interface PastaAcoes {
  novoProjeto(): Promise<void>;
  escolherProjeto(): Promise<void>;
  abrirPasta(): Promise<void>;
  abrirRecente(): Promise<void>;
}

export function usePastaAcoes(deps: PastaAcoesDeps): PastaAcoes {
  const { qi, pasta, avisar } = deps;

  const novoProjeto = async (): Promise<void> => {
    await pedirComRetentativa(
      qi,
      { titulo: 'Nome do projeto', placeholder: 'ex.: meu-projeto' },
      (nome: string) => pasta.criarProjeto(nome)
    );
  };

  const escolherProjeto = async (): Promise<void> => {
    const escolhido = await qi.pedir({
      titulo: 'Abrir workspace',
      placeholder: 'Escolha um projeto',
      opcoes: pasta.projetos.map((p) => ({
        valor: p.dir,
        rotulo: p.name,
        detalhe: p.dir,
        icone: 'folder',
      })),
    });
    if (escolhido !== null) await pasta.abrir(escolhido);
  };

  /**
   * Navegador de pastas servido pelo backend.
   *
   * O navegador nativo do sistema só existe no Electron, que está adiado por
   * gatilho — então a IDE lista as pastas e o usuário desce por elas. Cada
   * parada oferece **abrir esta pasta**, para não obrigar a descer mais um
   * nível só para confirmar.
   *
   * Sem componente novo: a entrada rápida em modo lista já tem seta, filtro,
   * Enter e Esc. O valor carrega o verbo (`abrir:` ou `ir:`), e o laço vive
   * aqui — a mesma forma de `pedirComRetentativa`.
   */
  const abrirPasta = async (): Promise<void> => {
    let atual: string | undefined = pasta.pasta === '' ? undefined : pasta.pasta;
    for (;;) {
      const listagem = await Api.browseFolders(atual);
      const opcoes = [
        { valor: `abrir:${listagem.path}`, rotulo: 'Abrir esta pasta', detalhe: listagem.path, icone: 'lucide:check' },
        ...(listagem.parent === null
          ? []
          : [{ valor: `ir:${listagem.parent}`, rotulo: '..', detalhe: listagem.parent, icone: 'lucide:corner-left-up' }]),
        ...listagem.dirs.map((d) => ({ valor: `ir:${d.path}`, rotulo: d.name, icone: 'folder' })),
      ];

      const escolhido = await qi.pedir({
        titulo: 'Abrir pasta',
        placeholder: listagem.path,
        opcoes,
      });
      // Cancelar mantém a pasta anterior (AC-4).
      if (escolhido === null) return;

      const [verbo, ...resto] = escolhido.split(':');
      const alvo = resto.join(':');
      if (verbo === 'abrir') {
        await pasta.abrir(alvo);
        return;
      }
      atual = alvo;
    }
  };

  /** Pastas recentes. A que não existe mais é informada e esquecida (AC-10). */
  const abrirRecente = async (): Promise<void> => {
    if (pasta.recentes.length === 0) {
      await avisar('Nenhuma pasta aberta ainda.', 'Open Recent');
      return;
    }
    const escolhido = await qi.pedir({
      titulo: 'Abrir pasta recente',
      placeholder: 'Escolha uma pasta',
      opcoes: pasta.recentes.map((caminho) => ({
        valor: caminho,
        rotulo: caminho.split('/').filter((p) => p !== '').pop() ?? caminho,
        detalhe: caminho,
        icone: 'folder',
      })),
    });
    if (escolhido === null) return;
    try {
      await pasta.abrir(escolhido);
    } catch (e) {
      await pasta.esquecer(escolhido);
      await avisar(
        `${(e as Error).message}\n\nEla foi removida da lista de recentes.`,
        'Pasta indisponível'
      );
    }
  };


  return { novoProjeto, escolherProjeto, abrirPasta, abrirRecente };
}
