// Rodar células do notebook: uma, todas, ou daqui para baixo (spec 112).
//
// Ele pediu blocos que *"rodam em cascata… e o resultado de uma vai para a
// próxima"*. A cascata para na PRIMEIRA célula que falha — a seguinte costuma
// depender dela, e seguir produziria resultado que parece certo e não é (a
// mesma regra do `Run All` do sqlbook).
//
// SQL vai pela rota do KERNEL: o motor roda sem teto e entrega o resultado
// inteiro a CADA linguagem do notebook (spec 113); a tela recebe só a vista.
// Sem kernel, o SQL roda do mesmo jeito e a célula diz que a variável não veio.
//
// A célula de código roda na linguagem DELA; o que as outras linguagens
// mudaram chega antes, pela cascata do motor.
import { useRef, useState, type MutableRefObject } from 'react';
import { ApiDoNotebook } from '../api-notebook';
import type { ControleDosKernels } from './useKernelDoNotebook';
import { instrucoesDoBloco } from '../../shared/sql/instrucoes-do-bloco';
import {
  linguagensDoNotebook, registrarExecucao, type Celula, type Kernel, type Notebook, type Saida,
} from '../../shared/notebook/modelo';

export interface DepsDaExecucao {
  readonly atual: MutableRefObject<Notebook | null>;
  atualizar(fazer: (n: Notebook) => Notebook): void;
  readonly kernel: ControleDosKernels;
  readonly caminho: string | null;
  /** A pasta do projeto: os kernels que o SQL sobe procuram o ambiente até ela. */
  readonly raiz: string | null;
}

export interface ControleDaExecucao {
  /** A célula que está rodando agora, se houver. */
  readonly rodando: string | null;
  rodarCelula(id: string): Promise<boolean>;
  /** A cascata: da célula `indice` até o fim, parando no primeiro erro. */
  rodarDesde(indice: number): Promise<void>;
  /** Interrompe a célula da vez E desiste do resto da cascata. */
  parar(): Promise<void>;
}

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const proximoContador = (n: Notebook) => Math.max(0, ...n.celulas.map((c) => c.contador ?? 0)) + 1;

/** As linguagens que recebem o resultado do SQL: as das células de código. */
function linguagensDoSql(n: Notebook): Kernel[] {
  const usadas = linguagensDoNotebook(n);
  return usadas.length > 0 ? usadas : [n.kernel];
}

export function useExecucaoDoNotebook({ atual, atualizar, kernel, caminho, raiz }: DepsDaExecucao): ControleDaExecucao {
  const [rodando, setRodando] = useState<string | null>(null);
  const desistir = useRef(false);
  /** A linguagem da célula que roda agora: é o kernel dela que o Parar interrompe. */
  const linguagemRodando = useRef<Kernel | null>(null);

  const rodarSql = async (celula: Celula, n: Notebook, contador: number): Promise<boolean> => {
    const vinculo = celula.conexao ?? n.conexao;
    if (vinculo === null || caminho === null) {
      atualizar((x) => registrarExecucao(x, celula.id, contador, [{
        tipo: 'erro',
        mensagem: vinculo === null
          ? 'Escolha a conexão: a do notebook (barra de cima) ou a desta célula.'
          : 'Salve o notebook antes de rodar.',
      }]));
      return false;
    }
    // Os kernels que faltam o MOTOR sobe, um por linguagem do notebook. Se um
    // não subir, o SQL roda mesmo assim — a rota avisa.
    const linguagens = linguagensDoSql(n);
    const saidas: Saida[] = [];
    const { instrucoes, erro } = instrucoesDoBloco(celula.conteudo);
    if (erro !== null) {
      atualizar((x) => registrarExecucao(x, celula.id, contador, [...saidas, { tipo: 'erro', mensagem: erro }]));
      return false;
    }
    let variavel: { nome: string; linhas: number; forma: string; linguagens?: string[] } | null = null;
    let aviso: string | null = null;
    for (const [i, sql] of instrucoes.entries()) {
      const qual = instrucoes.length > 1 ? `Instrução ${i + 1} de ${instrucoes.length}` : 'A consulta';
      try {
        const r = await ApiDoNotebook.sql({
          caminho, connectionId: vinculo.connectionId, database: vinculo.database,
          statement: sql, nome: celula.nome, linguagens, raiz,
        });
        saidas.push(r.tabela ?? { tipo: 'texto', fluxo: 'saida', texto: `${r.mensagem ?? 'Comando executado.'}\n` });
        variavel = r.variavel ?? variavel;
        aviso = r.aviso ?? aviso;
      } catch (e) {
        saidas.push({ tipo: 'erro', mensagem: `${qual} falhou: ${mensagemDe(e)}` });
        atualizar((x) => registrarExecucao(x, celula.id, contador, saidas));
        return false;
      }
    }
    // Dizer o que virou variável é o que liga esta célula à próxima.
    if (variavel !== null) {
      const onde = (variavel.linguagens ?? []).length > 1 ? ` (${(variavel.linguagens ?? []).join(', ')})` : '';
      saidas.push({
        tipo: 'texto', fluxo: 'saida',
        texto: `→ ${variavel.nome}: ${variavel.forma === 'DataFrame' ? 'DataFrame' : 'lista'} com ${variavel.linhas} linha(s)${onde}\n`,
      });
    }
    if (aviso !== null) saidas.push({ tipo: 'texto', fluxo: 'erro', texto: `${aviso}\n` });
    atualizar((x) => registrarExecucao(x, celula.id, contador, saidas));
    // O motor pode ter subido kernels para entregar o resultado: a barra relê.
    void kernel.atualizar();
    return true;
  };

  const rodarCodigo = async (celula: Celula, n: Notebook, contador: number): Promise<boolean> => {
    const linguagem = celula.linguagem ?? n.kernel;
    linguagemRodando.current = linguagem;
    const r = await kernel.executar(
      linguagem,
      celula.conteudo,
      (parciais) => atualizar((x) => registrarExecucao(x, celula.id, contador, parciais)),
      n.conexao
    );
    atualizar((x) => registrarExecucao(x, celula.id, contador, r.saidas));
    return r.ok;
  };

  const rodarCelula = async (id: string): Promise<boolean> => {
    const n = atual.current;
    const celula = n?.celulas.find((c) => c.id === id);
    if (n === null || n === undefined || celula === undefined) return false;
    if (celula.tipo === 'markdown') return true;
    // Célula vazia não é falha: a cascata passa por ela.
    if (celula.conteudo.trim() === '') return true;
    setRodando(id);
    try {
      const contador = proximoContador(n);
      return celula.tipo === 'sql' ? await rodarSql(celula, n, contador) : await rodarCodigo(celula, n, contador);
    } finally {
      linguagemRodando.current = null;
      setRodando(null);
    }
  };

  const rodarDesde = async (indice: number): Promise<void> => {
    desistir.current = false;
    const ids = (atual.current?.celulas ?? []).slice(indice).map((c) => c.id);
    for (const id of ids) {
      if (desistir.current) return;
      if (!(await rodarCelula(id))) return;
    }
  };

  const parar = async (): Promise<void> => {
    desistir.current = true;
    const linguagem = linguagemRodando.current;
    if (linguagem !== null) await kernel.interromper(linguagem);
  };

  return { rodando, rodarCelula, rodarDesde, parar };
}
