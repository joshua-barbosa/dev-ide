// A ponte entre o painel (dentro da webview) e o VS Code (fora dela).
//
// Duas coisas atravessam:
//
// 1. **Os pedidos ao motor.** A webview não pode falar com ele direto: a origem
//    dela é `vscode-webview://`, e o motor só aceita loopback — o navegador
//    transforma a recusa em CORS bloqueado ("Failed to fetch"). Em vez de
//    afrouxar a guarda do motor, o host faz o pedido: ele é Node, não tem CORS,
//    e nada de fora ganha acesso novo com isso.
//
// 2. **Abrir coisas.** Aba de editor, grade, terminal — o painel pede, o host
//    abre. Listar, expandir, filtrar, menu e diálogos acontecem tudo aqui
//    dentro, com o código da IDE, e é isso que faz o comportamento ser idêntico.
//
// Mensagem é DADO, nunca instrução: o host confere o `tipo` contra a lista dele
// e ignora o que não reconhece.
import { definirTransporte } from '../api-http';
import { definirTransferencia } from '../arquivos/transferencia';

export type PedidoAoHost =
  | { readonly tipo: 'abrirArquivo'; readonly caminho: string }
  | {
      // URI `braytech:`, servida pelo host por um FileSystemProvider — o arquivo
      // abre EDITÁVEL e o Ctrl+S grava no servidor. Ele usa SSH justamente para
      // editar; abrir uma cópia sem volta seria pior que não abrir.
      readonly tipo: 'abrirArquivoRemoto';
      readonly conexaoId: string;
      readonly caminho: string;
    }
  | {
      readonly tipo: 'abrirQuery';
      readonly connectionId: string;
      readonly database: string | null;
      readonly titulo: string;
      readonly conteudo: string;
    }
  | {
      readonly tipo: 'abrirTabela';
      readonly connectionId: string;
      readonly nodePath: readonly string[];
      readonly titulo: string;
      readonly database: string | null;
      readonly somenteLeitura: boolean;
    }
  | {
      readonly tipo: 'abrirChave';
      readonly connectionId: string;
      readonly chave: string;
      readonly somenteLeitura: boolean;
    }
  | {
      // O painel do servidor — Monitor, SFTP e Port Forwarding — como aba.
      // Quais divisórias aparecem é a SESSÃO que decide, pelas capacidades: o
      // FTP nasce sem Terminal e sem Monitor sem ninguém escrever um `if`.
      readonly tipo: 'abrirServidor';
      readonly connectionId: string;
      readonly rotulo: string;
      readonly somenteLeitura: boolean;
    }
  | {
      readonly tipo: 'abrirProcessos';
      readonly connectionId: string;
      readonly rotulo: string;
      readonly somenteLeitura: boolean;
    }
  | { readonly tipo: 'fecharArquivo'; readonly caminho: string }
  | {
      // Uma aba com a GRADE da IDE, e não uma <table> desenhada à mão.
      readonly tipo: 'abrirResultado';
      readonly titulo: string;
      readonly resultado: unknown;
      /**
       * A consulta que produziu isto, para a aba poder virar a página.
       *
       * Sem ela a grade mostra a primeira página e para ali: paginar é rodar a
       * MESMA consulta com outro `offset`, e quem só recebeu linhas prontas não
       * tem como. Foi o que ele viu — "não está fazendo paginação quando
       * retorna o result do +Tab".
       */
      readonly consulta?: {
        readonly connectionId: string;
        readonly database: string;
        readonly statement: string;
      };
    }
  | {
      readonly tipo: 'abrirCaderno';
      readonly caminho: string;
      readonly connectionId: string | null;
      readonly database: string | null;
    }
  | { readonly tipo: 'abrirTerminal'; readonly connectionId: string; readonly rotulo: string }
  | {
      // O cadastro é ABA do editor, não caixa na barra lateral: um driver como
      // o MySQL declara treze campos em quatro seções, e isso não cabe numa
      // coluna de 300 px sem rolagem dentro de rolagem.
      readonly tipo: 'abrirFormulario';
      readonly conexaoId: string | null;
      readonly grupo: string;
      readonly rotulo: string;
    }
  | { readonly tipo: 'fecharFormulario' }
  | { readonly tipo: 'abrirDiagrama'; readonly titulo: string; readonly markdown: string }
  | {
      // Os diálogos ricos (criar objeto, filtrar) também saem da coluna.
      readonly tipo: 'abrirDialogo';
      readonly dialogo: 'criacao' | 'filtro';
      readonly pedido: unknown;
    }
  | {
      readonly tipo: 'conexoesMudaram';
      /** Quando vem, recarrega SÓ aquele ramo — a árvore não se recolhe. */
      readonly conexaoId?: string;
      readonly caminho?: readonly string[];
      /** Presente só quando a aba de filtro devolve a escolha dele. */
      readonly filtro?: unknown;
    }
  | {
      readonly tipo: 'abrirSemTitulo';
      readonly conteudo: string;
      readonly linguagem: string;
    }
  | { readonly tipo: 'copiar'; readonly texto: string }
  | { readonly tipo: 'avisar'; readonly mensagem: string }
  | { readonly tipo: 'erro'; readonly mensagem: string }
  | { readonly tipo: 'naoImplementado'; readonly o_que: string };

