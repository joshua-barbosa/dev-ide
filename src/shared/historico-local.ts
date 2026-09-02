// Versões locais de um arquivo: o Timeline e o rascunho não salvo (T010, T035).
//
// Os dois itens são a mesma coisa guardada, e por isso moram juntos: uma
// **versão local** de um arquivo, com data. O que muda é a origem:
//
// | origem      | quando nasce                                | vale para |
// |-------------|---------------------------------------------|-----------|
// | `salvo`     | ao gravar em disco                          | T010      |
// | `rascunho`  | ao fechar a janela com o arquivo sujo        | T035      |
//
// A nota dele no T010 é o que define o item: *"versões locais com data,
// comparar e restaurar, **sem depender do git**"*. Um arquivo fora de
// repositório tem tanto direito a histórico quanto um dentro — e é justamente
// nele que perder trabalho dói mais, porque não há `git checkout` que salve.
//
// E a do T035: *"marcado como rascunho, com a data de quando foi digitado"*. A
// IDE **não** ressuscita o texto por cima do arquivo: ela mostra que existe um
// rascunho, de quando, e deixa comparar antes de decidir.

export type OrigemDaVersao = 'salvo' | 'rascunho';

export interface VersaoLocal {
  readonly id: string;
  /** Quando foi gravada, em milissegundos. */
  readonly quando: number;
  readonly origem: OrigemDaVersao;
  /** Tamanho do conteúdo, para a lista mostrar sem carregar o texto. */
  readonly bytes: number;
}

/** Uma versão com o conteúdo junto — o que se lê para comparar ou restaurar. */
export interface VersaoComTexto extends VersaoLocal {
  readonly conteudo: string;
}

/**
 * Quantas versões um arquivo guarda, e por quanto tempo.
 *
 * O corte é por **número** e por **idade**, e os dois existem: só por número, um
 * arquivo que ninguém abre há um ano continuaria ocupando espaço; só por idade,
 * uma tarde de trabalho intenso encheria o disco.
 */
export interface PoliticaDeHistorico {
  readonly maxPorArquivo: number;
  readonly maxDias: number;
  /** Acima disto, a versão não é guardada. */
  readonly maxBytes: number;
}

export const POLITICA_PADRAO: PoliticaDeHistorico = {
  maxPorArquivo: 50,
  maxDias: 30,
  // 2 MB é o mesmo teto que a IDE usa para abrir um arquivo no editor: guardar
  // versão do que ela nem abre não serviria para nada.
  maxBytes: 2 * 1024 * 1024,
};

/**
 * Guardar esta versão vale a pena?
 *
 * **Conteúdo idêntico ao da última não vira versão nova.** Salvar cinco vezes
 * sem mudar nada encheria o Timeline de linhas iguais, e a que interessa —
 * a de antes da mudança — sairia pelo corte.
 *
 * O rascunho é a exceção: ele SEMPRE entra, mesmo igual ao que já está lá,
 * porque o que ele diz não é "o texto mudou", e sim "havia trabalho não salvo
 * quando a janela fechou".
 */
export function valeGuardar(
  conteudo: string,
  ultima: { readonly conteudo: string } | null,
  origem: OrigemDaVersao,
  politica: PoliticaDeHistorico = POLITICA_PADRAO
): boolean {
  if (conteudo.length > politica.maxBytes) return false;
  if (origem === 'rascunho') return true;
  return ultima === null || ultima.conteudo !== conteudo;
}

/**
 * O que fica depois da poda, da mais nova para a mais velha.
 *
 * **O rascunho nunca é podado por idade.** Ele é trabalho que ninguém salvou:
 * apagá-lo por ter trinta dias seria jogar fora exatamente o que este item
 * existe para guardar. Ele sai quando o arquivo for salvo por cima — aí deixa
 * de ser rascunho e vira história.
 */
export function podar(
  versoes: readonly VersaoLocal[],
  agora: number,
  politica: PoliticaDeHistorico = POLITICA_PADRAO
): readonly VersaoLocal[] {
  const ordenadas = [...versoes].sort((a, b) => b.quando - a.quando);
  const limite = agora - politica.maxDias * 24 * 60 * 60 * 1000;

  const mantidas: VersaoLocal[] = [];
  let salvasContadas = 0;
  for (const v of ordenadas) {
    if (v.origem === 'rascunho') {
      mantidas.push(v);
      continue;
    }
    if (v.quando < limite) continue;
    if (salvasContadas >= politica.maxPorArquivo) continue;
    salvasContadas += 1;
    mantidas.push(v);
  }
  return mantidas.sort((a, b) => b.quando - a.quando);
}

/**
 * A chave de um arquivo no histórico.
 *
 * O caminho absoluto não serve como nome de arquivo — tem `/` —, e trocar `/`
 * por `_` juntaria `a/b` e `a_b` na mesma pasta. Um resumo em hexadecimal
 * resolve os dois, e o caminho original é guardado DENTRO do índice para a tela
 * poder mostrá-lo.
 *
 * Não é criptográfico e não precisa ser: colisão aqui significaria dois arquivos
 * dividindo histórico, e a chance disso com FNV-1a de 64 bits é desprezível para
 * a quantidade de arquivos que uma pessoa edita.
 */
export function chaveDoArquivo(caminho: string): string {
  // FNV-1a de 64 bits, em BigInt para não perder bits no `number`.
  let hash = 0xcbf29ce484222325n;
  const primo = 0x100000001b3n;
  const mascara = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(caminho)) {
    hash = ((hash ^ BigInt(byte)) * primo) & mascara;
  }
  return hash.toString(16).padStart(16, '0');
}

/** `há 3 minutos`, `ontem`, `12/08` — o que se lê de relance no Timeline. */
export function quandoEmPalavras(quando: number, agora = Date.now()): string {
  const segundos = Math.max(0, Math.round((agora - quando) / 1000));
  if (segundos < 60) return 'agora há pouco';
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${dias} dias`;
  const d = new Date(quando);
  const dois = (n: number): string => String(n).padStart(2, '0');
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
}

/** `1,2 KB`, `340 B` — para a lista mostrar o tamanho sem abrir o texto. */
export function tamanhoEmPalavras(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
