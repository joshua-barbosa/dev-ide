// Como cada arquivo é ABERTO (T027 · spec 024).
//
// Na spec 024 eu listei "preview de imagem, PDF e CSV" nos `Non-Goals` sem
// escrever desculpa nenhuma. Hoje clicar num `.png` na árvore tenta abri-lo
// como texto, e o Monaco recebe bytes que não são texto.
//
// Puro porque a decisão é por EXTENSÃO, e errar aqui é abrir um PDF no editor
// ou um `.ts` num visualizador de imagem.

export type Visualizador = 'texto' | 'imagem' | 'pdf' | 'csv' | 'caderno';

/**
 * O que o navegador desenha sozinho, com `<img>`.
 *
 * `.svg` está aqui e é o único que merece nota: um SVG é XML e pode carregar
 * `<script>`. Ele entra como `<img src>`, e não em linha no documento — nessa
 * forma o navegador NÃO executa script nenhum, que é a diferença entre ver o
 * arquivo e rodá-lo. É a mesma distinção que o preview de markdown faz.
 */
const IMAGENS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);

export function visualizadorDe(caminho: string): Visualizador {
  const nome = caminho.toLowerCase();
  const ponto = nome.lastIndexOf('.');
  const ext = ponto === -1 ? '' : nome.slice(ponto + 1);

  if (nome.endsWith('.sqlbook')) return 'caderno';
  if (IMAGENS.has(ext)) return 'imagem';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  return 'texto';
}

/** Precisa ser buscado como BYTES, e não como texto? */
export function ehBinario(v: Visualizador): boolean {
  return v === 'imagem' || v === 'pdf';
}

/**
 * O separador de um arquivo tabular.
 *
 * `.tsv` é tabulação por definição. Para `.csv`, a extensão não decide: um
 * "CSV" gerado por Excel em português usa `;`, e ler com `,` devolveria uma
 * coluna só com tudo dentro. Quem decide é o conteúdo.
 */
export function separadorDe(caminho: string, primeiraLinha: string): string {
  if (caminho.toLowerCase().endsWith('.tsv')) return '\t';
  const candidatos = [',', ';', '\t', '|'];
  let melhor = ',';
  let mais = 0;
  for (const c of candidatos) {
    // Fora de aspas: um `;` dentro de `"a;b"` é conteúdo, não separador.
    const quantos = contarForaDeAspas(primeiraLinha, c);
    if (quantos > mais) {
      mais = quantos;
      melhor = c;
    }
  }
  return melhor;
}

function contarForaDeAspas(linha: string, alvo: string): number {
  let dentro = false;
  let total = 0;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') {
      // `""` dentro de aspas é uma aspa literal, e não o fim do campo.
      if (dentro && linha[i + 1] === '"') {
        i += 1;
        continue;
      }
      dentro = !dentro;
      continue;
    }
    if (!dentro && c === alvo) total += 1;
  }
  return total;
}

/**
 * Lê um arquivo tabular em linhas e campos.
 *
 * Escrito aqui em vez de importado: as regras do RFC 4180 que importam são três
 * — aspas em volta do campo, aspa dobrada dentro, e quebra de linha DENTRO de
 * aspas — e uma dependência para isso traria muito mais do que essas três.
 */
export function lerTabular(
  conteudo: string,
  separador: string,
  maxLinhas = 5_000
): { readonly linhas: readonly (readonly string[])[]; readonly truncado: boolean } {
  const linhas: string[][] = [];
  let campo = '';
  let atual: string[] = [];
  let dentro = false;

  const fecharCampo = (): void => {
    atual.push(campo);
    campo = '';
  };
  const fecharLinha = (): void => {
    fecharCampo();
    linhas.push(atual);
    atual = [];
  };

  for (let i = 0; i < conteudo.length; i += 1) {
    const c = conteudo[i]!;
    if (dentro) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else dentro = false;
      } else campo += c;
      continue;
    }
    if (c === '"' && campo === '') {
      dentro = true;
      continue;
    }
    if (c === separador) {
      fecharCampo();
      continue;
    }
    if (c === '\n') {
      fecharLinha();
      if (linhas.length >= maxLinhas) return { linhas, truncado: true };
      continue;
    }
    // `\r\n`: o `\r` é do formato, e não do dado.
    if (c === '\r' && conteudo[i + 1] === '\n') continue;
    campo += c;
  }

  // A última linha sem quebra no fim também conta — a não ser que esteja vazia.
  if (campo !== '' || atual.length > 0) fecharLinha();
  return { linhas, truncado: false };
}

/**
 * O `Content-Type` de um arquivo que o navegador vai MOSTRAR.
 *
 * Sai de uma tabela nossa, e não de adivinhação: a resposta vai com `nosniff`,
 * então um tipo errado aqui vira um arquivo que não abre — mas um tipo
 * adivinhado poderia virar um arquivo tratado como script.
 */
const TIPOS_PARA_MOSTRAR: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  svg: 'image/svg+xml', pdf: 'application/pdf',
};

export function tipoDeConteudo(caminho: string): string {
  const nome = caminho.toLowerCase();
  const ponto = nome.lastIndexOf('.');
  const ext = ponto === -1 ? '' : nome.slice(ponto + 1);
  return TIPOS_PARA_MOSTRAR[ext] ?? 'application/octet-stream';
}

/**
 * O endereço de onde o navegador busca os BYTES de um arquivo.
 *
 * Local e remoto têm rotas diferentes, e antes desta função só a local existia
 * — por isso uma imagem do servidor abria no editor de texto: ninguém tinha
 * onde buscar os bytes dela.
 */
export function urlDosBytes(caminho: string, conexaoRemota?: string): string {
  const alvo = encodeURIComponent(caminho);
  return conexaoRemota === undefined || conexaoRemota === ''
    ? `/api/file/raw?path=${alvo}`
    : `/api/connections/${encodeURIComponent(conexaoRemota)}/files/bytes?path=${alvo}`;
}
