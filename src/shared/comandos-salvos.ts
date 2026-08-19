// Comandos salvos e descobertos.
//
// Dois tipos de comando, com regras opostas:
//
// - **descobertos** vêm do `package.json`/`composer.json` da pasta aberta, não
//   são editáveis e somem ao trocar de pasta;
// - **salvos** o usuário cria, valem em qualquer pasta e moram em
//   `commands.json`.
//
// Foi o que o usuário pediu com estas palavras: "eu criar um comando e salvar
// ali e eu poder rodar ele em qualquer projeto, sem precisar de arquivo".
//
// O conceito de `tasks.json` do VS Code fica de fora — configuração, tarefas
// compostas, de fundo e grupos são máquina demais para um projeto de uma pessoa.

/** Para onde o comando vai ao ser escolhido. */
export type DestinoDeComando = 'shell' | 'sql';

export const DESTINOS: readonly DestinoDeComando[] = ['shell', 'sql'];

export interface ComandoSalvo {
  readonly id: string;
  readonly nome: string;
  readonly comando: string;
  readonly destino: DestinoDeComando;
}

export interface ComandoDescoberto {
  readonly nome: string;
  readonly comando: string;
  /** `package.json` ou `composer.json` — é o que a lista mostra em cinza. */
  readonly origem: string;
}

export const MAX_NOME = 60;
export const MAX_COMANDO = 4_000;

function ehDestino(valor: unknown): valor is DestinoDeComando {
  return typeof valor === 'string' && (DESTINOS as readonly string[]).includes(valor);
}

/**
 * Fronteira rígida: o que a rota recebe.
 *
 * Mesma divisão da spec 011 — o arquivo tolera, a rota recusa. Aqui quem erra é
 * código nosso ou um formulário, e aceitar em silêncio esconderia o defeito.
 */
export function validarComando(
  bruto: unknown,
  existentes: readonly ComandoSalvo[] = []
): Omit<ComandoSalvo, 'id'> {
  const r = (bruto ?? {}) as Record<string, unknown>;
  const nome = typeof r.nome === 'string' ? r.nome.trim() : '';
  const comando = typeof r.comando === 'string' ? r.comando.trim() : '';

  if (nome === '') throw new Error('O comando precisa de um nome.');
  if (nome.length > MAX_NOME) throw new Error(`O nome passa de ${MAX_NOME} caracteres.`);
  if (comando === '') throw new Error('O comando não pode ser vazio.');
  if (comando.length > MAX_COMANDO) {
    throw new Error(`O comando passa de ${MAX_COMANDO} caracteres.`);
  }
  if (!ehDestino(r.destino)) {
    throw new Error(`Destino inválido: esperado um de ${DESTINOS.join(', ')}.`);
  }
  if (existentes.some((c) => c.nome.toLowerCase() === nome.toLowerCase())) {
    throw new Error(`Já existe um comando salvo chamado "${nome}".`);
  }
  return { nome, comando, destino: r.destino };
}

/** Fronteira tolerante: o que o arquivo traz. Entrada estragada é ignorada. */
export function normalizarLista(bruto: unknown): readonly ComandoSalvo[] {
  if (!Array.isArray(bruto)) return [];
  const saida: ComandoSalvo[] = [];
  for (const item of bruto) {
    const r = (item ?? {}) as Record<string, unknown>;
    if (
      typeof r.id !== 'string' || r.id === '' ||
      typeof r.nome !== 'string' || r.nome.trim() === '' ||
      typeof r.comando !== 'string' || r.comando.trim() === '' ||
      !ehDestino(r.destino)
    ) {
      continue;
    }
    saida.push({ id: r.id, nome: r.nome, comando: r.comando, destino: r.destino });
  }
  return saida;
}

export function acrescentar(
  atuais: readonly ComandoSalvo[],
  novo: ComandoSalvo
): readonly ComandoSalvo[] {
  return [...atuais, novo];
}

export function remover(
  atuais: readonly ComandoSalvo[],
  id: string
): readonly ComandoSalvo[] {
  return atuais.filter((c) => c.id !== id);
}

/**
 * Extrai os `scripts` de um `package.json` ou `composer.json`.
 *
 * Arquivo ilegível, sem `scripts` ou com `scripts` que não é objeto devolve
 * lista vazia — um manifesto estranho não pode impedir a IDE de listar o resto.
 *
 * O `composer.json` aceita **array** como valor de script (uma sequência de
 * comandos). Nesse caso o que importa é o nome, e quem executa é o `composer` —
 * então o texto mostrado é a invocação, não o conteúdo.
 */
export function scriptsDoManifesto(
  conteudo: string,
  origem: 'package.json' | 'composer.json'
): readonly ComandoDescoberto[] {
  let json: unknown;
  try {
    json = JSON.parse(conteudo);
  } catch {
    return [];
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return [];

  const scripts = (json as Record<string, unknown>).scripts;
  if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return [];

  const prefixo = origem === 'package.json' ? 'npm run' : 'composer run';
  const saida: ComandoDescoberto[] = [];
  for (const [nome, valor] of Object.entries(scripts as Record<string, unknown>)) {
    if (nome.trim() === '') continue;
    if (typeof valor !== 'string' && !Array.isArray(valor)) continue;
    saida.push({ nome, comando: `${prefixo} ${nome}`, origem });
  }
  return saida;
}
