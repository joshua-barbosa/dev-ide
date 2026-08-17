// Cofre de credenciais de conexão.
//
// Decisões que valem registrar:
//
// - Campos não-secretos ficam em CLARO no arquivo. É proposital: a árvore de
//   grupos e serviços renderiza com o cofre trancado, e só conectar de verdade
//   exige a senha mestra.
// - Cada segredo é cifrado individualmente com AES-256-GCM, usando
//   `id:campo` como dado autenticado (AAD). Isso amarra o texto cifrado à
//   conexão e ao campo: quem tiver acesso de escrita ao arquivo não consegue
//   mover a senha de uma conexão para outra.
// - A senha mestra nunca sai daqui, em forma alguma. A chave derivada dela pode
//   ser exportada por `exportKey()` para a lembrança de 15 dias (spec 004)
//   guardá-la cifrada e com prazo — este módulo, porém, não escreve chave
//   nenhuma em disco: quem faz isso é `remember.ts`.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { arquivoDeDados } from '../paths';
import type { ConnectionInput, FieldValue, PublicConnection, ResolvedConfig } from './types';

const VERSION = 1 as const;
const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** scrypt com N=2^15 precisa de ~34 MB; o padrão do Node (32 MB) não basta. */
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 } as const;
const VERIFIER_PLAINTEXT = 'dev-ide-vault';
const VERIFIER_AAD = 'dev-ide-vault:verifier';

interface EncryptedValue {
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

interface KdfParams {
  readonly algorithm: 'scrypt';
  readonly salt: string;
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: number;
}

interface StoredConnection {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly group: string;
  readonly readOnly: boolean;
  readonly fields: Record<string, FieldValue>;
  readonly secrets: Record<string, EncryptedValue>;
}

interface VaultFile {
  readonly version: typeof VERSION;
  readonly kdf: KdfParams;
  readonly verifier: EncryptedValue;
  readonly connections: readonly StoredConnection[];
}

function deriveKey(password: string, salt: Buffer, kdf: Pick<KdfParams, 'N' | 'r' | 'p' | 'keyLength'>): Buffer {
  return crypto.scryptSync(password, salt, kdf.keyLength, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT.maxmem,
  });
}

