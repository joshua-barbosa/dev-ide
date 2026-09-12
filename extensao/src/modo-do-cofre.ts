// O que fazer com o cofre antes de gravar uma conexão.
//
// PURO de propósito: a extensão copia este arquivo (ver
// `extensao/scripts/copiar-compartilhado.mjs`), e o formulário da IDE usa o
// mesmo. As duas telas decidem igual.
//
// Ele instalou a extensão num notebook sem a IDE e nada gravava: o formulário
// pedia para DESTRANCAR um cofre que não existia, e na extensão não havia
// nenhum caminho que o criasse.

export interface EstadoDoCofre {
  readonly exists: boolean;
  readonly unlocked: boolean;
}

export type ModoDoCofre = 'pronto' | 'criar' | 'destrancar';

export function modoDoCofre(cofre: EstadoDoCofre): ModoDoCofre {
  if (!cofre.exists) return 'criar';
  return cofre.unlocked ? 'pronto' : 'destrancar';
}

/**
 * Confere a senha nova ANTES de mandá-la ao motor.
 *
 * Criado com erro de digitação, o cofre fica trancado para sempre — não há
 * como recuperar a senha. Por isso ela é digitada duas vezes.
 */
export function validarSenhaNova(senha: string, confirmacao: string): string | null {
  if (senha === '') return 'A senha-mestra não pode ser vazia.';
  if (senha !== confirmacao) return 'A senha e a confirmação não batem.';
  return null;
}
