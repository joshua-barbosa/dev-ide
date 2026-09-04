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
    }
  | { readonly tipo: 'abrirChave'; readonly connectionId: string; readonly chave: string }
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
  | { readonly tipo: 'conexoesMudaram' }
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
export function quandoOHostPedirRecarga(recarregar: () => void): () => void {
  const ouvir = (e: MessageEvent): void => {
    if ((e.data as { tipo?: string })?.tipo === 'recarregar') recarregar();
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