function encrypt(plaintext: string, key: Buffer, aad: string): EncryptedValue {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(value: EncryptedValue, key: Buffer, aad: string): string {
  const decipher = crypto.createDecipheriv(CIPHER, key, Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}

/** AAD de um segredo: amarra o texto cifrado à conexão e ao campo. */
function secretAad(connectionId: string, field: string): string {
  return `dev-ide-vault:${connectionId}:${field}`;
}

function toPublic(stored: StoredConnection): PublicConnection {
  return {
    id: stored.id,
    type: stored.type,
    label: stored.label,
    group: stored.group,
    readOnly: stored.readOnly,
    fields: { ...stored.fields },
    secretFields: Object.keys(stored.secrets).sort(),
  };
}

/** Separa os campos informados entre os que vão em claro e os que vão cifrados. */
function splitFields(
  fields: Readonly<Record<string, FieldValue>>,
  secretNames: readonly string[]
): { plain: Record<string, FieldValue>; secret: Record<string, string> } {
  const secretSet = new Set(secretNames);
  const plain: Record<string, FieldValue> = {};
  const secret: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (secretSet.has(name)) {
      if (value !== '' && value !== undefined) secret[name] = String(value);
    } else {
      plain[name] = value;
    }
  }
  return { plain, secret };
}

export class Vault {
  private file: VaultFile | null = null;
  private key: Buffer | null = null;

  constructor(private readonly filePath: string) {}

  static defaultPath(): string {
    return arquivoDeDados('vault.json');
  }

  exists(): boolean {
    return fs.existsSync(this.filePath);
  }

  isUnlocked(): boolean {
    return this.key !== null;
  }

  create(masterPassword: string): void {
    if (this.exists()) {
      throw new Error('O cofre já existe. Use "destrancar" em vez de criar.');
    }
    const salt = crypto.randomBytes(SALT_BYTES);
    const kdf: KdfParams = {
      algorithm: 'scrypt',
      salt: salt.toString('base64'),
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      keyLength: KEY_BYTES,
    };
    const key = deriveKey(masterPassword, salt, kdf);
    this.file = {
      version: VERSION,
      kdf,
      verifier: encrypt(VERIFIER_PLAINTEXT, key, VERIFIER_AAD),
      connections: [],
    };
    this.key = key;
    this.persist();
  }

  unlock(masterPassword: string): void {
    const file = this.load();
    const key = deriveKey(masterPassword, Buffer.from(file.kdf.salt, 'base64'), file.kdf);
    let verified: string;
    try {
      verified = decrypt(file.verifier, key, VERIFIER_AAD);
    } catch {
      throw new Error('Senha mestra incorreta.');
    }
    if (verified !== VERIFIER_PLAINTEXT) {
      throw new Error('Senha mestra incorreta.');
    }
    this.key = key;
  }

  lock(): void {
    this.key = null;
  }

  /**
   * Devolve a chave derivada, para a lembrança guardá-la cifrada (spec 004).
   *
   * Exporta a CHAVE, nunca a senha: é o que permite lembrar sem que a senha
   * mestra exista fora da memória em forma alguma. Cópia defensiva porque um
   * `Buffer` compartilhado deixaria quem chama zerar a chave do cofre.
   */
  exportKey(): Buffer {
    if (this.key === null) throw new Error('O cofre está trancado.');
    return Buffer.from(this.key);
  }

  /**
   * Destranca com uma chave já derivada, validando-a contra o verificador.
   *
   * A validação é o que faz a troca da senha mestra invalidar uma lembrança
   * antiga de graça: senha nova, verificador novo, chave velha não abre.
   */
  unlockWithKey(key: Buffer): void {
    if (key.length !== KEY_BYTES) {
      throw new Error('Chave de cofre inválida.');
    }
    const file = this.load();
    let verified: string;
    try {
      verified = decrypt(file.verifier, key, VERIFIER_AAD);
    } catch {
      throw new Error('Chave de cofre inválida.');
    }
    if (verified !== VERIFIER_PLAINTEXT) {
      throw new Error('Chave de cofre inválida.');
    }
    this.key = Buffer.from(key);
  }

  /** Funciona com o cofre trancado — é o que permite desenhar a árvore sem senha. */
  list(): PublicConnection[] {
    return this.load().connections.map(toPublic);
  }

  get(id: string): PublicConnection {
    return toPublic(this.find(id));
  }

  add(input: ConnectionInput, secretFields: readonly string[]): PublicConnection {
    const file = this.load();
    const id = crypto.randomUUID();
    const stored = this.buildStored(id, input, input.fields, secretFields);
    this.file = { ...file, connections: [...file.connections, stored] };
    this.persist();
    return toPublic(stored);
  }

  update(id: string, patch: Partial<ConnectionInput>, secretFields: readonly string[]): PublicConnection {
    const file = this.load();
    const current = this.find(id);

    const merged: ConnectionInput = {
      type: patch.type ?? current.type,
      label: patch.label ?? current.label,
      group: patch.group ?? current.group,
      readOnly: patch.readOnly ?? current.readOnly,
      fields: patch.fields ?? current.fields,
    };

    // Sem `fields` no patch, os segredos existentes são preservados como estão.
    const stored =
      patch.fields === undefined
        ? { ...current, type: merged.type, label: merged.label, group: merged.group, readOnly: merged.readOnly }
        : this.buildStored(id, merged, patch.fields, secretFields, current.secrets);

    this.file = {
      ...file,
      connections: file.connections.map((item) => (item.id === id ? stored : item)),
    };
    this.persist();
    return toPublic(stored);
  }

  remove(id: string): void {
    const file = this.load();
    this.find(id);
    this.file = { ...file, connections: file.connections.filter((item) => item.id !== id) };
    this.persist();
  }

  /** Devolve a conexão com os segredos decifrados. Exige o cofre destrancado. */
  resolve(id: string): ResolvedConfig {
    const key = this.requireKey();
    const stored = this.find(id);
    const fields: Record<string, FieldValue> = { ...stored.fields };

    for (const [name, value] of Object.entries(stored.secrets)) {
      try {
        fields[name] = decrypt(value, key, secretAad(stored.id, name));
      } catch {
        throw new Error(
          `O segredo "${name}" da conexão "${stored.label}" está adulterado ou foi cifrado com outra senha.`
        );
      }
    }

    return {
      id: stored.id,
      type: stored.type,
      label: stored.label,
      readOnly: stored.readOnly,
      fields,
    };
  }

  // ---- internos ----

  private buildStored(
    id: string,
    input: ConnectionInput,
    rawFields: Readonly<Record<string, FieldValue>>,
    secretFields: readonly string[],
    previousSecrets: Record<string, EncryptedValue> = {}
  ): StoredConnection {
    const { plain, secret } = splitFields(rawFields, secretFields);
    const secrets: Record<string, EncryptedValue> = { ...previousSecrets };

    if (Object.keys(secret).length > 0) {
      const key = this.requireKey();
      for (const [name, value] of Object.entries(secret)) {
        secrets[name] = encrypt(value, key, secretAad(id, name));
      }
    }

    return {
      id,
      type: input.type,
      label: input.label,
      group: input.group,
      readOnly: input.readOnly,
      fields: plain,
      secrets,
    };
  }

  private find(id: string): StoredConnection {
    const found = this.load().connections.find((item) => item.id === id);
    if (!found) throw new Error(`Conexão não encontrada: ${id}`);
    return found;
  }

  private requireKey(): Buffer {
    if (this.key === null) {
      throw new Error('O cofre está trancado. Destranque com a senha mestra primeiro.');
    }
    return this.key;
  }

  private load(): VaultFile {
    if (this.file !== null) return this.file;
    if (!this.exists()) {
      throw new Error(`Cofre não encontrado em ${this.filePath}. Crie-o com a senha mestra.`);
    }
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as VaultFile;
    if (parsed.version !== VERSION) {
      throw new Error(`Versão de cofre não suportada: ${parsed.version}.`);
    }
    this.file = parsed;
    return parsed;
  }

  /** Escreve via arquivo temporário + rename, para nunca deixar um cofre truncado em disco. */
  private persist(): void {
    if (this.file === null) return;
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);

    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.filePath);
  }
}
