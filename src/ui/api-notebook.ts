// As chamadas do kernel do notebook (spec 112, etapa 2).
//
// Arquivo próprio: o `api.ts` passou do teto de 800 linhas do Artigo IV, e o
// notebook é um assunto inteiro — o corte é o natural. O transporte é o MESMO
// (`request`): na extensão ele passa pela ponte do editor sem ninguém aqui
// precisar saber.
import { request } from './api-http';
import type { Saida } from '../shared/notebook/modelo';

/** O kernel de um notebook, como a rota o descreve (spec 112). */
export interface EstadoDoKernel {
  readonly linguagem: string;
  /** python | node | php — JS e TS dividem o Node. */
  readonly familia: 'python' | 'node' | 'php';
  readonly ocupado: boolean;
  readonly versao: string;
  readonly executavel: string;
  readonly pandas: boolean;
  readonly interpretador: Interpretador;
  readonly candidatos: readonly Interpretador[];
  /** PHP: há Laravel no projeto, e ele está ligado neste kernel? */
  readonly laravelDisponivel: boolean;
  readonly laravel: boolean;
  /** JS/TS: de onde vêm os `node_modules`, e as pastas que dá para escolher. */
  readonly pacotes: PastaDePacotes | null;
  readonly candidatosDePacotes: readonly PastaDePacotes[];
}

export interface PastaDePacotes {
  readonly caminho: string;
  readonly rotulo: string;
}

export interface Interpretador {
  readonly caminho: string;
  readonly origem: string;
  readonly rotulo: string;
}

/** O que dá para escolher, sem subir o kernel. */
export interface AmbienteDoKernel {
  readonly candidatos: readonly Interpretador[];
  readonly candidatosDePacotes: readonly PastaDePacotes[];
}

const q = encodeURIComponent;

export const ApiDoNotebook = {
  /** Um kernel por FAMÍLIA (spec 113): a linguagem diz qual. */
  kernel: (caminho: string, linguagem: string) =>
    request<EstadoDoKernel | null>('GET', `/api/notebook/kernel?caminho=${q(caminho)}&linguagem=${q(linguagem)}`),
  /** Todos os kernels vivos do notebook — para reencontrá-los depois de um F5. */
  kernels: (caminho: string) => request<EstadoDoKernel[]>('GET', `/api/notebook/kernels?caminho=${q(caminho)}`),
  ambiente: (caminho: string, linguagem: string, raiz: string | null) =>
    request<AmbienteDoKernel>(
      'GET',
      `/api/notebook/ambiente?caminho=${q(caminho)}&linguagem=${q(linguagem)}&raiz=${q(raiz ?? '')}`
    ),
  iniciar: (p: {
    caminho: string; linguagem: string; raiz: string | null; interpretador?: string; laravel?: boolean;
    pacotes?: string;
  }) =>
    request<EstadoDoKernel>('POST', '/api/notebook/kernel', p),
  /** `conexao`: a do notebook — é por ela que o sql() da célula fala com o banco (spec 114). */
  executar: (caminho: string, linguagem: string, codigo: string, conexao: { connectionId: string; database: string } | null) =>
    request<{ exec: number }>('POST', '/api/notebook/kernel/executar', { caminho, linguagem, codigo, conexao }),
  execucao: (caminho: string, linguagem: string, exec: number, desde: number) =>
    request<{ inicio: number; saidas: Saida[]; terminou: boolean; ok: boolean }>(
      'GET',
      `/api/notebook/kernel/execucao?caminho=${q(caminho)}&linguagem=${q(linguagem)}&exec=${exec}&desde=${desde}`
    ),
  interromper: (caminho: string, linguagem: string) =>
    request<null>('POST', '/api/notebook/kernel/interromper', { caminho, linguagem }),
  reiniciar: (caminho: string, linguagem: string) =>
    request<EstadoDoKernel | null>('POST', '/api/notebook/kernel/reiniciar', { caminho, linguagem }),
  reiniciarTodos: (caminho: string) =>
    request<EstadoDoKernel[]>('POST', '/api/notebook/kernel/reiniciar', { caminho }),
  encerrar: (caminho: string) =>
    request<null>('POST', '/api/notebook/kernel/encerrar', { caminho }),
  sql: (p: {
    caminho: string; connectionId: string; database: string; statement: string; nome: string | null;
    /** As linguagens do notebook: o resultado vai para cada uma (spec 113). */
    linguagens: readonly string[];
    raiz: string | null;
    /** "Para cada": o nome da lista — roda uma vez por item (spec 114, B). */
    paraCada?: string | null;
  }) =>
    request<{
      tabela: Saida | null;
      mensagem?: string;
      variavel: { nome: string; linhas: number; forma: string; linguagens?: string[] } | null;
      aviso?: string | null;
      paraCada?: {
        total: number; comandos: number; escritas: number; linhasAfetadas: number | null;
        falha: { item: number; mensagem: string } | null; parado: boolean;
      };
    }>('POST', '/api/notebook/kernel/sql', p),
  progressoDoSql: (caminho: string) =>
    request<{ feitos: number; total: number } | null>('GET', `/api/notebook/kernel/sql/progresso?caminho=${q(caminho)}`),
  pararSql: (caminho: string) => request<null>('POST', '/api/notebook/kernel/sql/parar', { caminho }),
};
