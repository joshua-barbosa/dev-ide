// Onde a IDE guarda o estado do usuário.
//
// Existe por causa de um defeito real: a suíte de ponta a ponta isolava o cofre
// com `DEV_IDE_VAULT`, mas a lembrança do destrancamento tinha variável PRÓPRIA
// e ficou de fora. Resultado: rodar os testes apagava o `session.json` do
// usuário, e ele precisava redigitar a senha mestra.
//
// A lição é que uma variável por arquivo transfere para quem escreve o teste a
// obrigação de lembrar de todas — e essa memória falha exatamente quando um
// arquivo novo é acrescentado. Com uma raiz só, o arquivo novo nasce isolado.
import * as os from 'os';
import * as path from 'path';

/**
 * Raiz de tudo que a IDE grava para o usuário.
 *
 * Trocar `DEV_IDE_HOME` move o estado inteiro de uma vez — é o que a suíte de
 * ponta a ponta usa para não encostar no do usuário.
 */
export function homeDeDados(): string {
  return process.env.DEV_IDE_HOME ?? path.join(os.homedir(), '.dev-ide');
}

/** Arquivo dentro da raiz de dados. */
export function arquivoDeDados(nome: string): string {
  return path.join(homeDeDados(), nome);
}