interface CanalDoVsCode {
  postMessage(mensagem: unknown): void;
}

declare const acquireVsCodeApi: (() => CanalDoVsCode) | undefined;

let canal: CanalDoVsCode | null = null;

/** Pedidos em voo, por número. O host responde citando o mesmo número. */
const pendentes = new Map<
  number,
  { resolver(valor: unknown): void; recusar(erro: Error): void }
>();
let proximo = 1;

/**
 * Liga a ponte e passa a rotear a API pelo host.
 *
 * Fora do VS Code não há canal, e aí nada muda: o `fetch` da IDE continua
 * valendo, o que mantém este mesmo painel funcionando no navegador.
 */
export function ligarPonte(): void {
  canal ??= typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  if (canal === null) return;

  window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { tipo?: string; id?: number; ok?: boolean; data?: unknown; erro?: string };
    if ((m?.tipo !== 'apiResposta' && m?.tipo !== 'hostResposta') || typeof m.id !== 'number') {
      return;
    }
    const espera = pendentes.get(m.id);
    if (espera === undefined) return;
    pendentes.delete(m.id);
    if (m.ok === true) espera.resolver(m.data);
    else espera.recusar(new Error(m.erro ?? 'Erro do motor.'));
  });

  definirTransporte(
    (metodo, url, corpo) =>
      new Promise((resolver, recusar) => {
        const id = proximo;
        proximo += 1;
        pendentes.set(id, { resolver, recusar });
        canal?.postMessage({ tipo: 'api', id, metodo, rota: url, corpo });
      })
  );

  // Baixar e escolher arquivo pelo host (spec 100). Sem isto, os nove pontos
  // que entregam ou leem arquivo falhariam CALADOS dentro da webview: `<a
  // download>` e `<input type="file">` simplesmente não fazem nada aqui.
  definirTransferencia({
    salvar: (o) => chamarHost('salvarArquivo', o),
    escolher: (o) => chamarHost('escolherArquivo', o),
  });
}

export function pedirAoHost(pedido: PedidoAoHost): void {
  canal?.postMessage(pedido);
}

/**
 * O host pedindo que esta webview releia o cofre.
 *
 * Salvar acontece na ABA do formulário, que é outra webview com outro estado.
 * Sem este aviso a barra lateral seguiria mostrando a árvore de antes, e ele
 * teria de apertar Recarregar para ver a conexão que acabou de criar.
 */
export interface PedidoDeRecarga {
  readonly conexaoId?: string;
  readonly caminho?: readonly string[];
  readonly filtro?: unknown;
}

export function quandoOHostPedirRecarga(
  recarregar: (pedido: PedidoDeRecarga) => void
): () => void {
  const ouvir = (e: MessageEvent): void => {
    const m = e.data as { tipo?: string } & PedidoDeRecarga;
    if (m?.tipo === 'recarregar') recarregar(m);
  };
  window.addEventListener('message', ouvir);
  return () => window.removeEventListener('message', ouvir);
}

/**
 * O host mandando DADOS NOVOS para esta aba.
 *
 * O `▷ Run` de um bloco reaproveita a mesma aba de resultado a cada execução —
 * é o que a IDE faz, e abrir uma aba por clique encheria o editor. Como a aba
 * já existe, o host não a recria: manda o resultado novo por aqui.
 */
export function quandoOHostMandarDados(
  aplicar: (dados: Record<string, unknown>) => void
): () => void {
  const ouvir = (e: MessageEvent): void => {
    const m = e.data as { tipo?: string; dados?: Record<string, unknown> };
    if (m?.tipo === 'novosDados' && m.dados !== undefined) aplicar(m.dados);
  };
  window.addEventListener('message', ouvir);
  return () => window.removeEventListener('message', ouvir);
}

/**
 * Uma chamada ao host que DEVOLVE resposta.
 *
 * Existe para o que o VS Code faz melhor que uma webview: pedir um texto
 * (`showInputBox`), escrever num canal de saída, salvar um arquivo baixado.
 * Reimplementar isso dentro do painel daria uma caixa de diálogo estranha no
 * meio de um editor que já tem a dele.
 */
export function chamarHost<T>(acao: string, args: unknown = {}): Promise<T> {
  if (canal === null) return Promise.reject(new Error('Fora do VS Code.'));
  return new Promise<T>((resolver, recusar) => {
    const id = proximo;
    proximo += 1;
    pendentes.set(id, {
      resolver: (v) => resolver(v as T),
      recusar,
    });
    canal?.postMessage({ tipo: 'hostChamada', id, acao, args });
  });
}

/**
 * O que a extensão ainda não faz, dito na hora e por nome.
 *
 * Um item de menu que não faz nada é pior que um item ausente: ele promete. Até
 * a peça existir, o clique diz o que falta em vez de falhar calado.
 */
export function aindaNao(o_que: string): void {
  pedirAoHost({ tipo: 'naoImplementado', o_que });
}
