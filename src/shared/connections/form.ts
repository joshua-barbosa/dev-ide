// Lógica do formulário de conexão.
//
// Mora em `shared` porque não depende de DOM nem de React: são valores iniciais,
// agrupamento, validação e o cálculo do que enviar. Aqui roda em `node:test`,
// que é o que permite provar a regra do segredo sem abrir navegador.
//
// A regra que mais importa está em `camposParaEnviar`: campo secreto em branco
// NÃO é enviado. É isso que preserva o segredo guardado numa edição — o servidor
// só recifra o que recebe. Enviar `''` apagaria a senha em silêncio, e o defeito
// só apareceria na próxima vez que a conexão fosse usada.
import type { FieldSpec, FieldValue, GroupNode, PublicConnection } from '../contracts';

/** Título da seção dos campos que não declaram nenhuma. */
export const SECAO_PRINCIPAL = 'Principal';

export interface Secao {
  readonly titulo: string;
  readonly campos: readonly FieldSpec[];
  /** Só a principal vem aberta; o resto o usuário abre se precisar. */
  readonly aberta: boolean;
}

/** O que os controles seguram. Tudo vira texto menos boolean, que é caixa. */
export type ValoresDoFormulario = Readonly<Record<string, string | boolean>>;

export type ErrosDoFormulario = Readonly<Record<string, string | undefined>>;

function paraControle(valor: FieldValue | undefined): string | boolean {
  if (typeof valor === 'boolean') return valor;
  if (valor === undefined || valor === null) return '';
  return String(valor);
}

/**
 * Valores com que o formulário nasce.
 *
 * Criando: os `default` declarados pelo driver. Editando: o que está salvo, com
 * o padrão cobrindo o que faltar — um campo acrescentado ao driver depois de a
 * conexão existir precisa aparecer preenchido, não vazio.
 *
 * Campo secreto nasce sempre vazio: a API não devolve segredo, e o formulário
 * não pode fingir que devolveu.
 */
export function valoresIniciais(
  campos: readonly FieldSpec[],
  salva: PublicConnection | null
): ValoresDoFormulario {
  const valores: Record<string, string | boolean> = {};
  for (const campo of campos) {
    if (campo.secret === true) {
      valores[campo.name] = '';
      continue;
    }
    const salvo = salva?.fields[campo.name];
    valores[campo.name] = paraControle(salvo === undefined ? campo.default : salvo);
  }
  return valores;
}

/**
 * Os campos que a condição corrente deixa existir (spec 052, D20).
 *
 * "Existir", e não "mostrar": o campo escondido não é validado nem enviado.
 * Fosse só questão de desenhar, um campo obrigatório invisível travaria o botão
 * de salvar sem que a tela mostrasse onde está o problema — e trocar de senha
 * para chave deixaria a senha antiga cifrada no cofre, guardando risco para um
 * modo de autenticação que ninguém usa.
 *
 * Condição que aponta para campo que não existe esconde, em vez de lançar: a
 * `FieldSpec` vem do driver, e um driver com erro de digitação não pode derrubar
 * o formulário inteiro.
 */
export function camposVisiveis(
  campos: readonly FieldSpec[],
  valores: ValoresDoFormulario
): readonly FieldSpec[] {
  return campos.filter((campo) => {
    if (campo.showIf === undefined) return true;
    const atual = valores[campo.showIf.campo];
    if (atual === undefined) return false;
    return campo.showIf.valores.includes(String(atual));
  });
}

/** Agrupa preservando a ordem de declaração; a principal sempre primeiro. */
export function agruparPorSecao(campos: readonly FieldSpec[]): readonly Secao[] {
  const porTitulo = new Map<string, FieldSpec[]>([[SECAO_PRINCIPAL, []]]);
  for (const campo of campos) {
    const titulo = campo.section ?? SECAO_PRINCIPAL;
    const atual = porTitulo.get(titulo);
    if (atual === undefined) porTitulo.set(titulo, [campo]);
    else atual.push(campo);
  }
  return [...porTitulo.entries()]
    .filter(([, lista]) => lista.length > 0)
    .map(([titulo, lista]) => ({
      titulo,
      campos: lista,
      aberta: titulo === SECAO_PRINCIPAL,
    }));
}

function vazio(valor: string | boolean | undefined): boolean {
  return typeof valor === 'string' ? valor.trim() === '' : valor === undefined;
}

/**
 * Validação do lado do cliente.
 *
 * Existe para o usuário não esperar uma ida ao servidor por um campo vazio — e
 * **não** para substituir `DriverRegistry.validate()`, que continua sendo a
 * autoridade (Artigo II). As duas saem da mesma `FieldSpec` justamente para não
 * divergirem.
 */
export function validar(
  campos: readonly FieldSpec[],
  valores: ValoresDoFormulario
): ErrosDoFormulario {
  const erros: Record<string, string> = {};
  for (const campo of camposVisiveis(campos, valores)) {
    const valor = valores[campo.name];

    if (campo.required === true && vazio(valor)) {
      erros[campo.name] = 'Campo obrigatório.';
      continue;
    }
    if (vazio(valor)) continue;

    if (campo.type === 'number' && !Number.isFinite(Number(valor))) {
      erros[campo.name] = 'Precisa ser um número.';
      continue;
    }
    // Só `select` tem lista fechada. Em outro tipo, `options` são SUGESTÕES
    // (spec 052, D22) — e recusar o que não está nelas proibiria justamente o
    // caso que motivou o campo: a chave SSH que mora fora de `~/.ssh`.
    if (
      campo.type === 'select' &&
      campo.options !== undefined &&
      !campo.options.some((o) => o.value === valor)
    ) {
      erros[campo.name] = 'Escolha uma das opções.';
    }
  }
  return erros;
}

/**
 * O que vai no corpo da requisição.
 *
 * Vale igual para criar e para editar — por isso não recebe a conexão salva.
 * Em ambos os casos, segredo em branco significa "não mexi nisso".
 *
 * Três regras, nesta ordem:
 * 1. Campo secreto em branco não é enviado — preserva o segredo guardado.
 * 2. Campo opcional em branco não é enviado — evita gravar `''` onde o driver
 *    espera "não informado".
 * 3. Número vai como número, não como o texto que o controle segurava.
 */
export function camposParaEnviar(
  campos: readonly FieldSpec[],
  valores: ValoresDoFormulario
): Record<string, FieldValue> {
  const enviar: Record<string, FieldValue> = {};
  // Escondido não vai (spec 052, D20). Trocar de senha para chave tem que levar
  // o segredo embora: uma senha cifrada guardada para um modo de autenticação
  // que não se usa é risco sem utilidade.
  for (const campo of camposVisiveis(campos, valores)) {
    const valor = valores[campo.name];

    if (typeof valor === 'boolean') {
      enviar[campo.name] = valor;
      continue;
    }
    if (vazio(valor)) continue;

    enviar[campo.name] = campo.type === 'number' ? Number(valor) : (valor as string);
  }
  return enviar;
}

/** Caminhos de grupo já em uso, para o campo sugerir em vez de exigir digitar. */
export function gruposExistentes(raiz: GroupNode): readonly string[] {
  const caminhos = new Set<string>();
  const percorrer = (grupo: GroupNode): void => {
    if (grupo.path !== '') caminhos.add(grupo.path);
    for (const filho of grupo.groups) percorrer(filho);
  };
  percorrer(raiz);
  return [...caminhos].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
