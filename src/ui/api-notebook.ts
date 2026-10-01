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

export const ApiDoNotebook = {
  kernel: (caminho: string) =>
    request<EstadoDoKernel | null>('GET', `/api/notebook/kernel?caminho=${encodeURIComponent(caminho)}`),
  ambiente: (caminho: string, linguagem: string, raiz: string | null) =>
    request<AmbienteDoKernel>(
      'GET',
      `/api/notebook/ambiente?caminho=${encodeURIComponent(caminho)}&linguagem=${encodeURIComponent(linguagem)}` +
        `&raiz=${encodeURIComponent(raiz ?? '')}`
    ),
  iniciar: (p: {
    caminho: string; linguagem: string; raiz: string | null; interpretador?: string; laravel?: boolean;
    pacotes?: string;
  }) =>
    request<EstadoDoKernel>('POST', '/api/notebook/kernel', p),
  executar: (caminho: string, codigo: string) =>
    request<{ exec: number }>('POST', '/api/notebook/kernel/executar', { caminho, codigo }),
  execucao: (caminho: string, exec: number, desde: number) =>
    request<{ inicio: number; saidas: Saida[]; terminou: boolean; ok: boolean }>(
      'GET',
      `/api/notebook/kernel/execucao?caminho=${encodeURIComponent(caminho)}&exec=${exec}&desde=${desde}`
    ),
  interromper: (caminho: string) =>
    request<null>('POST', '/api/notebook/kernel/interromper', { caminho }),
  reiniciar: (caminho: string) =>
    request<EstadoDoKernel | null>('POST', '/api/notebook/kernel/reiniciar', { caminho }),
  encerrar: (caminho: string) =>
    request<null>('POST', '/api/notebook/kernel/encerrar', { caminho }),
  sql: (p: {
    caminho: string; connectionId: string; database: string; statement: string; nome: string | null;
  }) =>
    request<{
      tabela: Saida | null;
      mensagem?: string;
      variavel: { nome: string; linhas: number; forma: string } | null;
      aviso?: string | null;
    }>('POST', '/api/notebook/kernel/sql', p),
};
