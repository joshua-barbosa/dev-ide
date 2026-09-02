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
export function homeDeDados(env: NodeJS.ProcessEnv = process.env): string {
  // O `env` é parâmetro para o teste poder perguntar "e se a variável fosse
  // outra?" sem mexer no ambiente do processo — mexer nele vaza para os testes
  // vizinhos, que passam a depender da ordem de execução.
  return env.DEV_IDE_HOME ?? path.join(os.homedir(), '.dev-ide');
}

/** Arquivo dentro da raiz de dados. */
export function arquivoDeDados(nome: string): string {
  return path.join(homeDeDados(), nome);
}

/**
 * Onde ficam os PROJETOS, sabendo se a IDE está empacotada (T094).
 *
 * No modo de desenvolvimento é `<raiz do repositório>/projects`, e continua
 * sendo — mudar isso moveria os projetos dele de lugar sem ninguém pedir.
 *
 * **Empacotada, a raiz cai dentro do `app.asar`, que é somente-leitura.** O
 * servidor tentava `mkdir` ali e não subia; o app abria uma caixa de erro e
 * fechava. Foi o primeiro defeito real da versão desktop, e ele o viu.
 *
 * Empacotada, então, os projetos vão para a mesma casa do cofre e da sessão —
 * que é onde dados de usuário devem estar de qualquer forma, e onde eles
 * sobrevivem a uma atualização do aplicativo.
 */
export function pastaDeProjetos(
  raiz: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const escolhida = env.DEV_IDE_PROJECTS;
  if (escolhida !== undefined && escolhida !== '') return escolhida;
  // `.asar` no caminho é a marca de estar dentro do pacote. Vale para qualquer
  // empacotador que use asar, e não só para o que usamos hoje.
  return raiz.includes('.asar')
    ? path.join(homeDeDados(env), 'projects')
    : path.join(raiz, 'projects');
}
