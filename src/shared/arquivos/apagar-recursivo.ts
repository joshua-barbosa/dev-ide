// Em que ORDEM apagar uma pasta e o que há dentro dela.
//
// Ele, em 08/09/2026: *"Eu cliquei com o botão direito na pasta, e fui em
// deletar a pasta, deu Failure"*.
//
// `Failure` é a resposta do SFTP ao `rmdir` de uma pasta que não está vazia, e
// era isso que o driver mandava. A confirmação da IDE já PROMETIA o contrário —
// *"a pasta e tudo que está dentro dela vão junto"* —, então a tela dizia uma
// coisa e o servidor fazia outra.
//
// A ordem mora aqui, pura e testável: quem fala com o servidor é o driver, e
// cada protocolo tem a sua chamada. Sem esta ordem, apagar de cima para baixo
// só recria o mesmo `Failure` um nível mais fundo.

/** O que a listagem de uma pasta precisa dizer para esta conta. */
export interface NoParaApagar {
  readonly nome: string;
  readonly pasta: boolean;
}

export interface PassoDeApagar {
  readonly caminho: string;
  readonly pasta: boolean;
}

/**
 * Quantos níveis a varredura desce antes de desistir.
 *
 * Um link que aponta para o próprio pai faria a varredura não terminar nunca.
 * O limite corta com mensagem, e não com a pilha estourada — que não diz nada
 * a ninguém.
 */
export const FUNDO_MAXIMO = 40;

function juntar(pasta: string, nome: string): string {
  return pasta.endsWith('/') ? `${pasta}${nome}` : `${pasta}/${nome}`;
}

/**
 * A lista de remoções, **de dentro para fora**.
 *
 * A pasta pedida é sempre o ÚLTIMO passo: é a única ordem em que cada `rmdir`
 * encontra uma pasta já vazia.
 */
export async function ordemDeApagar(
  caminho: string,
  ehPasta: boolean,
  listar: (caminho: string) => Promise<readonly NoParaApagar[]>,
  fundo = 0
): Promise<readonly PassoDeApagar[]> {
  if (!ehPasta) return [{ caminho, pasta: false }];
  if (fundo >= FUNDO_MAXIMO) {
    throw new Error(
      `A pasta "${caminho}" tem mais de ${FUNDO_MAXIMO} níveis — pode haver um ` +
        'link apontando para dentro dela mesma. Apague pelo terminal.'
    );
  }

  const passos: PassoDeApagar[] = [];
  for (const filho of await listar(caminho)) {
    const dentro = juntar(caminho, filho.nome);
    passos.push(...(await ordemDeApagar(dentro, filho.pasta, listar, fundo + 1)));
  }
  passos.push({ caminho, pasta: true });
  return passos;
}
