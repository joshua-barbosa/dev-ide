// Deixar o cofre ABERTO, seja qual for o ponto de partida.
//
// Ele instalou a extensão num notebook sem a IDE e viu: *"Cofre não encontrado
// em …/.dev-ide/vault.json. Crie-o com a senha mestra — o que eu tô tentando
// mas ele não cria"*. Não criava porque não havia caminho: o cadeado só
// destrancava, e destrancar um cofre ausente é 400 no motor. Na máquina dele
// de trabalho nunca apareceu, porque o motor da IDE já tinha cofre.
//
// Fora do `extension.ts` de propósito: é daqui que o `conferir:extensao` o
// alcança, e o comando que ninguém executava era exatamente o que quebrava.

import * as vscode from 'vscode';
import { modoDoCofre, validarSenhaNova, type EstadoDoCofre } from './modo-do-cofre';

export interface DepsDoCofre {
  /** Devolve `null` quando o motor recusa — e quem pede já mostrou o erro. */
  pedir<T>(metodo: string, rota: string, corpo?: unknown): Promise<T | null>;
}

/** Cria o cofre se não existe, destranca se está trancado. `true` = ficou aberto. */
export async function garantirCofre(deps: DepsDoCofre): Promise<boolean> {
  const raiz = await deps.pedir<{ vault: EstadoDoCofre }>('GET', '/api/connections');
  if (raiz === null) return false;

  const modo = modoDoCofre(raiz.vault);
  if (modo === 'pronto') return true;
  return modo === 'criar' ? criar(deps) : destrancar(deps);
}

async function criar(deps: DepsDoCofre): Promise<boolean> {
  const senha = await vscode.window.showInputBox({
    title: 'Criar o cofre da Braytech Code',
    prompt: 'Escolha a senha-mestra. Ela cifra as senhas das conexões e NÃO se recupera.',
    password: true,
    ignoreFocusOut: true,
  });
  if (senha === undefined) return false;
  const confirmacao = await vscode.window.showInputBox({
    title: 'Criar o cofre da Braytech Code',
    prompt: 'Repita a senha-mestra',
    password: true,
    ignoreFocusOut: true,
  });
  if (confirmacao === undefined) return false;

  const erro = validarSenhaNova(senha, confirmacao);
  if (erro !== null) {
    void vscode.window.showErrorMessage(`Braytech Code: ${erro}`);
    return false;
  }
  const criado = await deps.pedir('POST', '/api/connections/vault', { password: senha });
  if (criado === null) return false;
  void vscode.window.showInformationMessage(
    'Braytech Code: cofre criado e destrancado. Guarde a senha — ela não se recupera.'
  );
  return true;
}

async function destrancar(deps: DepsDoCofre): Promise<boolean> {
  const senha = await vscode.window.showInputBox({
    prompt: 'Senha-mestra do cofre da Braytech Code',
    password: true,
    ignoreFocusOut: true,
  });
  if (senha === undefined || senha === '') return false;
  const ok = await deps.pedir('POST', '/api/connections/vault/unlock', { password: senha });
  return ok !== null;
}
