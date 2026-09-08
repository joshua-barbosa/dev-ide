// Varrer uma pasta remota inteira, para baixá-la em zip (T089).
//
// A decisão dele foi *"zip do lado do navegador, com progresso e cancelar"*.
// Este arquivo é o **plano**: quais arquivos existem lá dentro, e em que ordem.
// Quem busca os bytes e monta o zip é a interface — aqui não entra rede.
//
// A varredura é iterativa, e não recursiva: uma árvore de `node_modules` tem
// profundidade suficiente para estourar a pilha do JavaScript, e um erro de
// "maximum call stack" ao baixar uma pasta não diz nada a ninguém.

/**
 * O mínimo que a varredura precisa saber de uma entrada.
 *
 * É um subconjunto do `RemoteEntry` de `shared/contracts.ts`, com os mesmos
 * nomes — a listagem do SFTP entra aqui direto, sem tradutor no meio. Um
 * formato próprio criaria uma segunda verdade sobre o que é uma entrada remota.
 */
export interface EntradaRemota {
  readonly name: string;
  readonly kind: 'file' | 'folder' | 'link';
  readonly size: number | null;
  readonly modifiedAt: number | null;
}

export interface ArquivoAchado {
  /** Caminho completo no servidor. */
  readonly caminho: string;
  /** Caminho relativo à pasta que se está baixando — é o nome dentro do zip. */
  readonly relativo: string;
  readonly bytes: number;
  readonly modificadoEm?: Date;
}

export interface LimitesDaVarredura {
  /** Teto de arquivos. Passar disso é erro, e não corte silencioso. */
  readonly maxArquivos: number;
  /** Teto da soma dos tamanhos, em bytes. */
  readonly maxBytes: number;
}

export const LIMITES_PADRAO: LimitesDaVarredura = {
  // Dois mil arquivos e 200 MB. Não são números mágicos: é o que cabe na
  // memória do navegador sem risco, já que o zip inteiro é montado lá. Passar
  // disso vira erro DIZENDO o número — cortar em silêncio entregaria um zip
  // incompleto com cara de completo.
  maxArquivos: 2_000,
  maxBytes: 200 * 1024 * 1024,
};

export interface Varredura {
  readonly arquivos: readonly ArquivoAchado[];
  /** Soma dos tamanhos, para a barra de progresso saber o tamanho do todo. */
  readonly totalBytes: number;
  /** Pastas que existem e estão vazias — o zip as guarda mesmo assim. */
  readonly pastasVazias: readonly string[];
}

/**
 * Percorre a pasta e devolve todos os arquivos dentro dela.
 *
 * `listar` é injetado: é o que faz esta função ser testável sem servidor, e é
 * a mesma forma do resto do projeto.
 *
 * **Link simbólico não é seguido.** Um link para `/` faria a varredura tentar
 * baixar o servidor inteiro, e dois links apontando um para o outro a fariam
 * rodar para sempre. Eles são ignorados, e quem quiser o conteúdo baixa a pasta
 * de destino.
 */
export async function varrerPasta(
  raiz: string,
  listar: (caminho: string) => Promise<readonly EntradaRemota[]>,
  opcoes: {
    readonly limites?: LimitesDaVarredura;
    aoAndar?: (achados: number, pastaAtual: string) => void;
    cancelado?: () => boolean;
  } = {}
): Promise<Varredura> {
  const limites = opcoes.limites ?? LIMITES_PADRAO;
  const arquivos: ArquivoAchado[] = [];
  const pastasVazias: string[] = [];
  let totalBytes = 0;

  const fila: string[] = [raiz];
  /** Pastas já visitadas, para um ciclo de montagem não virar laço infinito. */
  const vistas = new Set<string>([normalizar(raiz)]);

  while (fila.length > 0) {
    if (opcoes.cancelado?.() === true) throw new Error('O download foi cancelado.');

    const pasta = fila.shift() as string;
    opcoes.aoAndar?.(arquivos.length, pasta);
    const entradas = await listar(pasta);

    let temAlgo = false;
    for (const entrada of entradas) {
      // `.` e `..` chegam em alguns servidores FTP; segui-los é voltar para
      // cima e varrer o disco inteiro.
      if (entrada.name === '.' || entrada.name === '..') continue;
      if (entrada.kind === 'link') continue;

      const caminho = juntar(pasta, entrada.name);
      temAlgo = true;

      if (entrada.kind === 'folder') {
        const chave = normalizar(caminho);
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        fila.push(caminho);
        continue;
      }

      const bytes = entrada.size ?? 0;
      if (arquivos.length + 1 > limites.maxArquivos) {
        throw new Error(
          `Esta pasta tem mais de ${limites.maxArquivos} arquivos. ` +
            'Baixe uma subpasta de cada vez, ou use o terminal com `tar`.'
        );
      }
      if (totalBytes + bytes > limites.maxBytes) {
        throw new Error(
          `Esta pasta passa de ${Math.round(limites.maxBytes / 1024 / 1024)} MB. ` +
            'Baixe uma subpasta de cada vez, ou use o terminal com `tar`.'
        );
      }

      totalBytes += bytes;
      arquivos.push({
        caminho,
        relativo: relativoA(raiz, caminho),
        bytes,
        // `modifiedAt` vem em milissegundos; `null` quando o servidor não
        // informa, e aí o zip usa a hora de agora.
        ...(entrada.modifiedAt === null ? {} : { modificadoEm: new Date(entrada.modifiedAt) }),
      });
    }

    // Pasta vazia entra no zip como pasta: sem isto, baixar uma árvore de
    // projeto perderia os diretórios que ainda não têm nada, e quem extrair vai
    // procurar por eles.
    if (!temAlgo && pasta !== raiz) pastasVazias.push(`${relativoA(raiz, pasta)}/`);
  }

  return { arquivos, totalBytes, pastasVazias };
}

/** Junta pasta e nome com UMA barra, mesmo que a pasta já termine em barra. */
export function juntar(pasta: string, nome: string): string {
  return `${pasta.replace(/\/+$/, '')}/${nome}`;
}

/** Sem barra no fim — para comparar dois caminhos que só diferem nela. */
function normalizar(caminho: string): string {
  return caminho.replace(/\/+$/, '') || '/';
}

/**
 * O caminho relativo à raiz — o nome que a entrada terá dentro do zip.
 *
 * A pasta baixada entra como PASTA no zip: baixar `/var/www/site` dá um zip com
 * `site/` dentro, e não os arquivos soltos. Extrair um zip que despeja
 * quarenta arquivos na pasta de downloads é o que ninguém quer.
 */
export function relativoA(raiz: string, caminho: string): string {
  const base = normalizar(raiz);
  const nomeDaRaiz = base.split('/').filter((p) => p !== '').pop() ?? 'pasta';
  const dentro = caminho.startsWith(`${base}/`) ? caminho.slice(base.length + 1) : caminho;
  return `${nomeDaRaiz}/${dentro}`;
}
