// Os filtros da árvore que sobrevivem ao reinício (T111, spec 069).
//
// Mesmo padrão de `favoritos.json` (spec 052): mapa por conexão, leitura
// tolerante, gravação atômica, teto por conexão.
//
// **Não vai para o `config.json`.** Aquele arquivo é o que o usuário edita à
// mão, e a spec 011 separou preferência de estado justamente para ele não
// encher de mapa gerado por clique.
import { lerJsonTolerante, gravarJsonAtomico } from './arquivo-json';
import { arquivoDeDados } from './paths';
import {
  FILTRO_VAZIO,
  estaVazio,
  normalizarFiltro,
  type FiltroDaArvore,
} from '../shared/tree/filtro-da-arvore';

const ARQUIVO = 'filtros-da-arvore.json';

/**
 * Teto por conexão.
 *
 * Um filtro por categoria visitada; quem abre muitos schemas acumula. O teto
 * evita que o arquivo cresça sem fim, e descarta os mais ANTIGOS — o filtro que
 * importa é o de onde se estava agora.
 */
export const MAX_FILTROS = 300;

type Guardados = Record<string, Record<string, FiltroDaArvore>>;

function arquivo(): string {
  return arquivoDeDados(ARQUIVO);
}

function ler(): Guardados {
  const bruto = lerJsonTolerante(arquivo());
  const limpo: Guardados = {};
  for (const [id, mapa] of Object.entries(bruto)) {
    if (mapa === null || typeof mapa !== 'object' || Array.isArray(mapa)) continue;
    const porCaminho: Record<string, FiltroDaArvore> = {};
    for (const [caminho, filtro] of Object.entries(mapa as Record<string, unknown>)) {
      const lido = normalizarFiltro(filtro);
      // Filtro vazio no disco é o mesmo que não ter filtro: não se guarda, e o
      // que já estiver lá é descartado na leitura.
      if (!estaVazio(lido)) porCaminho[caminho] = lido;
    }
    limpo[id] = porCaminho;
  }
  return limpo;
}

export function lerFiltros(idDaConexao: string): Record<string, FiltroDaArvore> {
  return ler()[idDaConexao] ?? {};
}

/**
 * Grava o filtro de um caminho, ou o apaga quando vier vazio.
 *
 * Um caminho só: guardar o mapa inteiro a cada mudança daria a duas abas da
 * mesma IDE a chance de uma sobrescrever a outra.
 */
export function guardarFiltro(
  idDaConexao: string,
  caminho: string,
  filtro: FiltroDaArvore
): Record<string, FiltroDaArvore> {
  const todos = ler();
  const atuais = { ...(todos[idDaConexao] ?? {}) };
  const limpo = normalizarFiltro(filtro);
  if (estaVazio(limpo)) {
    delete atuais[caminho];
  } else {
    // Reinserir move a chave para o fim da ordem de inserção — é o que faz o
    // corte abaixo descartar os mais antigos, e não os mais usados.
    delete atuais[caminho];
    atuais[caminho] = limpo;
  }
  const cortado = Object.fromEntries(Object.entries(atuais).slice(-MAX_FILTROS));
  gravarJsonAtomico(arquivo(), { ...todos, [idDaConexao]: cortado });
  return cortado;
}

export { FILTRO_VAZIO };
