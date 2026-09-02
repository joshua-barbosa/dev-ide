// Escrever um `.zip`, sem biblioteca (T089).
//
// A decisão dele foi *"zip do lado do navegador, com progresso e cancelar"* — e
// isso resolve o problema difícil de graça: o servidor manda os arquivos um a
// um, como já manda hoje, e nada precisa caber na memória do processo da IDE.
//
// **Sem dependência**, e não por economia: o `CompressionStream('deflate-raw')`
// é exatamente o algoritmo que o ZIP usa, e existe no navegador e no Node. Uma
// biblioteca de zip traria um segundo deflate junto, em JavaScript, mais lento
// que o do navegador — que é nativo.
//
// O formato é o ZIP clássico, com os três pedaços de sempre:
//
// - um **cabeçalho local** antes de cada arquivo;
// - o **diretório central** no fim, repetindo tudo;
// - o **fim do diretório** apontando para onde ele começa.
//
// Este arquivo é a MONTAGEM dos bytes. Quem busca os arquivos é a interface.

/** O que se sabe de um arquivo antes de comprimi-lo. */
export interface EntradaDeZip {
  /** Caminho DENTRO do zip, com `/` — nunca começando com `/`. */
  readonly caminho: string;
  readonly dados: Uint8Array;
  /** Data de modificação. Ausente = agora. */
  readonly modificadoEm?: Date;
}

/** Uma entrada já comprimida, pronta para o diretório central. */
interface EntradaGravada {
  readonly caminho: Uint8Array;
  readonly crc: number;
  readonly comprimido: number;
  readonly cru: number;
  readonly deslocamento: number;
  readonly hora: number;
  readonly data: number;
  readonly metodo: number;
}

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;
/** 0 = guardado como veio; 8 = deflate. */
const GUARDADO = 0;
const DEFLATE = 8;

/**
 * A tabela do CRC-32, montada uma vez.
 *
 * O ZIP exige o CRC de cada arquivo, e sem ele o descompactador recusa o
 * arquivo inteiro. É a mesma tabela do `zlib`, e cabe em dez linhas — puxar uma
 * dependência por causa dela seria desproporcional.
 */
const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[i] = c >>> 0;
  }
  return tabela;
})();

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of dados) c = TABELA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Data e hora no formato do MS-DOS, que é o que o ZIP guarda.
 *
 * Dois campos de 16 bits, com o segundo dividido por dois — o formato é de
 * 1980 e não tem resolução para segundo ímpar. Datas antes de 1980 são
 * empurradas para 1980: o campo não as representa, e um número negativo ali
 * faria o descompactador mostrar lixo.
 */
