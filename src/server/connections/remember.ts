// Lembrança do destrancamento do cofre — o "lembrar neste computador".
//
// Decisões que valem registrar:
//
// - Guarda a CHAVE derivada, nunca a senha mestra. A senha não existe fora da
//   memória em forma alguma; a chave existe, cifrada e com prazo.
// - Fica num arquivo SEPARADO do cofre, de propósito: `vault.json` continua
//   inútil sozinho, e um backup só dele não carrega o destrancamento junto.
// - A chave que embrulha vem do `machine-id` + uid. O `machine-id` é legível
//   por todos, então não é segredo — é AMARRA: copiar a pasta para outra
//   máquina produz um embrulho que não abre, e lá a senha volta a ser exigida.
// - O vencimento entra como AAD do GCM. Editar a data no arquivo para esticar o
//   prazo faz a DECIFRA falhar, em vez de passar por uma comparação de data que
//   qualquer editor de texto contornaria.
// - Todo caminho de erro devolve "não há lembrança", jamais uma exceção. Esta
//   peça não pode impedir a IDE de subir: o pior caso aceitável é pedir a senha,
//   que é exatamente o comportamento de quem nunca marcou a caixa.
import * as crypto from 'crypto';
import {
  aceitaLembrancaEmArquivo, plataformaAtual, SEM_LEMBRANCA_NO_WINDOWS, type Plataforma,
} from '../../shared/plataforma';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { arquivoDeDados } from '../paths';

const VERSION = 1 as const;
const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const DIAS_PADRAO = 15;
const MS_POR_DIA = 86_400_000;

/**
 * scrypt barato de propósito — bem mais leve que o do cofre (N=2^15).
 *
 * Lá o atacante ataca uma senha humana, e o custo é a defesa. Aqui a entrada é
 * um identificador de máquina de 32 bytes: força bruta não é o modelo de
 * ameaça, e um parâmetro caro só atrasaria a subida do servidor.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 96 * 1024 * 1024 } as const;

interface Lembranca {
  readonly version: typeof VERSION;
  readonly expiresAt: string;
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
  /**
   * Quem selou isto (T099).
   *
   * Ausente é `maquina` — o formato antigo, e é assim que uma lembrança
   * gravada antes deste campo continua abrindo.
   *
   * O campo existe para o arquivo NÃO ser lido pelo backend errado: um selo do
   * sistema decifrado com a amarra de máquina daria erro de autenticação, e o
   * erro apareceria como "chave inválida" em vez de "este arquivo não é seu".
   */
  readonly backend?: 'maquina' | 'sistema';
}

/**
 * O selo do sistema operacional — o chaveiro (T099).
 *
 * Existe porque a amarra de máquina tem um limite claro: ela deriva a chave de
 * `machine-id` + uid, então **quem lê o disco lê a chave do cofre**. O chaveiro
 * do sistema exige a sessão do usuário destrancada, que é outra coisa.
 *
 * Injetável, e ausente por padrão: no navegador não há chaveiro, e a amarra de
 * máquina continua sendo o que dá para fazer.
 */
export interface SeloDoSistema {
  disponivel(): boolean;
  selar(texto: string): Buffer;
  abrir(dados: Buffer): string;
}

let seloRegistrado: SeloDoSistema | null = null;

/**
 * Registra o chaveiro do sistema, antes de o servidor subir.
 *
 * Módulo-nível porque o `RememberedKey` é construído na carga do
 * `server/index.ts`: quem quiser trocar o backend precisa falar antes disso, e o
 * Electron faz exatamente isso — importa este módulo, registra, e só então
 * importa o servidor.
 */
export function registrarSeloDoSistema(selo: SeloDoSistema | null): void {
  seloRegistrado = selo;
}

function seloAtivo(): SeloDoSistema | null {
  return seloRegistrado !== null && seloRegistrado.disponivel() ? seloRegistrado : null;
}

/** Lê o identificador da máquina. Injetável para o teste não depender do sistema. */
export type LeitorDeMaquina = () => string;

export const machineIdPadrao: LeitorDeMaquina = () =>
  fs.readFileSync('/etc/machine-id', 'utf8').trim();

