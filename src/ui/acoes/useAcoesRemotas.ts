// O que se faz com um nó da árvore REMOTA (spec 053).
//
// Separado do menu de banco porque o vocabulário é outro: lá as ações GERAM
// SQL e não executam nada; aqui elas mexem no servidor de verdade — renomear,
// apagar, gravar. É a diferença que a D27 registra, e ela justifica um módulo
// próprio em vez de mais um `if` no menu de conexões.
//
// **O que escreve some quando a conexão é somente-leitura.** A trava de valer
// está na rota; sumir daqui é só não oferecer o que vai ser recusado.
import { Api } from '../api';
import { nomeDe, paiDe } from '../../shared/remoto/caminho';
import type { TreeNode } from '../../shared/contracts';
import { baixarArquivo as entregarArquivo } from '../arquivos/transferencia';

export interface EntradaDeMenu {
  readonly label: string;
  readonly danger?: boolean;
  onClick(): void | Promise<void>;
}

export interface DepsDasAcoesRemotas {
  copiar(texto: string): void;
  pedir(opcoes: {
    titulo: string;
    placeholder: string;
    valorInicial?: string;
  }): Promise<string | null>;
  confirmar(opcoes: {
    titulo?: string;
    mensagem: string;
    rotuloConfirmar?: string;
    destrutivo?: boolean;
  }): Promise<boolean>;
  abrirArquivoRemoto(conexaoId: string, caminho: string): Promise<void>;
  /** Mostra o script e pergunta antes de rodar (D28, D30). */
  confirmarScript(nome: string, conteudo: string): Promise<boolean>;
  escreverNaSaida(texto: string, erro: boolean): void;
  mostrarSaida(): void;
  recarregarNo(id: string, caminho: readonly string[]): Promise<void>;
  avisar(p: Promise<unknown>): void;
  somenteLeitura(conexaoId: string): boolean;
  /**
   * Onde o arquivo baixado vai parar.
   *
   * Ausente, é o download do navegador — que é o que a IDE em aba tem. Dentro
   * do VS Code isso simplesmente não acontece (a webview não baixa nada), e
   * quem sabe salvar é o host, com o diálogo nativo.
   */
  baixarPeloHost?(conexaoId: string, caminho: string): Promise<void>;
}

/** O que um nó remoto carrega no `meta`. */
export interface NoRemoto {
  readonly remotePath: string;
  readonly kind: 'file' | 'folder' | 'link';
  readonly executable: boolean;
}

export function noRemotoDe(no: TreeNode): NoRemoto | null {
  const meta = no.meta ?? {};
  const caminho = meta.remotePath;
  if (typeof caminho !== 'string') return null;
  const kind = meta.kind;
  return {
    remotePath: caminho,
    kind: kind === 'folder' || kind === 'link' ? kind : 'file',
    executable: meta.executable === true,
  };
}

export interface AcoesRemotas {
  /** O menu do botão direito (AC-9 e AC-10). */
  menu(conexaoId: string, caminho: readonly string[], no: TreeNode): readonly (EntradaDeMenu | null)[];
  /** Favoritar é o mesmo gesto nos dois sentidos (AC-13). */
  favoritar(conexaoId: string, remoto: NoRemoto): Promise<void>;
  /** Baixar um arquivo para a máquina (AC-8 e AC-10). */
  baixar(conexaoId: string, remoto: NoRemoto): Promise<void>;
  executarScript(conexaoId: string, remoto: NoRemoto): Promise<void>;
}

