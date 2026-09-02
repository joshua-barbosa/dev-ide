// A ponte entre a janela e o sistema (T003, T099).
//
// **`contextBridge`, e nunca `nodeIntegration`.** A interface é a MESMA que roda
// no navegador; se ela ganhasse `require` aqui, um dia alguém acrescentaria uma
// chamada de `fs` num componente e a versão web quebraria — ou, pior, um trecho
// de markdown com script alcançaria o disco. A ponte expõe funções nomeadas, e
// só elas atravessam.
//
// O que está aqui é o que o navegador NÃO consegue fazer:
//
// - o diálogo NATIVO de pasta (T003), porque o navegador não dá caminho de
//   verdade — só um punhado de arquivos, sem o caminho da pasta;
// - o chaveiro do sistema (T099), que não existe numa aba.
//
// Tudo o mais continua indo pelo mesmo HTTP dos dois modos.
import { contextBridge, ipcRenderer } from 'electron';

/** O que a interface enxerga. `undefined` no navegador — e ela testa isso. */
export interface PonteDoDesktop {
  readonly ehDesktop: true;
  /** Abre o diálogo do sistema. `null` quando ele cancela. */
  escolherPasta(titulo: string): Promise<string | null>;
  /** Se este sistema tem chaveiro utilizável agora. */
  chaveiroDisponivel(): Promise<boolean>;
}

const ponte: PonteDoDesktop = {
  ehDesktop: true,
  escolherPasta: (titulo) => ipcRenderer.invoke('dev-ide:escolher-pasta', titulo),
  chaveiroDisponivel: () => ipcRenderer.invoke('dev-ide:chaveiro-disponivel'),
};

contextBridge.exposeInMainWorld('devIde', ponte);