/**
 * Prazo da lembrança, em dias.
 *
 * Valor inválido cai no padrão em vez de quebrar: uma variável de ambiente
 * digitada errada não pode impedir a IDE de subir. Só aceita inteiro positivo —
 * zero e negativo significariam "já vencida", que é o mesmo que não lembrar.
 *
 * **O ambiente vence o arquivo de preferências** (spec 011). Inverter deixaria
 * a suíte de ponta a ponta sem como forçar um prazo: ambiente é a ferramenta de
 * quem opera, arquivo é a de quem usa.
 */
export function diasDeLembranca(
  env: Readonly<Record<string, string | undefined>>,
  padraoDoArquivo: number = DIAS_PADRAO
): number {
  const bruto = env.DEV_IDE_VAULT_REMEMBER_DAYS;
  if (bruto === undefined) return padraoDoArquivo;
  const dias = Number(bruto.trim());
  if (!Number.isSafeInteger(dias) || dias <= 0) return padraoDoArquivo;
  return dias;
}

/** O mínimo do cofre que a restauração precisa — evita depender da classe inteira. */
export interface CofreRestauravel {
  exists(): boolean;
  unlockWithKey(key: Buffer): void;
}

/**
 * Destranca o cofre pela lembrança, se houver uma válida.
 *
 * Roda na subida do servidor, então **nunca lança**: uma lembrança quebrada não
 * pode impedir a IDE de abrir. Devolve se destrancou, para quem chamar poder
 * informar. A lembrança que não serve é apagada — deixá-la no disco só faria a
 * próxima subida repetir o mesmo trabalho inútil.
 */
export function restaurarCofre(
  vault: CofreRestauravel,
  remember: RememberedKey,
  dias?: number
): boolean {
  try {
    if (!vault.exists()) return false;
    const chave = remember.load();
    if (chave === null) return false;
    vault.unlockWithKey(chave);
    // Prazo DESLIZANTE (T101): usar renova. Eu tinha recusado dizendo que
    // renovar "faz 15 dias virarem para sempre para quem usa todos os dias" —
    // e isso é a descrição da feature, não uma objeção. Quem some por 15 dias
    // continua tendo que redigitar, que é o ponto do prazo.
    if (dias !== undefined) remember.save(chave, dias);
    return true;
  } catch {
    // Chave de um cofre antigo (senha trocada) ou arquivo inconsistente.
    remember.clear();
    return false;
  }
}

export class RememberedKey {
  constructor(
    private readonly filePath: string,
    private readonly lerMaquina: LeitorDeMaquina = machineIdPadrao
  ) {}

  static defaultPath(): string {
    return arquivoDeDados('session.json');
  }

  /** Falso quando a máquina não tem identificador — aí só resta a senha. */
  available(): boolean {
    return seloAtivo() !== null || this.identidade() !== null;
  }

  /** Grava a chave cifrada. Silenciosamente não faz nada se não houver amarra. */
  save(key: Buffer, dias: number): void {
    const selo = seloAtivo();
    if (selo !== null) {
      // O chaveiro do sistema faz a cifra inteira; os campos de `salt`, `iv` e
      // `tag` ficam vazios porque não há nada nossa para guardar neles.
      const expiraEm = new Date(Date.now() + dias * MS_POR_DIA).toISOString();
      const lembranca: Lembranca = {
        version: VERSION,
        expiresAt: expiraEm,
        backend: 'sistema',
        salt: '',
        iv: '',
        tag: '',
        data: selo.selar(key.toString('base64')).toString('base64'),
      };
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.filePath, JSON.stringify(lembranca, null, 2), { mode: 0o600 });
      return;
    }

    const identidade = this.identidade();
    if (identidade === null) return;

    const salt = crypto.randomBytes(SALT_BYTES);
    const expiresAt = new Date(Date.now() + dias * MS_POR_DIA).toISOString();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(CIPHER, this.embrulho(identidade, salt), iv);
    cipher.setAAD(Buffer.from(expiresAt, 'utf8'));
    const data = Buffer.concat([cipher.update(key), cipher.final()]);