export function horaDeDos(d: Date): { readonly hora: number; readonly data: number } {
  const ano = Math.max(1980, d.getFullYear());
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Comprime com o deflate do NAVEGADOR.
 *
 * Devolve o original quando comprimir não compensa — arquivo já comprimido
 * (`.png`, `.zip`, `.jpg`) costuma CRESCER com deflate, e guardar o maior dos
 * dois seria pagar tempo para o arquivo ficar pior.
 */
export async function comprimir(
  dados: Uint8Array
): Promise<{ readonly bytes: Uint8Array; readonly metodo: number }> {
  if (dados.length === 0) return { bytes: dados, metodo: GUARDADO };
  const fluxo = new Blob([dados as BlobPart]).stream().pipeThrough(
    new CompressionStream('deflate-raw')
  );
  const saida = new Uint8Array(await new Response(fluxo).arrayBuffer());
  return saida.length < dados.length
    ? { bytes: saida, metodo: DEFLATE }
    : { bytes: dados, metodo: GUARDADO };
}

/** Escreve os campos de tamanho fixo de um cabeçalho. */
function bytesDe(valores: readonly (readonly [number, 2 | 4])[]): Uint8Array {
  const total = valores.reduce((soma, [, tamanho]) => soma + tamanho, 0);
  const buffer = new Uint8Array(total);
  const vista = new DataView(buffer.buffer);
  let onde = 0;
  for (const [valor, tamanho] of valores) {
    if (tamanho === 2) vista.setUint16(onde, valor, true);
    else vista.setUint32(onde, valor >>> 0, true);
    onde += tamanho;
  }
  return buffer;
}

function juntar(pedacos: readonly Uint8Array[]): Uint8Array {
  const total = pedacos.reduce((soma, p) => soma + p.length, 0);
  const saida = new Uint8Array(total);
  let onde = 0;
  for (const p of pedacos) {
    saida.set(p, onde);
    onde += p.length;
  }
  return saida;
}

/**
 * Monta um `.zip` a partir das entradas.
 *
 * `aoProgredir` é chamado depois de CADA arquivo, e é o que alimenta a barra —
 * um zip de trezentos arquivos sem sinal nenhum parece uma IDE travada.
 *
 * `cancelado` é consultado entre arquivos. Parar no meio devolve o que já foi
 * montado? Não: devolver meio zip seria entregar um arquivo corrompido com cara
 * de pronto. Cancelar **lança**, e quem pediu decide o que dizer.
 */
export async function montarZip(
  entradas: readonly EntradaDeZip[],
  opcoes: {
    aoProgredir?: (feitos: number, total: number, caminho: string) => void;
    cancelado?: () => boolean;
  } = {}
): Promise<Uint8Array> {
  const codificador = new TextEncoder();
  const pedacos: Uint8Array[] = [];
  const gravadas: EntradaGravada[] = [];
  let deslocamento = 0;

  for (const [indice, entrada] of entradas.entries()) {
    if (opcoes.cancelado?.() === true) {
      throw new Error('O download foi cancelado.');
    }

    const caminho = codificador.encode(normalizarCaminho(entrada.caminho));
    const { bytes, metodo } = await comprimir(entrada.dados);
    const crc = crc32(entrada.dados);
    const { hora, data } = horaDeDos(entrada.modificadoEm ?? new Date());

    const cabecalho = juntar([
      bytesDe([
        [ASSINATURA_LOCAL, 4],
        // Versão 2.0: é o mínimo que suporta deflate.
        [20, 2],
        // Bit 11 ligado: o nome do arquivo está em UTF-8. Sem ele, acento em
        // nome de arquivo vira lixo no Windows.
        [0x0800, 2],
        [metodo, 2],
        [hora, 2],
        [data, 2],
        [crc, 4],
        [bytes.length, 4],
        [entrada.dados.length, 4],
        [caminho.length, 2],
        [0, 2],
      ]),
      caminho,
    ]);

    pedacos.push(cabecalho, bytes);
    gravadas.push({
      caminho,
      crc,
      comprimido: bytes.length,
      cru: entrada.dados.length,
      deslocamento,
      hora,
      data,
      metodo,
    });
    deslocamento += cabecalho.length + bytes.length;

    opcoes.aoProgredir?.(indice + 1, entradas.length, entrada.caminho);
  }

  const inicioDoCentral = deslocamento;
  for (const g of gravadas) {
    pedacos.push(
      juntar([
        bytesDe([
          [ASSINATURA_CENTRAL, 4],
          [20, 2],
          [20, 2],
          [0x0800, 2],
          [g.metodo, 2],
          [g.hora, 2],
          [g.data, 2],
          [g.crc, 4],
          [g.comprimido, 4],
          [g.cru, 4],
          [g.caminho.length, 2],
          [0, 2],
          [0, 2],
          [0, 2],
          [0, 2],
          [0, 4],
          [g.deslocamento, 4],
        ]),
        g.caminho,
      ])
    );
    deslocamento += 46 + g.caminho.length;
  }

  pedacos.push(
    bytesDe([
      [ASSINATURA_FIM, 4],
      [0, 2],
      [0, 2],
      [gravadas.length, 2],
      [gravadas.length, 2],
      [deslocamento - inicioDoCentral, 4],
      [inicioDoCentral, 4],
      [0, 2],
    ])
  );

  return juntar(pedacos);
}

/**
 * O caminho como o ZIP o quer.
 *
 * Barra normal sempre (o formato é assim, mesmo no Windows), sem `/` na frente
 * e sem `..` — um zip com `../` no caminho escapa da pasta ao ser extraído, que
 * é o *zip slip*. Aqui os caminhos vêm do servidor dele, mas a regra é da
 * fronteira: quem monta o arquivo é quem responde pelo que ele contém.
 */
export function normalizarCaminho(bruto: string): string {
  return bruto
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.' && p !== '..')
    .join('/');
}

/**
 * O nome do arquivo que a pasta vira.
 *
 * Leva o nome da pasta e a data: `dist.zip` na pasta de downloads não diz de
 * quando é, e baixar duas vezes daria `dist (1).zip`.
 */
export function nomeDoZip(caminhoRemoto: string, agora = new Date()): string {
  const base = caminhoRemoto.split('/').filter((p) => p !== '').pop() ?? 'pasta';
  const limpo = base.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'pasta';
  const d = agora;
  const dois = (n: number): string => String(n).padStart(2, '0');
  return `${limpo}-${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}.zip`;
}
