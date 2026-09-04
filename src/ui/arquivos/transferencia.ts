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
  }) => Promise<{ readonly nome: string; readonly carga: string } | null>;
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
    input.oncancel = () => resolver(null);
    input.click();
  });
}
