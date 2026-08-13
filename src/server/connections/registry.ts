// Registro de drivers.
//
// É o ponto único onde a IDE aprende que um serviço existe. A UI monta a lista
// de tipos e o formulário de conexão a partir daqui, então adicionar um driver
// não exige tocar no frontend.
import type { Driver, FieldSpec, FieldValue } from './types';

/** Descrição de um driver para o frontend (sem a função `connect`). */
export interface DriverInfo {
  readonly type: string;
  readonly label: string;
  readonly kind: Driver['kind'];
  readonly panel: Driver['panel'];
  readonly icon: Driver['icon'];
  readonly defaultPort?: number;
  readonly fields: readonly FieldSpec[];
}

function coerce(spec: FieldSpec, raw: FieldValue): FieldValue {
  switch (spec.type) {
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(value)) {
        throw new Error(`O campo "${spec.label}" (${spec.name}) precisa ser um número.`);
      }
      return value;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const value = String(raw).trim().toLowerCase();
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0' || value === '') return false;
      throw new Error(`O campo "${spec.label}" (${spec.name}) precisa ser verdadeiro ou falso.`);
    }
    case 'select': {
      const value = String(raw).trim();
      const aceitos = (spec.options ?? []).map((option) => option.value);
      if (!aceitos.includes(value)) {
        throw new Error(
          `Valor inválido para "${spec.label}" (${spec.name}): "${value}". Aceitos: ${aceitos.join(', ')}.`
        );
      }
      return value;
    }
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

export class DriverRegistry {
  private readonly drivers = new Map<string, Driver>();

  register(driver: Driver): void {
    if (this.drivers.has(driver.type)) {
      throw new Error(`Driver já registrado: "${driver.type}".`);
    }
    this.drivers.set(driver.type, driver);
  }

  has(type: string): boolean {
    return this.drivers.has(type);
  }

  get(type: string): Driver {
    const driver = this.drivers.get(type);
    if (driver === undefined) {
      const conhecidos = [...this.drivers.keys()].join(', ') || 'nenhum';
      throw new Error(`Tipo de conexão desconhecido: "${type}". Disponíveis: ${conhecidos}.`);
    }
    return driver;
  }

  list(): DriverInfo[] {
    return [...this.drivers.values()].map((driver) => ({
      type: driver.type,
      label: driver.label,
      kind: driver.kind,
      panel: driver.panel,
      icon: driver.icon,
      defaultPort: driver.defaultPort,
      fields: driver.fields,
    }));
  }

  /** Nomes dos campos que o cofre deve cifrar para este tipo. */
  secretFields(type: string): string[] {
    return this.get(type)
      .fields.filter((field) => field.secret === true)
      .map((field) => field.name);
  }

  /**
   * Valida a entrada do formulário na fronteira: recusa campo desconhecido,
   * exige os obrigatórios, aplica defaults e converte os tipos vindos como texto.
   */
  validate(type: string, input: Readonly<Record<string, FieldValue>>): Record<string, FieldValue> {
    const driver = this.get(type);
    const conhecidos = new Set(driver.fields.map((field) => field.name));

    for (const name of Object.keys(input)) {
      if (!conhecidos.has(name)) {
        throw new Error(`Campo desconhecido para "${type}": "${name}".`);
      }
    }

    const resultado: Record<string, FieldValue> = {};
    for (const spec of driver.fields) {
      const informado = input[spec.name];
      const ausente = informado === undefined || informado === '';

      if (ausente) {
        if (spec.default !== undefined) {
          resultado[spec.name] = spec.default;
          continue;
        }
        if (spec.required === true) {
          throw new Error(`O campo "${spec.label}" (${spec.name}) é obrigatório.`);
        }
        continue;
      }
      resultado[spec.name] = coerce(spec, informado);
    }
    return resultado;
  }
}
