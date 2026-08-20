// Escuta o vigia de disco e reage (spec 037).
//
// Três consequências, e a ordem importa:
//   1. a árvore recarrega as pastas afetadas que estão abertas;
//   2. a aba SEM alteração recebe o texto novo, calada;
//   3. a aba COM alteração vira conflito, e ninguém decide por ela.
import { useEffect, useRef } from 'react';
import type { PastaAberta } from './files/usePasta';
import type { Workspace } from './useWorkspace';

interface Mudanca {
  readonly caminho: string;
  readonly tipo: 'criado' | 'alterado' | 'removido';
  readonly pasta: string;
}

type Aviso = { tipo: 'mudou'; mudancas: readonly Mudanca[] } | { tipo: 'lotou' };

/** Espera antes de tentar de novo, quando o canal cai. */
const RETENTATIVA_MS = 2_000;

export interface VigiaDeps {
  readonly ws: Workspace;
  readonly pasta: PastaAberta;
  /** Vai para o painel `Problems` — é onde o usuário procura o que deu errado. */
  readonly aoAvisar: (mensagem: string) => void;
  readonly aoFalhar: (erro: unknown) => void;
}

export function useVigia({ ws, pasta, aoAvisar, aoFalhar }: VigiaDeps): void {
  // Tudo por ref: o efeito precisa rodar UMA vez por pasta, e depender das
  // funções o reconectaria a cada render — derrubando o canal sem parar.
  const atual = useRef({ ws, aoAvisar, aoFalhar });
  atual.current = { ws, aoAvisar, aoFalhar };
  const carregadas = useRef<ReadonlySet<string>>(new Set());

  // Quais pastas estão à vista agora, para só recarregar essas.
  const arvore = pasta.arvore;
  useEffect(() => {
    const abertas = new Set<string>();
    const andar = (nos: typeof arvore): void => {
      for (const no of nos) {
        if (no.type !== 'dir' || no.children === undefined) continue;
        abertas.add(no.path);
        andar(no.children);
      }
    };
    andar(arvore);
    if (pasta.pasta !== '') abertas.add(pasta.pasta);
    carregadas.current = abertas;
  }, [arvore, pasta.pasta]);

  const carregarFilhos = pasta.carregarFilhos;
  const raiz = pasta.pasta;

  useEffect(() => {
    if (raiz === '') return;

    let vivo = true;
    let socket: WebSocket | null = null;
    let reconectar: number | null = null;

    const tratar = (aviso: Aviso): void => {
      if (aviso.tipo === 'lotou') {
        atual.current.aoAvisar(
          'Esta pasta tem subpastas demais para vigiar por inteiro. ' +
            'Parte dela não será atualizada sozinha — use Recarregar na árvore.'
        );
        return;
      }

      const pastas = new Set(aviso.mudancas.map((m) => m.pasta));
      for (const dir of pastas) {
        if (carregadas.current.has(dir)) carregarFilhos(dir).catch(atual.current.aoFalhar);
      }

      const arquivos = aviso.mudancas.filter((m) => m.tipo !== 'removido').map((m) => m.caminho);
      if (arquivos.length === 0) return;
      atual.current.ws
        .sincronizarComDisco(arquivos)
        .then((emConflito) => {
          if (emConflito.length === 0) return;
          atual.current.aoAvisar(
            `${emConflito.join(', ')} mudou em disco e tem alterações não salvas aqui. ` +
              'Salvar vai pedir confirmação antes de sobrescrever.'
          );
        })
        .catch(atual.current.aoFalhar);
    };

    const conectar = (): void => {
      if (!vivo) return;
      const protocolo = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocolo}://${window.location.host}/api/watch`);

      socket.onmessage = (evento) => {
        try {
          tratar(JSON.parse(String(evento.data)) as Aviso);
        } catch {
          // Mensagem estragada não pode derrubar a IDE.
        }
      };
      // Reconecta calado: o servidor reinicia durante o desenvolvimento, e uma
      // caixa de erro a cada `npm run build` seria insuportável.
      socket.onclose = () => {
        if (vivo) reconectar = window.setTimeout(conectar, RETENTATIVA_MS);
      };
    };

    conectar();
    return () => {
      vivo = false;
      if (reconectar !== null) window.clearTimeout(reconectar);
      if (socket !== null) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [carregarFilhos, raiz]);
}
