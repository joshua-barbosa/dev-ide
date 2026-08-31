// O que acontece com as abas quando o DISCO muda por baixo delas.
//
// Duas famílias de mudança, e as duas moram aqui porque fazem a mesma pergunta
// — *que abas isto afeta, e o que elas viram?*:
//
// - **a árvore renomeia ou apaga** (T043). Sem isto, renomear deixaria a aba
//   apontando para um caminho que não existe mais, e `Ctrl+S` recriaria o
//   arquivo com o nome antigo — desfazendo o renomear em silêncio.
// - **o vigia de disco avisa** (spec 037, T047). Aqui está a decisão que o
//   T047 acrescentou: **comparar o conteúdo antes de avisar**.
//
// A aritmética de caminho está em `shared/nome-de-copia.ts`, testada sem
// navegador. Aqui só o que mexe no store e no editor.
import { Api } from '../api';
import { caminhoRenomeado } from '../../shared/nome-de-copia';
import type { EditorHandle } from '../editor/EditorHost';
import type { Tab, TabStore } from '../../shared/tabs';

export interface DepsDasAbasDoDisco {
  readonly store: TabStore;
  /** O caminho em disco de uma aba, ou `null` quando ela não é de arquivo. */
  caminhoDaAba(aba: Tab): string | null;
  /** Troca o id e o caminho de uma aba, preservando o conteúdo dela. */
  adotar(idAntigo: string, caminho: string): void;
  /** O que está no `meta` de uma aba. */
  metaDaAba(aba: Tab): Record<string, unknown>;
  editorDoGrupo(grupo: number): EditorHandle | null;
  /** A aba que está carregada num grupo agora. */
  abaCarregada(grupo: number): string | null;
  /** Roda `fn` sem que a mudança conte como edição do usuário. */
  semSujar(fn: () => void): void;
  aoEntrarEmConflito(ids: readonly string[]): void;
}

