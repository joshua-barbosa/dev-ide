// Reabrir as abas de uma sessão guardada (spec 029, T028).
//
// Saiu de `useWorkspace` quando ele passou do teto de 800 linhas do Artigo IV
// ao ganhar as abas gêmeas. O corte é por assunto: aqui mora tudo que sabe
// **remontar** a tela a partir do que foi gravado, e o resto do arquivo fala de
// abrir, salvar e fechar no dia a dia.
//
// A regra que este arquivo existe para cumprir: **o que não abriu não pode
// deixar meia tela em branco.** Um arquivo apagado com a IDE fechada some em
// silêncio, e `conciliar` acerta o arranjo com o que sobrou.
import { conciliar, type SessaoDeAbas, type VistaSalva } from '../../shared/sessao-abas';
import { proximaCopia } from '../../shared/abas-gemeas';
import type { NoDeLayout } from '../../shared/layout-editor';
import type { Tab, TabStore } from '../../shared/tabs';

export interface DepsDaRestauracao {
  readonly store: TabStore;
  /** Abre um arquivo no grupo em foco. Estoura se ele não existe mais. */
  abrirArquivo(caminho: string): Promise<void>;
  /** O caminho em disco de uma aba, ou `null` quando ela não é de arquivo. */
  caminhoDaAba(aba: Tab): string | null;
  setLayout(layout: NoDeLayout): void;
  /** Marca a vista a aplicar quando o arquivo carregar (T036). */
  vistaAoCarregar(caminho: string, vista: VistaSalva): void;
}

export function restaurarSessaoCom(deps: DepsDaRestauracao) {
  const { store, abrirArquivo, caminhoDaAba, setLayout } = deps;

  const idsAgora = (): string[] => store.list().map((t) => t.id);

  /**
   * Garante uma vista deste arquivo NESTE grupo.
   *
   * Três casos, e o terceiro é o que o T028 acrescentou: o arquivo já está
   * aberto, mas do outro lado. Antes isso virava um `mover` — a sessão com o
   * mesmo arquivo dos dois lados voltava com ele de um só. Agora vira a segunda
   * vista, que é o que estava na tela quando se fechou.
   */
  async function garantirVista(caminho: string, grupo: number): Promise<void> {
    const doArquivo = store.list().filter((t) => caminhoDaAba(t) === caminho);
    const daqui = doArquivo.find((t) => t.grupo === grupo);
    if (daqui !== undefined) {
      store.activate(daqui.id);
      return;
    }
    const original = doArquivo[0];
    if (original === undefined) {
      store.focarGrupo(grupo);
      await abrirArquivo(caminho);
      return;
    }
    store.open({ ...original, id: proximaCopia(idsAgora(), original.id), grupo });
  }

  return async (sessao: SessaoDeAbas): Promise<void> => {
    const abertos = new Set<string>();
    for (const aba of sessao.abas) {
      try {
        // ANTES de abrir: o efeito que carrega o editor roda entre um `await` e
        // o seguinte, e depois de abrir já é tarde — a aba entrou na linha 1.
        if (aba.view !== undefined) deps.vistaAoCarregar(aba.caminho, aba.view);
        await garantirVista(aba.caminho, aba.grupo);
        abertos.add(aba.caminho);
      } catch {
        // sumiu do disco enquanto a IDE estava fechada
      }
    }
    if (abertos.size === 0) return;

    const final = conciliar(sessao, abertos);

    // Aba num grupo que o arranjo não tem ficaria invisível para sempre. Com
    // gêmeas, casar por caminho não basta — são duas abas do mesmo caminho —,
    // então cada entrada consome uma vista, na ordem.
    const usados = new Set<string>();
    for (const aba of final.abas) {
      const alvo = store
        .list()
        .find((t) => !usados.has(t.id) && caminhoDaAba(t) === aba.caminho);
      if (alvo === undefined) continue;
      usados.add(alvo.id);
      if (alvo.grupo !== aba.grupo) store.mover(alvo.id, aba.grupo);
    }

    setLayout(final.layout);
    for (const [grupo, caminho] of Object.entries(final.ativas)) {
      const alvo = store
        .list()
        .find((t) => String(t.grupo) === grupo && caminhoDaAba(t) === caminho);
      if (alvo !== undefined) store.activate(alvo.id);
    }
    store.focarGrupo(final.grupoFocado);
  };
}
