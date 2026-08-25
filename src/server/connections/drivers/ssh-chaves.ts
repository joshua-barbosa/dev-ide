// As chaves privadas que existem em `~/.ssh/` (spec 052, D22).
//
// A tela de referência tem um `...` que abre o diálogo de arquivo do sistema.
// Num navegador isso não existe — mas o servidor da IDE roda NA MÁQUINA do
// usuário, então dá para oferecer as chaves de verdade em vez de pedir que ele
// digite um caminho de cabeça.
//
// Aqui só se lê **nome e caminho**. O conteúdo da chave nunca passa por este
// módulo: quem a lê é o driver, no momento de conectar, e ela vai direto para o
// `ssh2`.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Arquivos de `~/.ssh` que nunca são chave privada. */
const NAO_SAO_CHAVE = new Set([
  'authorized_keys',
  'known_hosts',
  'known_hosts.old',
  'config',
  'environment',
  'rc',
]);

export interface ChaveEncontrada {
  readonly nome: string;
  readonly caminho: string;
}

function pastaPadrao(): string {
  return path.join(os.homedir(), '.ssh');
}

/**
 * Lista as chaves privadas prováveis.
 *
 * "Prováveis" é o melhor que dá para dizer sem abrir o arquivo, e abrir seria
 * ler material secreto para montar um seletor. O critério é por eliminação:
 * arquivo comum, que não seja `.pub`, e que não esteja na lista de arquivos que
 * o OpenSSH usa para outra coisa. Chave com nome esquisito entra; um arquivo
 * solto que o usuário deixou lá também — e isso é melhor que esconder a chave
 * que ele realmente usa.
 *
 * Nunca lança: sem `~/.ssh` a lista é vazia, e o campo continua aceitando
 * caminho digitado.
 */
export function listarChaves(pasta: string = pastaPadrao()): readonly ChaveEncontrada[] {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(pasta, { withFileTypes: true });
  } catch {
    return [];
  }

  return entradas
    .filter((e) => e.isFile() && !e.name.endsWith('.pub') && !NAO_SAO_CHAVE.has(e.name))
    .map((e) => ({ nome: e.name, caminho: path.join(pasta, e.name) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
