// Qual aba da extensão é "a mesma" — e com que nome ela aparece.
//
// Um colega dele achou: duas tabelas `mesma_tabela` em databases diferentes,
// e abrir a segunda só REVELAVA a primeira. A aba era identificada pelo
// título, e o título era o nome da tabela. A identidade agora é o ALVO
// (conexão, database, caminho na árvore); o título leva o database junto,
// para as duas abas não parecerem a mesma na barra do editor.
//
// Sem `import`: é copiado para a extensão (`copiar-compartilhado.mjs`).

/** Um texto dos dados da aba, ou vazio. */
function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/** A identidade da aba: abrir o mesmo alvo revela, alvo diferente abre outra. */
export function chaveDaAba(
  tipo: string,
  titulo: string,
  dados: Readonly<Record<string, unknown>>
): string {
  if (tipo === 'tabela') {
    const caminho = Array.isArray(dados.nodePath) ? dados.nodePath.map(texto).join('\u0000') : '';
    return ['tabela', texto(dados.connectionId), texto(dados.database), caminho].join('\u0001');
  }
  if (tipo === 'chave') {
    return ['chave', texto(dados.conexaoId), texto(dados.chave)].join('\u0001');
  }
  // Servidor e processos: um por CONEXÃO — dois servidores com o mesmo
  // rótulo em grupos diferentes são máquinas diferentes.
  if ((tipo === 'servidor' || tipo === 'processos') && texto(dados.conexaoId) !== '') {
    return [tipo, texto(dados.conexaoId)].join('\u0001');
  }
  return `${tipo}:${titulo}`;
}

/** O título na barra do editor: a tabela diz de qual database é. */
export function tituloDaAba(
  tipo: string,
  titulo: string,
  dados: Readonly<Record<string, unknown>>
): string {
  const database = texto(dados.database);
  if (tipo === 'tabela' && database !== '' && database !== titulo) return `${titulo} · ${database}`;
  return titulo;
}