export function useAcoesRemotas(deps: DepsDasAcoesRemotas): AcoesRemotas {
  /** Recarrega o PAI: quem criou, renomeou ou apagou mudou a lista de lá. */
  const recarregarPai = async (
    conexaoId: string,
    caminho: readonly string[]
  ): Promise<void> => {
    await deps.recarregarNo(conexaoId, caminho.slice(0, -1));
  };

  const favoritar = async (conexaoId: string, remoto: NoRemoto): Promise<void> => {
    await Api.alternarFavoritoRemoto(conexaoId, remoto.remotePath);
    // O nó `Favorites` fica na raiz da conexão, então é ele que recarrega.
    await deps.recarregarNo(conexaoId, []);
  };

  const baixar = async (conexaoId: string, remoto: NoRemoto): Promise<void> => {
    if (deps.baixarPeloHost !== undefined) {
      await deps.baixarPeloHost(conexaoId, remoto.remotePath);
      return;
    }
    const { content } = await Api.lerArquivoRemoto(conexaoId, remoto.remotePath);
    // No navegador não se escolhe pasta: ele baixa para a de sempre, que é a
    // única forma que uma IDE em aba tem. Dentro do editor a costura leva ao
    // diálogo nativo, e aí a pasta é escolhida.
    await entregarArquivo(nomeDe(remoto.remotePath), content, 'application/octet-stream');
  };

  const executarScript = async (conexaoId: string, remoto: NoRemoto): Promise<void> => {
    // Lê ANTES de rodar, e mostra: é a decisão D28 inteira. Um clique que roda
    // direto é a diferença entre "conferi" e "torci".
    const { content } = await Api.lerArquivoRemoto(conexaoId, remoto.remotePath);
    if (!(await deps.confirmarScript(nomeDe(remoto.remotePath), content))) return;

    deps.mostrarSaida();
    const r = await Api.executarScriptRemoto(conexaoId, remoto.remotePath);
    if (r.stdout !== '') deps.escreverNaSaida(r.stdout, false);
    if (r.stderr !== '') deps.escreverNaSaida(r.stderr, true);
    if (r.stdout === '' && r.stderr === '') deps.escreverNaSaida('(sem saída)\n', false);
    deps.escreverNaSaida(`\n[${nomeDe(remoto.remotePath)}] saiu com ${r.code}\n`, r.code !== 0);
  };

  const renomear = async (
    conexaoId: string,
    caminho: readonly string[],
    remoto: NoRemoto
  ): Promise<void> => {
    const atual = nomeDe(remoto.remotePath);
    const novo = await deps.pedir({
      titulo: `Renomear "${atual}"`,
      placeholder: 'novo nome',
      valorInicial: atual,
    });
    if (novo === null || novo.trim() === '' || novo.trim() === atual) return;
    await Api.renomearRemoto(
      conexaoId,
      remoto.remotePath,
      `${paiDe(remoto.remotePath)}/${novo.trim()}`
    );
    await recarregarPai(conexaoId, caminho);
  };

  const apagar = async (
    conexaoId: string,
    caminho: readonly string[],
    remoto: NoRemoto
  ): Promise<void> => {
    const nome = nomeDe(remoto.remotePath);
    const ok = await deps.confirmar({
      titulo: 'Apagar no servidor',
      mensagem:
        `Apagar "${nome}" em ${remoto.remotePath}?\n\n` +
        'Isto acontece NO SERVIDOR e não tem desfazer.',
      rotuloConfirmar: 'Apagar',
      destrutivo: true,
    });
    if (!ok) return;
    await Api.apagarRemoto(conexaoId, remoto.remotePath);
    await recarregarPai(conexaoId, caminho);
  };

  const criar = async (
    conexaoId: string,
    caminho: readonly string[],
    remoto: NoRemoto,
    tipo: 'arquivo' | 'pasta'
  ): Promise<void> => {
    const nome = await deps.pedir({
      titulo: tipo === 'pasta' ? 'Nova pasta no servidor' : 'Novo arquivo no servidor',
      placeholder: `nome (em ${remoto.remotePath})`,
    });
    if (nome === null || nome.trim() === '') return;
    const alvo = `${remoto.remotePath}/${nome.trim()}`;
    if (tipo === 'pasta') await Api.criarPastaRemota(conexaoId, alvo);
    else await Api.gravarArquivoRemoto(conexaoId, alvo, '');
    await deps.recarregarNo(conexaoId, caminho);
    if (tipo === 'arquivo') await deps.abrirArquivoRemoto(conexaoId, alvo);
  };

  const menu = (
    conexaoId: string,
    caminho: readonly string[],
    no: TreeNode
  ): readonly (EntradaDeMenu | null)[] => {
    const remoto = noRemotoDe(no);
    if (remoto === null) return [];
    const trancada = deps.somenteLeitura(conexaoId);
    const ehPasta = remoto.kind !== 'file';

    const sempre: (EntradaDeMenu | null)[] = [
      { label: 'Copiar caminho', onClick: () => deps.copiar(remoto.remotePath) },
      { label: 'Copiar nome', onClick: () => deps.copiar(no.label) },
    ];

    if (ehPasta) {
      return [
        ...sempre,
        ...(trancada
          ? []
          : [
              null,
              {
                label: 'Novo arquivo…',
                onClick: () => deps.avisar(criar(conexaoId, caminho, remoto, 'arquivo')),
              },
              {
                label: 'Nova pasta…',
                onClick: () => deps.avisar(criar(conexaoId, caminho, remoto, 'pasta')),
              },
              null,
              {
                label: 'Renomear…',
                onClick: () => deps.avisar(renomear(conexaoId, caminho, remoto)),
              },
              {
                label: 'Apagar',
                danger: true,
                onClick: () => deps.avisar(apagar(conexaoId, caminho, remoto)),
              },
            ]),
      ];
    }

    return [
      ...sempre,
      null,
      { label: 'Baixar', onClick: () => deps.avisar(baixar(conexaoId, remoto)) },
      ...(trancada
        ? []
        : [
            ...(remoto.executable
              ? [
                  {
                    label: 'Executar no servidor…',
                    onClick: () => deps.avisar(executarScript(conexaoId, remoto)),
                  },
                ]
              : []),
            null,
            {
              label: 'Renomear…',
              onClick: () => deps.avisar(renomear(conexaoId, caminho, remoto)),
            },
            {
              label: 'Apagar',
              danger: true,
              onClick: () => deps.avisar(apagar(conexaoId, caminho, remoto)),
            },
          ]),
    ];
  };

  return { menu, favoritar, baixar, executarScript };
}
