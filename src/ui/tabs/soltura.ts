// Onde uma aba (ou um arquivo) cai quando é solta num grupo (spec 012).
//
// Saiu do `useWorkspace` na spec 053, quando o arquivo bateu no teto de 800 do
// Artigo IV. É corte por assunto: "o que soltar significa" não tem nada a ver
// com abrir, salvar e fechar aba.
//
// A regra que mais importa está no fim: **no teto de divisões, soltar na borda
// vira soltar no centro.** Recusar em silêncio deixaria o usuário arrastando de
// novo sem entender por que nada acontece.
import {
  dividir as dividirLayout,
  podeDividir,
  proximoGrupo,
  type Lado,
  type NoDeLayout,
} from '../../shared/layout-editor';
import type { CargaDeArraste, Zona } from '../../shared/arrastar';

export interface DepsDaSoltura {
  /** Move a aba de grupo. */
  mover(id: string, destino: number): void;
  /** Abre um arquivo já num grupo escolhido. */
  abrirNoGrupo(caminho: string, grupo: number): Promise<void>;
  salvarTodosOsGrupos(): void;
  setLayout(atualizar: (atual: NoDeLayout) => NoDeLayout): void;
}

export function soltarNoGrupoCom(deps: DepsDaSoltura) {
  return (grupoAlvo: number, zona: Zona, carga: CargaDeArraste): void => {
    deps.salvarTodosOsGrupos();

    const aplicar = (destino: number): void => {
      if (carga.tipo === 'aba') {
        deps.mover(carga.id, destino);
        return;
      }
      void deps.abrirNoGrupo(carga.caminho, destino);
    };

    if (zona === 'centro') {
      aplicar(grupoAlvo);
      return;
    }

    deps.setLayout((atual) => {
      if (!podeDividir(atual)) {
        aplicar(grupoAlvo);
        return atual;
      }
      const novo = proximoGrupo(atual);
      aplicar(novo);
      return dividirLayout(atual, grupoAlvo, zona as Lado, novo);
    });
  };
}
