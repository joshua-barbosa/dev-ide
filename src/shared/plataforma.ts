// O que muda entre Windows, Linux e macOS.
//
// Existe para as decisões de portabilidade morarem num lugar só, testáveis sem
// o sistema operacional em questão — eu não tenho Windows para rodar, e
// espalhar `process.platform === 'win32'` pelo código faria cada uma delas
// depender de alguém lembrar de conferir.
//
// A regra: nada aqui LÊ o sistema. Tudo recebe a plataforma como argumento.

export type Plataforma = 'win32' | 'darwin' | 'linux';

/** A plataforma de agora, no formato do `process.platform`. */
export function plataformaAtual(p: string = process.platform): Plataforma {
  if (p === 'win32') return 'win32';
  if (p === 'darwin') return 'darwin';
  return 'linux';
}

/**
 * O shell do terminal interativo.
 *
 * No Windows não existe `$SHELL`: quem diz qual é o interpretador é o
 * `ComSpec`, e o padrão dele é o `cmd.exe`. O PowerShell seria mais capaz, mas
 * escolher por ele seria decidir pelo usuário — o `ComSpec` é o que o sistema
 * já respondeu.
 */
export function shellDoTerminal(
  plataforma: Plataforma,
  env: Readonly<Record<string, string | undefined>>
): string {
  if (plataforma === 'win32') return env.ComSpec ?? 'cmd.exe';
  return env.SHELL ?? '/bin/bash';
}

/**
 * Como rodar um arquivo de script de shell.
 *
 * `.sh` no Windows não tem interpretador nativo. Quem tem Git para Windows tem
 * o `bash` no PATH, e é o caso comum — mas quando não tem, o erro precisa dizer
 * ISSO, e não "comando não encontrado".
 */
export function comandoDeShellScript(plataforma: Plataforma): {
  readonly exec: string;
  readonly aviso: string | null;
} {
  if (plataforma === 'win32') {
    return {
      exec: 'bash',
      aviso:
        'No Windows, rodar `.sh` exige o `bash` no PATH — ele vem com o Git '
        + 'para Windows. Sem ele, o script não roda.',
    };
  }
  return { exec: 'bash', aviso: null };
}

/**
 * O caminho é absoluto?
 *
 * `startsWith('/')` só responde no Unix: no Windows um caminho absoluto é
 * `C:\...` ou `\\servidor\pasta`. Esta função responde para os dois, e é usada
 * onde a resposta decide o que a IDE abre.
 *
 * Repare que ela NÃO pergunta ao sistema: um caminho de servidor remoto é
 * sempre Unix, mesmo lido de um Windows, e por isso quem chama diz qual regra
 * quer.
 */
export function ehCaminhoAbsoluto(caminho: string, plataforma: Plataforma): boolean {
  if (caminho === '') return false;
  if (plataforma !== 'win32') return caminho.startsWith('/');
  // `C:\`, `C:/` e o compartilhamento de rede `\\servidor\pasta`.
  return /^[a-zA-Z]:[\\/]/.test(caminho) || caminho.startsWith('\\\\');
}

/**
 * A lembrança da senha do cofre pode ser gravada em ARQUIVO nesta plataforma?
 *
 * **Não no Windows**, e a razão é concreta: aquele arquivo é protegido por modo
 * `600` — que o Windows ignora — e a chave dele é derivada de
 * `/etc/machine-id`, que lá não existe. As duas pernas do backend `maquina`
 * caem ao mesmo tempo, e o que sobraria seria a chave do cofre legível por
 * quem lesse o disco.
 *
 * No Windows, portanto, só o chaveiro do sistema (DPAPI, pelo `safeStorage`).
 * Foi a escolha DELE em 03/09/2026, e é a mais segura das duas.
 */
export function aceitaLembrancaEmArquivo(plataforma: Plataforma): boolean {
  return plataforma !== 'win32';
}

/** Por que a lembrança foi recusada — a frase que a tela mostra. */
export const SEM_LEMBRANCA_NO_WINDOWS =
  'No Windows, lembrar a senha exige o chaveiro do sistema — que só existe no '
  + 'aplicativo, não no navegador. O arquivo de lembrança do Linux é protegido '
  + 'por permissão de arquivo, e o Windows não tem equivalente.';

/**
 * Os nomes de arquivo que um executável pode ter naquela plataforma.
 *
 * No Unix é o nome, e pronto. No Windows, `bash` é `bash.exe`, `npm` é
 * `npm.cmd` — quem diz quais sufixos valem é o `PATHEXT`, e procurar só pelo
 * nome cru não acharia nenhum dos dois.
 */
export function nomesDoExecutavel(
  exec: string,
  plataforma: Plataforma,
  env: Readonly<Record<string, string | undefined>> = {}
): readonly string[] {
  if (plataforma !== 'win32') return [exec];
  // Nome que já traz extensão é usado como veio.
  if (/\.[a-zA-Z0-9]+$/.test(exec)) return [exec];
  const sufixos = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return sufixos.map((s) => exec + s.toLowerCase());
}

/** O caminho já diz onde o programa está, em vez de depender do PATH? */
export function ehCaminhoDeExecutavel(exec: string, plataforma: Plataforma): boolean {
  return plataforma === 'win32'
    ? exec.includes('\\') || exec.includes('/')
    : exec.includes('/');
}
