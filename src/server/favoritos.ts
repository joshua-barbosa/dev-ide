// Os caminhos favoritados por conexão (spec 052).
//
// Mora do lado do servidor, e não no `localStorage`, pela mesma razão do
// `queries.json` da spec 038: favorito é do PROJETO, não do navegador. Trocar
// de máquina ou limpar o site não pode apagar os atalhos de trabalho.
//
// O arquivo é um mapa de `id da conexão` para lista de caminhos. Leitura
// tolerante — um arquivo estragado vira "nenhum favorito", nunca uma exceção
// que impede a árvore de abrir.
import { lerJsonTolerante, gravarJsonAtomico } from './arquivo-json';
import { arquivoDeDados } from './paths';
import { normalizarRemoto } from '../shared/remoto/caminho';

const ARQUIVO = 'favoritos.json';

/** Teto por conexão. Favorito é atalho; mil atalhos não são atalho nenhum. */
export const MAX_FAVORITOS = 200;

type Guardados = Record<string, string[]>;

function arquivo(): string {
  return arquivoDeDados(ARQUIVO);
}

function ler(): Guardados {
  const bruto = lerJsonTolerante(arquivo());
  const limpo: Guardados = {};
  for (const [id, lista] of Object.entries(bruto)) {
    if (!Array.isArray(lista)) continue;
    limpo[id] = lista.filter((c): c is string => typeof c === 'string' && c.startsWith('/'));
  }
  return limpo;
}

export function lerFavoritos(idDaConexao: string): readonly string[] {
  return ler()[idDaConexao] ?? [];
}

/**
 * Liga ou desliga o favorito, e devolve como ficou.
 *
 * Alternar em vez de ter `adicionar` e `remover`: a estrela da tela é um botão
 * só, e dois caminhos para o mesmo gesto dariam duas chances de divergirem.
 */
export function alternarFavorito(idDaConexao: string, caminho: string): readonly string[] {
  const limpo = normalizarRemoto(caminho);
  const todos = ler();
  const atuais = todos[idDaConexao] ?? [];
  const jaTem = atuais.includes(limpo);
  const novos = jaTem
    ? atuais.filter((c) => c !== limpo)
    : [...atuais, limpo].slice(-MAX_FAVORITOS);
  gravarJsonAtomico(arquivo(), { ...todos, [idDaConexao]: novos });
  return novos;
}

/** Some com os favoritos de uma conexão apagada — senão o arquivo só cresce. */
export function esquecerFavoritos(idDaConexao: string): void {
  const todos = ler();
  if (!(idDaConexao in todos)) return;
  const { [idDaConexao]: _removido, ...resto } = todos;
  gravarJsonAtomico(arquivo(), resto);
}
