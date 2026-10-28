// As chamadas do kernel do notebook (spec 112, etapa 2).
//
// Arquivo próprio: o `api.ts` passou do teto de 800 linhas do Artigo IV, e o
// notebook é um assunto inteiro — o corte é o natural. O transporte é o MESMO
// (`request`): na extensão ele passa pela ponte do editor sem ninguém aqui
// precisar saber.
import { request } from './api-http';
import type { Saida } from '../shared/notebook/modelo';
import type { RequisicaoHttp, SaidaHttp } from '../shared/notebook/http';
import type { Guardado } from '../shared/notebook/guardados';

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

/** O token do OAuth 2.0 visto pela tela: nunca o token em si. */
export interface EstadoDoOAuth {
  readonly tem: boolean;
  readonly expiraEm: number | null;
  readonly temRefresh: boolean;
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
  /** O que o arquivo guardou: cada kernel que nascer o recebe como variáveis. */
  guardados: (caminho: string, guardados: readonly Guardado[]) =>
    request<null>('POST', '/api/notebook/kernel/guardados', { caminho, guardados }),
  /** O que não voltou no último kernel que nasceu, e por quê. */
  naoRestaurados: (caminho: string) =>
    request<{ celula: string; nome: string; motivo: string }[]>(
      'GET', `/api/notebook/kernel/nao-restaurados?caminho=${q(caminho)}`
    ),
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
  /** A célula HTTP (spec 120): sai do motor; a resposta vira variável pelo `nome`. */
  http: (p: {
    caminho: string; celula: string; nome: string | null; linguagens: readonly string[]; raiz: string | null;
    http: RequisicaoHttp;
    /** Etapa 4: o nome de uma lista — uma requisição por item. */
    paraCada?: string | null;
  }) =>
    request<{
      /** Uma requisição: a resposta. Com "para cada": ausente, e vem a tabela. */
      saida?: SaidaHttp;
      tabela?: Saida | null;
      variavel: { nome: string; linhas?: number; linguagens?: string[] } | null;
      aviso: string | null;
      paraCada?: {
        total: number; feitos: number; comErroDeStatus: number;
        falha: { item: number; mensagem: string } | null; parado: boolean;
      };
    }>('POST', '/api/notebook/kernel/http', p),
  progressoHttp: (caminho: string, celula: string) =>
    request<{ feitos: number; total: number } | null>(
      'GET', `/api/notebook/kernel/http/progresso?caminho=${q(caminho)}&celula=${q(celula)}`
    ),
  /** O corpo INTEIRO da última resposta da célula — o arquivo guarda só até o teto. */
  corpoHttp: (caminho: string, celula: string) =>
    request<{ base64: string; mime: string }>(
      'GET', `/api/notebook/kernel/http/corpo?caminho=${q(caminho)}&celula=${q(celula)}`
    ),
  pararHttp: (caminho: string) => request<null>('POST', '/api/notebook/kernel/http/parar', { caminho }),
  /** OAuth 2.0 (etapa 5): "Pegar token novo". Authorization Code devolve o login a abrir. */
  oauthToken: (http: RequisicaoHttp, caminho: string | null) =>
    request<{ login?: { id: string; url: string }; estado?: EstadoDoOAuth }>('POST', '/api/notebook/oauth/token', { http, caminho }),
  oauthLogin: (id: string) =>
    request<{ estado: 'esperando' | 'trocando' | 'pronto' | 'erro'; erro?: string }>('GET', `/api/notebook/oauth/login?id=${q(id)}`),
  oauthEstado: (ref: string) => request<EstadoDoOAuth>('GET', `/api/notebook/oauth/estado?ref=${q(ref)}`),
  oauthLimpar: (ref: string) => request<null>('POST', '/api/notebook/oauth/limpar', { ref }),
  /** Os cookies que o notebook guardou (etapa 3). */
  cookies: (caminho: string) =>
    request<{ nome: string; valor: string; dominio: string; caminho: string; expira: number | null }[]>(
      'GET', `/api/notebook/kernel/http/cookies?caminho=${q(caminho)}`
    ),
  limparCookies: (caminho: string) => request<null>('POST', '/api/notebook/kernel/http/cookies/limpar', { caminho }),
  /** "Copiar como cURL": o motor põe o segredo do cofre no comando. */
  curl: (http: RequisicaoHttp, estilo: 'bash' | 'cmd') =>
    request<string>('POST', '/api/notebook/kernel/http/curl', { http, estilo }),
  /** Um segredo da aba Authorization no cofre (spec 120, etapa 2): a tela escolhe a referência. */
  guardarSegredo: (ref: string, valor: string) => request<null>('POST', '/api/notebook/segredo', { ref, valor }),
  /** Existe neste cofre? O valor só com `revelar`. */
  segredo: (ref: string, revelar = false) =>
    request<{ existe: boolean; valor?: string }>('GET', `/api/notebook/segredo?ref=${q(ref)}${revelar ? '&revelar=1' : ''}`),
};