export function abasDoDisco(deps: DepsDasAbasDoDisco) {
  const { store, caminhoDaAba, adotar, metaDaAba } = deps;

  /** Todas as abas de um caminho — com o T028, podem ser duas. */
  const abasDe = (caminho: string): Tab[] =>
    store.list().filter((aba) => caminhoDaAba(aba) === caminho);

  /**
   * O que a aba mostra AGORA.
   *
   * O `meta.content` só é atualizado ao trocar de aba, então para a que está na
   * tela ele é a versão de antes da última tecla.
   */
  const conteudoNaTela = (aba: Tab): string => {
    if (deps.abaCarregada(aba.grupo) === aba.id) {
      const editor = deps.editorDoGrupo(aba.grupo);
      if (editor !== null) return editor.getValue();
    }
    return String(metaDaAba(aba).content ?? '');
  };

  /**
   * A versão EM DISCO em que a aba se baseia — a régua do T047.
   *
   * **Não é o que está na tela**, e a diferença é o item inteiro. Com trabalho
   * não salvo, a tela SEMPRE difere do disco; comparar com ela daria conflito
   * em toda gravação externa, inclusive na que não mudou byte nenhum. Comparar
   * com a versão base responde a pergunta certa: *mudou alguma coisa que eu vá
   * perder?*
   *
   * Sem a marca — aba que nunca veio do disco —, cai no que está na tela, que
   * é o comportamento de antes desta spec.
   */
  const versaoBase = (aba: Tab): string => {
    const marca = metaDaAba(aba).emDisco;
    return typeof marca === 'string' ? marca : conteudoNaTela(aba);
  };

  /**
   * Fecha as abas de um item apagado — o próprio, ou tudo dentro dele.
   *
   * `store.close` e não `fechar`: quem apagou já confirmou, e perguntar sobre
   * alteração não salva num arquivo que acabou de sumir não daria escolha
   * nenhuma a quem responde.
   */
  const fecharPorCaminho = (caminho: string): void => {
    for (const aba of store.list()) {
      const meu = caminhoDaAba(aba);
      if (meu === null) continue;
      if (meu === caminho || meu.startsWith(`${caminho}/`)) store.close(aba.id);
    }
  };

  /**
   * Leva as abas junto com o item renomeado.
   *
   * Vale para pasta também: renomear `src` move todas as abas de dentro dela.
   * A lista é tirada ANTES do laço porque `adotar` fecha e reabre a aba, o que
   * mexeria na coleção sendo percorrida.
   */
  const renomearPorCaminho = (de: string, para: string): void => {
    const afetadas = store
      .list()
      .map((aba) => ({ id: aba.id, novo: caminhoRenomeado(caminhoDaAba(aba) ?? '', de, para) }))
      .filter((a): a is { id: string; novo: string } => a.novo !== null);
    for (const { id, novo } of afetadas) adotar(id, novo);
  };

  /**
   * Põe na aba o texto que está em disco.
   *
   * Substituir em arquivos reescreve o disco POR BAIXO do editor. Sem isto a
   * aba aberta segue mostrando o texto de antes — e salvá-la depois desfaz a
   * substituição em silêncio, que é o pior desfecho possível: o usuário viu
   * "3 arquivos alterados" e o arquivo voltou ao que era.
   */
  const aplicarConteudo = (caminho: string, conteudo: string): void => {
    for (const aba of abasDe(caminho)) {
      store.update(aba.id, {
        dirty: false,
        meta: { ...metaDaAba(aba), content: conteudo, emDisco: conteudo, view: null },
      });
      // O efeito de carregar não vai reagir: para ele esta aba já é a ativa do
      // grupo. Quem está na tela precisa ser trocado aqui.
      if (deps.abaCarregada(aba.grupo) !== aba.id) continue;
      const editor = deps.editorDoGrupo(aba.grupo);
      if (editor === null) continue;
      deps.semSujar(() => editor.setValue(conteudo));
    }
  };

  const recarregarDoDisco = async (caminhos: readonly string[]): Promise<void> => {
    for (const caminho of caminhos) {
      if (abasDe(caminho).length === 0) continue;
      const dados = await Api.readFile(caminho);
      aplicarConteudo(caminho, dados.content);
    }
  };

  /**
   * Reage ao vigia de disco, comparando o CONTEÚDO (T047).
   *
   * A desculpa que eu tinha escrito era *"o `mtime` é o bastante"*. Não é: o
   * `mtime` muda quando um formatador salva o mesmo texto, quando o git troca
   * de ramo e volta, quando o `touch` de um build passa por cima. Nesses casos
   * o aviso é falso — e um aviso falso repetido ensina a ignorar o verdadeiro.
   *
   * Comparar custa uma leitura que já era feita: quem recarrega precisava do
   * conteúdo de qualquer jeito.
   *
   * Devolve os títulos das abas que ficaram em conflito.
   */
  const sincronizarComDisco = async (
    caminhos: readonly string[]
  ): Promise<readonly string[]> => {
    const emConflito: string[] = [];
    const idsEmConflito: string[] = [];

    for (const caminho of caminhos) {
      const abas = abasDe(caminho);
      if (abas.length === 0) continue;

      let doDisco: string;
      try {
        doDisco = (await Api.readFile(caminho)).content;
      } catch {
        // Ilegível agora — apagado entre o aviso e a leitura, sem permissão.
        // Não é conflito: não há duas versões, há uma inacessível.
        continue;
      }

      // Igual à versão base: o arquivo foi reescrito com os mesmos bytes, e
      // não há nada de ninguém para perder. Nem aviso, nem `setValue` — que
      // jogaria fora o histórico de desfazer de quem está trabalhando.
      if (abas.every((aba) => versaoBase(aba) === doDisco)) continue;

      const suja = abas.find((aba) => aba.dirty);
      if (suja !== undefined) {
        emConflito.push(suja.title);
        for (const aba of abas) idsEmConflito.push(aba.id);
        continue;
      }
      // A aba sem alteração pode ser trocada sem perguntar nada: não há duas
      // versões, há uma só, e ela está no disco.
      aplicarConteudo(caminho, doDisco);
    }

    if (idsEmConflito.length > 0) deps.aoEntrarEmConflito(idsEmConflito);
    return emConflito;
  };

  return {
    fecharPorCaminho,
    renomearPorCaminho,
    recarregarDoDisco,
    sincronizarComDisco,
  };
}
