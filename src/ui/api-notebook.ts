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
  readonly interpretador: { readonly caminho: string; readonly origem: string; readonly rotulo: string };
  readonly candidatos: readonly { readonly caminho: string; readonly origem: string; readonly rotulo: string }[];
}

export const ApiDoNotebook = {
  kernel: (caminho: string) =>
    request<EstadoDoKernel | null>('GET', `/api/notebook/kernel?caminho=${encodeURIComponent(caminho)}`),
  iniciar: (p: { caminho: string; linguagem: string; raiz: string | null; interpretador?: string }) =>
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
