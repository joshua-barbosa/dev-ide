// Quando o chaveiro do sistema abre o cofre, e quando ele NÃO abre (T099).
//
// A decisão dele, registrada na triagem: *"No desktop usa o chaveiro; no
// navegador segue a senha mestra. vault.json como fallback."*
//
// **Este arquivo é só a política.** Quem fala com o chaveiro do sistema é o
// `electron/chaveiro-do-so.ts`, porque `safeStorage` só existe dentro do
// Electron. Separar assim é o que permite testar a parte que erra — a ordem das
// tentativas e o que fazer quando a chave guardada não serve mais — sem abrir
// uma janela.
//
// **A regra que governa tudo: o chaveiro é um ATALHO, nunca a única porta.** Se
// ele falhar por qualquer motivo — não existe, o sistema recusou, a chave não
// abre mais o cofre —, a senha mestra continua valendo. Um cofre que só abre
// pelo chaveiro é um cofre que se perde quando o sistema é reinstalado.

export type ModoDeAbertura =
  /** Tentar a chave guardada. */
  | { readonly tipo: 'chaveiro' }
  /** Pedir a senha mestra a ele. */
  | { readonly tipo: 'senha'; readonly motivo: string }
  /** Não há cofre ainda: o primeiro uso cria um. */
  | { readonly tipo: 'criar' };

export interface EstadoDoChaveiro {
  /** O cofre existe em disco. */
  readonly cofreExiste: boolean;
  /** O `safeStorage` está disponível E o sistema tem chaveiro utilizável. */
  readonly chaveiroDisponivel: boolean;
  /** Há uma chave guardada para este cofre. */
  readonly temChaveGuardada: boolean;
  /**
   * Ele desligou o chaveiro nas preferências.
   *
   * Existe porque a escolha é dele: alguém que compartilha a máquina pode
   * preferir digitar a senha toda vez, e a IDE não decide isso.
   */
  readonly desligadoPorEle: boolean;
}

/**
 * Como abrir o cofre nesta máquina, agora.
 *
 * A ordem é deliberada, e cada degrau tem um motivo:
 *
 * 1. **Sem cofre, criar.** Não há o que abrir, e pedir senha para um cofre
 *    inexistente confundiria.
 * 2. **Ele desligou, senha.** A escolha dele vem antes da conveniência.
 * 3. **Sem chaveiro no sistema, senha.** Linux sem `libsecret`, sessão sem
 *    keyring destrancado, navegador — todos caem aqui, e o motivo é dito.
 * 4. **Sem chave guardada, senha.** É o primeiro uso depois de ligar o
 *    chaveiro: a chave só é guardada DEPOIS de uma abertura bem-sucedida.
 * 5. **Só então, chaveiro.**
 */
export function comoAbrir(e: EstadoDoChaveiro): ModoDeAbertura {
  if (!e.cofreExiste) return { tipo: 'criar' };
  if (e.desligadoPorEle) {
    return { tipo: 'senha', motivo: 'O chaveiro do sistema está desligado nas preferências.' };
  }
  if (!e.chaveiroDisponivel) {
    return {
      tipo: 'senha',
      motivo:
        'Este sistema não tem chaveiro disponível — no Linux ele depende do ' +
        'libsecret e de uma sessão com o keyring destrancado. No navegador ele ' +
        'nunca existe.',
    };
  }
  if (!e.temChaveGuardada) {
    return {
      tipo: 'senha',
      motivo:
        'Ainda não há chave guardada para este cofre. Ela é guardada DEPOIS de ' +
        'uma abertura que deu certo — guardar antes seria guardar uma chave que ' +
        'talvez não abra nada.',
    };
  }
  return { tipo: 'chaveiro' };
}

/**
 * O que fazer quando a chave do chaveiro NÃO abriu o cofre.
 *
 * Acontece de verdade: ele trocou a senha mestra noutra máquina e sincronizou o
 * cofre, ou o arquivo foi restaurado de um backup anterior. A chave guardada
 * ficou velha.
 *
 * **Cair para a senha, e ESQUECER a chave velha.** Mantê-la faria a próxima
 * abertura tentar de novo o que já se sabe que não funciona — e o usuário veria
 * o mesmo tropeço em toda inicialização, sem entender por quê.
 */
export function aposFalharComAChave(): {
  readonly proximo: ModoDeAbertura;
  readonly esquecerChave: true;
} {
  return {
    proximo: {
      tipo: 'senha',
      motivo:
        'A chave guardada não abre mais este cofre — a senha mestra deve ter ' +
        'mudado, ou o arquivo veio de outra máquina. Digite a senha; a chave ' +
        'nova é guardada em seguida.',
    },
    esquecerChave: true,
  };
}

/**
 * Se vale guardar a chave depois de uma abertura por senha.
 *
 * Só quando o chaveiro existe E ele não o desligou. Guardar sem poder ler
 * depois seria pôr uma cópia da chave num lugar que ninguém vai usar.
 */
export function valeGuardarAChave(e: EstadoDoChaveiro): boolean {
  return e.chaveiroDisponivel && !e.desligadoPorEle;
}
