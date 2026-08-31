// As aberturas que passam pela entrada rápida.
//
// Saiu do `App` quando ele passou do teto de 800 linhas do Artigo IV ao ganhar
// o menu da árvore (T043). O corte é por assunto: *"o que a entrada rápida abre
// ou escolhe"* — arquivo, preferências e tema —, e o `App` fica só com a
// montagem da tela.
import { Api } from '../api';
import { acharArquivos, nomeDe } from '../../shared/busca-de-arquivo';
import { iconeDeArquivo } from '../../shared/editor/arquivos';
import { NOMES_DE_TEMA, ROTULO_DO_TEMA, type NomeDoTema } from '../../shared/temas';
import type { OpcaoRapida } from '../QuickInput';
import type { QuickInputController } from '../useQuickInput';

export interface AberturasDeps {
  readonly qi: QuickInputController;
  abrirArquivo(caminho: string): Promise<void>;
  readonly tema: NomeDoTema;
  definirTema(nome: NomeDoTema): Promise<void>;
  /** A pasta aberta; `''` quando não há nenhuma. */
  readonly pasta: string;
  /** Caminhos absolutos abertos recentemente, do mais para o menos recente. */
  readonly recentes: readonly string[];
  avisar(mensagem: string, titulo?: string): Promise<void>;
}

export interface Aberturas {
  abrirPreferencias(): Promise<void>;
  /** `File → Open File…`: caminho absoluto, digitado. */
  abrirPorCaminho(): Promise<void>;
  /** `Ctrl+P`: acha pelo nome, com os recentes no topo (T051). */
  irParaArquivo(): Promise<void>;
  escolherTema(): Promise<void>;
}

export function useAberturas(deps: AberturasDeps): Aberturas {
  const { qi, abrirArquivo, tema, definirTema } = deps;
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

  /**
   * `Ctrl+P`: acha um arquivo pelo nome (T051).
   *
   * O que existia antes pedia **caminho absoluto**, digitado inteiro — isso não
   * é achar arquivo, é ter que saber onde ele está. `File → Open File…` ficou
   * com aquele comportamento, que continua servindo para abrir algo de fora da
   * pasta; `Ctrl+P` passou a ser o que o nome promete.
   *
   * A lista inteira vem de UMA vez e o filtro roda no navegador. Uma ida ao
   * servidor por tecla daria latência em cima do que precisa ser instantâneo, e
   * o teto de varredura já limita o tamanho disso.
   */
  const irParaArquivo = async (): Promise<void> => {
    if (deps.pasta === '') {
      await deps.avisar('Abra uma pasta antes de procurar um arquivo.', 'Ir para arquivo');
      return;
    }
    const { files, truncated } = await Api.workspaceFiles();
    if (files.length === 0) {
      await deps.avisar('Esta pasta não tem arquivos para abrir.', 'Ir para arquivo');
      return;
    }

    // A busca trabalha no RÓTULO — que com mais de uma raiz já traz o nome dela
    // (T004) —, e o valor escolhido é o caminho absoluto. Casar por rótulo é o
    // que faz `web/index` achar o certo entre dois `index.ts`.
    const porRotulo = new Map(files.map((f) => [f.label, f.path]));
    const rotulos = files.map((f) => f.label);
    const recentes = files.filter((f) => deps.recentes.includes(f.path)).map((f) => f.label);
    // Na ordem em que ele os abriu, e não na do disco.
    recentes.sort((a, b) => {
      const pa = deps.recentes.indexOf(porRotulo.get(a) ?? '');
      const pb = deps.recentes.indexOf(porRotulo.get(b) ?? '');
      return pa - pb;
    });

    // A ordem inicial já é a dos recentes: com o campo vazio, `Enter` volta ao
    // arquivo anterior sem digitar nada.
    const ordenados = acharArquivos(rotulos, '', { recentes, max: rotulos.length });
    const opcoes: OpcaoRapida[] = ordenados.map((rotulo) => ({
      valor: rotulo,
      rotulo: nomeDe(rotulo),
      // A pasta vai no detalhe, e não no rótulo: dois `index.ts` só se
      // distinguem por ela, e o rótulo em negrito fica legível.
      detalhe: rotulo.includes('/') ? rotulo.slice(0, rotulo.lastIndexOf('/')) : undefined,
      icone: iconeDeArquivo(rotulo, 'plain'),
      ...(recentes.includes(rotulo) ? { sufixo: 'recente' } : {}),
    }));

    const escolhido = await qi.pedir({
      titulo: 'Ir para arquivo',
      placeholder: truncated
        ? 'Nome do arquivo — a lista foi cortada pelo teto de varredura'
        : 'Nome do arquivo',
      opcoes,
      // O filtro é NOSSO: o padrão da entrada rápida é "contém", que não acha
      // `usa-lib.ts` a partir de `usli` nem sabe ordenar por qualidade.
      filtrar: (todas, texto) => {
        const achados = acharArquivos(
          todas.map((o) => o.valor),
          texto,
          { recentes }
        );
        const porValor = new Map(todas.map((o) => [o.valor, o]));
        return achados
          .map((v) => porValor.get(v))
          .filter((o): o is OpcaoRapida => o !== undefined);
      },
    });
    const caminho = escolhido === null ? undefined : porRotulo.get(escolhido);
    if (caminho !== undefined) await abrirArquivo(caminho);
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

  return { abrirPreferencias, abrirPorCaminho, irParaArquivo, escolherTema };
}
