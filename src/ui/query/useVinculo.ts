// Contra quem cada arquivo `.sql` roda.
//
// A regra de precedência é o coração da spec 038, e tem três degraus:
//
// 1. **o caminho** — arquivo sob `query/<conexão>@<database>/` já diz tudo, e
//    perguntar seria insultuoso;
// 2. **a lembrança** — `.sql` do projeto que o usuário já escolheu uma vez;
// 3. **a pergunta** — e a resposta vira lembrança.
//
// O que NÃO existe é um quarto degrau chamado "a conexão que estava aberta na
// árvore". Era o comportamento anterior (`conexaoAtiva`), e é justamente o que
// faz uma query rodar no banco errado sem dar erro.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../api';
import { mesmoVinculo, vinculoDoCaminho, type Vinculo } from '../../shared/sql/vinculo';
import type { PublicConnection } from '../../shared/contracts';
import type { QuickInputController } from '../useQuickInput';

export interface ControleDeVinculo {
  /** O vínculo de um arquivo, sem perguntar nada. `null` quando não há. */
  vinculoDe(caminho: string | null): Vinculo | null;
  /** O vínculo, perguntando se preciso. `null` quando o usuário desiste. */
  garantir(caminho: string | null): Promise<Vinculo | null>;
  /** Sempre pergunta, mesmo havendo vínculo. É o clique na barra de status. */
  trocar(caminho: string): Promise<Vinculo | null>;
  /** Recarrega as lembranças do servidor. */
  recarregar(): Promise<void>;
  /** Muda a cada alteração, para quem precisa repintar. */
  readonly versao: number;
}

export interface DepsDeVinculo {
  readonly qi: QuickInputController;
  /** As conexões cadastradas, para a lista de escolha. */
  conexoes(): readonly PublicConnection[];
  /** Garante o cofre destrancado antes de tocar numa conexão. */
  garantirDestrancado(): Promise<boolean>;
}

export function useVinculo(deps: DepsDeVinculo): ControleDeVinculo {
  const { qi } = deps;
  // A verdade mora em refs porque `garantir` é chamado de dentro de um comando e
  // precisa ler o valor de AGORA — não o da renderização em que o callback
  // nasceu. É a mesma lição do histórico da spec 016 e da zona de soltura da 025.
  const raiz = useRef<string>('');
  const lembrados = useRef<Record<string, Vinculo>>({});
  const [versao, setVersao] = useState(0);

  const recarregar = useCallback(async (): Promise<void> => {
    try {
      const dados = await Api.listLinks();
      raiz.current = dados.raiz;
      lembrados.current = dados.links;
      setVersao((v) => v + 1);
    } catch {
      // Sem lembranças a IDE ainda funciona: ela apenas pergunta mais vezes.
      // Falhar aqui impediria de abrir qualquer arquivo.
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const vinculoDe = useCallback((caminho: string | null): Vinculo | null => {
    if (caminho === null || caminho === '') return null;
    return vinculoDoCaminho(raiz.current, caminho) ?? lembrados.current[caminho] ?? null;
  }, []);

  /** Pergunta a conexão e depois o database. `null` em qualquer desistência. */
  const perguntar = useCallback(async (atual: Vinculo | null): Promise<Vinculo | null> => {
    const conexoes = deps.conexoes();
    if (conexoes.length === 0) {
      // Sem conexão cadastrada, a pergunta não teria resposta possível.
      throw new Error('Nenhuma conexão cadastrada. Crie uma no painel Database.');
    }

    const escolhida = await qi.pedir({
      titulo: 'Executar contra qual conexão?',
      placeholder: 'Escolha a conexão',
      opcoes: conexoes.map((c) => ({
        valor: c.id,
        rotulo: c.label,
        detalhe: c.group === '' ? c.type : `${c.group} · ${c.type}`,
      })),
      valorInicial: atual?.connectionId ?? '',
    });
    if (escolhida === null) return null;
    if (!(await deps.garantirDestrancado())) return null;

    // A lista de databases vem do DRIVER, viva — não de um cache nosso, que
    // ficaria velho no dia em que o usuário criasse um banco.
    const nos = await Api.children(escolhida, ['server']);
    const bancos = nos.filter((n) => typeof n.meta?.database === 'string');
    if (bancos.length === 0) {
      throw new Error('Esta conexão não expôs nenhum database.');
    }
    if (bancos.length === 1) {
      // Um só: perguntar seria um diálogo com uma opção. O SQLite cai aqui.
      return { connectionId: escolhida, database: String(bancos[0]?.meta?.database) };
    }

    const banco = await qi.pedir({
      titulo: 'Em qual database?',
      placeholder: 'Escolha o database',
      opcoes: bancos.map((n) => ({
        valor: String(n.meta?.database),
        rotulo: n.label,
        detalhe: n.detail,
      })),
      valorInicial: atual?.database ?? '',
    });
    return banco === null ? null : { connectionId: escolhida, database: banco };
  }, [deps, qi]);

  const lembrar = useCallback(async (caminho: string, vinculo: Vinculo): Promise<void> => {
    // Arquivo cujo vínculo vem do CAMINHO não é lembrado: o caminho já é a
    // verdade, e guardar a segunda cópia é como as duas divergem.
    if (vinculoDoCaminho(raiz.current, caminho) !== null) return;
    lembrados.current = { ...lembrados.current, [caminho]: vinculo };
    setVersao((v) => v + 1);
    await Api.rememberLink(caminho, vinculo);
  }, []);

  const garantir = useCallback(async (caminho: string | null): Promise<Vinculo | null> => {
    const atual = vinculoDe(caminho);
    if (atual !== null) return atual;
    if (caminho === null || caminho === '') {
      // Arquivo sem título: dá para escolher, mas não há onde lembrar.
      return perguntar(null);
    }
    const escolhido = await perguntar(null);
    if (escolhido !== null) await lembrar(caminho, escolhido);
    return escolhido;
  }, [lembrar, perguntar, vinculoDe]);

  const trocar = useCallback(async (caminho: string): Promise<Vinculo | null> => {
    const atual = vinculoDe(caminho);
    const escolhido = await perguntar(atual);
    if (escolhido === null || mesmoVinculo(escolhido, atual)) return atual;
    await lembrar(caminho, escolhido);
    return escolhido;
  }, [lembrar, perguntar, vinculoDe]);

  return { vinculoDe, garantir, trocar, recarregar, versao };
}