    const lembranca: Lembranca = {
      version: VERSION,
      expiresAt,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.filePath, JSON.stringify(lembranca, null, 2), { mode: 0o600 });
  }

  /** A chave lembrada, ou `null` por qualquer motivo — inclusive vencimento. */
  load(): Buffer | null {
    const lembranca = this.ler();
    if (lembranca === null) return null;

    if (Date.parse(lembranca.expiresAt) <= Date.now()) {
      this.clear();
      return null;
    }

    if (lembranca.backend === 'sistema') {
      const selo = seloAtivo();
      // Sem o chaveiro, este arquivo não é legível — e não é erro: é o cofre
      // sendo aberto no navegador, ou noutra sessão. Cai para a senha.
      if (selo === null) return null;
      try {
        return Buffer.from(selo.abrir(Buffer.from(lembranca.data, 'base64')), 'base64');
      } catch {
        // Selo de outro usuário ou de outra instalação, vindo num backup.
        this.clear();
        return null;
      }
    }

    const identidade = this.identidade();
    if (identidade === null) return null;

    try {
      const chave = this.embrulho(identidade, Buffer.from(lembranca.salt, 'base64'));
      const decipher = crypto.createDecipheriv(CIPHER, chave, Buffer.from(lembranca.iv, 'base64'));
      decipher.setAAD(Buffer.from(lembranca.expiresAt, 'utf8'));
      decipher.setAuthTag(Buffer.from(lembranca.tag, 'base64'));
      const aberta = Buffer.concat([
        decipher.update(Buffer.from(lembranca.data, 'base64')),
        decipher.final(),
      ]);
      return aberta.length === KEY_BYTES ? aberta : null;
    } catch {
      // Máquina diferente, arquivo adulterado ou prazo esticado à mão.
      return null;
    }
  }

  /** Até quando a lembrança vale, para a interface avisar antes de vencer. */
  validUntil(): string | null {
    const lembranca = this.ler();
    if (lembranca === null) return null;
    return Date.parse(lembranca.expiresAt) > Date.now() ? lembranca.expiresAt : null;
  }

  clear(): void {
    fs.rmSync(this.filePath, { force: true });
  }

  /** `machine-id` + uid, ou `null` se a máquina não puder ser identificada. */
  /**
   * Por que a lembrança não está disponível — a frase que a tela mostra.
   *
   * `null` quando ela ESTÁ disponível. Existe porque a recusa era silenciosa:
   * marcar "lembrar a senha" no Windows não fazia nada, e ninguém dizia por
   * quê. Silêncio numa opção de segurança é pior que a opção não existir.
   */
  porQueNao(plataforma: Plataforma = plataformaAtual()): string | null {
    if (this.available()) return null;
    return aceitaLembrancaEmArquivo(plataforma)
      ? 'Esta máquina não tem identificador — a senha terá de ser digitada a cada vez.'
      : SEM_LEMBRANCA_NO_WINDOWS;
  }

  private identidade(plataforma: Plataforma = plataformaAtual()): string | null {
    // **No Windows, o backend de ARQUIVO é recusado de propósito.**
    //
    // As duas pernas dele caem lá ao mesmo tempo: o modo `600` do arquivo é
    // ignorado pelo sistema, e a chave é derivada de `/etc/machine-id`, que não
    // existe. O que sobraria seria a chave do cofre legível por quem lesse o
    // disco — exatamente o limite que a nota do `SeloDoSistema` descreve.
    //
    // Recusar aqui, e não confiar em `/etc/machine-id` falhar sozinho: sob Git
    // Bash ou com um disco Linux montado, esse arquivo PODE existir, e aí o
    // backend inseguro nasceria sem ninguém notar. Escolha dele, 03/09/2026.
    if (!aceitaLembrancaEmArquivo(plataforma)) return null;
    try {
      const id = this.lerMaquina();
      if (typeof id !== 'string' || id.trim() === '') return null;
      return `${id.trim()}:${os.userInfo().uid}`;
    } catch {
      return null;
    }
  }

  private embrulho(identidade: string, salt: Buffer): Buffer {
    return crypto.scryptSync(identidade, salt, KEY_BYTES, SCRYPT);
  }

  private ler(): Lembranca | null {
    try {
      const bruto: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (bruto === null || typeof bruto !== 'object') return null;
      const l = bruto as Partial<Lembranca>;
      const completa =
        l.version === VERSION &&
        typeof l.expiresAt === 'string' &&
        typeof l.salt === 'string' &&
        typeof l.iv === 'string' &&
        typeof l.tag === 'string' &&
        typeof l.data === 'string' &&
        !Number.isNaN(Date.parse(l.expiresAt));
      return completa ? (l as Lembranca) : null;
    } catch {
      return null;
    }
  }
}
