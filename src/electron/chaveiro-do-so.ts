// O chaveiro do sistema operacional, pelo `safeStorage` do Electron (T099).
//
// A política — quando usar, quando cair para a senha, o que fazer quando a
// chave guardada não serve mais — mora em `shared/chaveiro.ts` e é testada sem
// abrir janela. Aqui fica só o que precisa do Electron.
//
// **O que se guarda é a CHAVE do cofre, e não a senha mestra dele.** A senha
// abre a chave por `scrypt`; guardar a senha daria a quem lesse o chaveiro o
// poder de trocá-la. Guardar a chave dá acesso ao cofre — que é o que se está
// concedendo de propósito — e nada além disso.
import { safeStorage } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ChaveiroDoSistema {
  disponivel(): boolean;
  guardar(chave: Buffer): void;
  ler(): Buffer | null;
  esquecer(): void;
}

/**
 * O chaveiro, guardando ao lado do cofre.
 *
 * O arquivo cifrado fica na pasta do cofre, e não numa pasta do Electron: cofre
 * e chave viajam juntos, e um backup que leve um leva o outro. O conteúdo é
 * inútil noutra máquina — o `safeStorage` amarra a cifra ao usuário e ao
 * sistema —, e é justamente isso que o torna seguro de estar ali.
 */
export function chaveiroDoSistema(pastaDoCofre: string): ChaveiroDoSistema {
  const arquivo = path.join(pastaDoCofre, 'chave-do-sistema.bin');

  return {
    disponivel: () => safeStorage.isEncryptionAvailable(),

    guardar: (chave) => {
      if (!safeStorage.isEncryptionAvailable()) return;
      fs.mkdirSync(pastaDoCofre, { recursive: true, mode: 0o700 });
      // `0o600` pelo mesmo motivo do `vault.json`: o conteúdo é cifrado, mas
      // não há razão para outro usuário da máquina sequer lê-lo.
      fs.writeFileSync(arquivo, safeStorage.encryptString(chave.toString('base64')), {
        mode: 0o600,
      });
    },

    ler: () => {
      if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(arquivo)) return null;
      try {
        return Buffer.from(safeStorage.decryptString(fs.readFileSync(arquivo)), 'base64');
      } catch {
        // Decifra que falha é chave de OUTRO usuário ou de outra instalação —
        // o arquivo veio junto num backup. Não é erro: é "não tenho chave".
        return null;
      }
    },

    esquecer: () => {
      fs.rmSync(arquivo, { force: true });
    },
  };
}
