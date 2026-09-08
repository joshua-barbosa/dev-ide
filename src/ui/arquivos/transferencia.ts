// Baixar um arquivo e escolher um arquivo — uma costura, não nove remendos.
//
// A IDE faz as duas coisas com DOM: `<a download>` e `<input type="file">`.
// Dentro de uma webview do editor nenhum dos dois funciona, e o modo como
// falham é o pior possível: **calados**. O clique não faz nada, não há erro no
// console, e quem usa conclui que a extensão está travada.
//
// São nove os lugares que faziam isso à mão — exportar conexões, importar
// conexões, baixar do SFTP, baixar pasta em zip, ações remotas, exportar
// resultado, exportar tabela, salvar/carregar célula e o PNG do CodeSnap.
// Consertar dois deixaria sete quebrados em silêncio. Por isso a saída é a
// mesma da spec 093 com o `definirTransporte`: quem chama não sabe onde está.
import { daCarga, paraCarga } from '../../shared/arquivos/carga';

export interface Transferencia {
  /** Grava um arquivo na máquina, perguntando onde. */
  readonly salvar: (o: {
    readonly nome: string;
    readonly carga: string;
    readonly mime: string;
  }) => Promise<void>;
  /** Pede um arquivo ao usuário. `null` quando ele desiste. */
  readonly escolher: (o: {
    readonly extensoes: readonly string[];
    readonly varios?: boolean;
  }) => Promise<{ readonly nome: string; readonly carga: string } | null>;
  /** Pede VÁRIOS arquivos. Lista vazia quando ele desiste. */
  readonly escolherVarios: (o: {
    readonly extensoes: readonly string[];
  }) => Promise<readonly { readonly nome: string; readonly carga: string }[]>;
}

let transferencia: Transferencia | null = null;

/**
 * Troca o DOM por outro caminho até o disco (spec 100).
 *
 * Chamado uma vez na subida da webview, como o transporte da API já é. Passar
 * `null` devolve o comportamento do navegador.
 */
export function definirTransferencia(nova: Transferencia | null): void {
  transferencia = nova;
}

/**
 * Estamos dentro da webview do editor?
 *
 * A costura acima é instalada num lugar só — a subida da ponte —, então ela é
 * a resposta honesta para a pergunta, sem ninguém precisar consultar o
 * `acquireVsCodeApi` de novo.
 *
 * Existe por um motivo específico: **arrastar arquivo do sistema para dentro
 * de uma webview do VS Code não é suportado.** O pedido de API foi fechado
 * como fora de escopo (microsoft/vscode#111092), e o `drop` sequer chega ao
 * documento da webview — o workbench o intercepta antes. Quem arrasta não vê
 * erro nenhum, porque não há evento nenhum para transformar em erro. A única
 * saída é DIZER isso onde o gesto seria tentado.
 */
export function dentroDoEditor(): boolean {
  return transferencia !== null;
}

/**
 * Abre o seletor com o input DENTRO do documento, e o tira de lá depois.
 *
 * Um `<input>` solto na memória abre o diálogo, mas nem todo mundo entrega o
 * `change` de volta a um elemento que não está no documento — foi assim que o
 * botão de enviar arquivo "funcionou" sem subir nada, e sem erro nenhum.
 * Escondido de propósito: ele nunca é para ser visto.
 */
function abrirSeletor(input: HTMLInputElement): void {
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.click();
  // Depois do gesto: remover na hora cancelaria o diálogo em alguns
  // navegadores. Um minuto é folga suficiente para escolher um arquivo.
  setTimeout(() => input.remove(), 60_000);
}

/** Baixa um arquivo. Texto ou bytes — o PNG do CodeSnap e o zip passam por aqui. */
export async function baixarArquivo(
  nome: string,
  conteudo: Uint8Array | string,
  mime = 'application/octet-stream'
): Promise<void> {
  if (transferencia !== null) {
    await transferencia.salvar({ nome, carga: paraCarga(conteudo), mime });
    return;
  }

  const bytes = typeof conteudo === 'string' ? new TextEncoder().encode(conteudo) : conteudo;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Pede um arquivo e devolve o TEXTO dele — `null` se ele desistir.
 *
 * O `<input>` é criado na hora e descartado: um input escondido fixo no DOM
 * guardaria o arquivo anterior, e escolher o mesmo arquivo duas vezes não
 * dispararia o `change` na segunda. É um defeito clássico deste elemento.
 */
export async function escolherArquivoDeTexto(
  extensoes: readonly string[] = []
): Promise<{ readonly nome: string; readonly texto: string } | null> {
  if (transferencia !== null) {
    const r = await transferencia.escolher({ extensoes });
    return r === null ? null : { nome: r.nome, texto: new TextDecoder().decode(daCarga(r.carga)) };
  }

  return new Promise((resolver) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Uma LISTA DE EXTENSÕES, e não um `accept` de MIME: o diálogo do editor
    // pede extensões, o do navegador aceita as duas formas, e assim não sobra
    // nenhuma string para alguém interpretar errado dos dois lados.
    input.accept = extensoes.map((e) => `.${e}`).join(',');
    input.onchange = () => {
      const arquivo = input.files?.[0];
      if (arquivo === undefined) {
        resolver(null);
        return;
      }
      arquivo.text().then((texto) => resolver({ nome: arquivo.name, texto }), () => resolver(null));
    };
    // Sem o `cancel` a promessa ficaria pendente para sempre quando ele
    // fechasse o diálogo sem escolher nada.
    // `cancel` NÃO resolve na hora: em alguns ambientes ele chega ANTES do
    // `change` do mesmo gesto, e resolver aqui descartaria o arquivo que ele
    // acabou de escolher — sem erro nenhum, que foi como o envio "funcionou"
    // sem subir nada. Um tique de atraso deixa o `change` chegar primeiro.
    input.oncancel = () => setTimeout(() => resolver(null), 0);
    abrirSeletor(input);
  });
}

/**
 * Pede VÁRIOS arquivos e devolve os bytes de cada um.
 *
 * Existe para o envio ao servidor remoto. Arrastar da máquina para a pasta é o
 * gesto natural, mas dentro da webview do editor ele depende do que o editor
 * entrega no `dataTransfer` — e quando não entrega nada, o clique não faz nada.
 * Um botão que abre o diálogo do sistema funciona nos dois lugares, sempre.
 */
export async function escolherArquivos(
  extensoes: readonly string[] = []
): Promise<readonly { readonly nome: string; readonly bytes: Uint8Array }[]> {
  if (transferencia !== null) {
    const r = await transferencia.escolherVarios({ extensoes });
    return r.map((a) => ({ nome: a.nome, bytes: daCarga(a.carga) }));
  }

  return new Promise((resolver) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = extensoes.map((e) => `.${e}`).join(',');
    input.onchange = () => {
      const escolhidos = [...(input.files ?? [])];
      Promise.all(
        escolhidos.map(async (f) => ({
          nome: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
        }))
      ).then(resolver, () => resolver([]));
    };
    // Ver a nota do `cancel` em `escolherArquivoDeTexto`: ele pode chegar
    // antes do `change` do mesmo gesto.
    input.oncancel = () => setTimeout(() => resolver([]), 0);
    abrirSeletor(input);
  });
}
