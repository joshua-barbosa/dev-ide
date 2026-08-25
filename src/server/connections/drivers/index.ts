// Ponto único de registro dos drivers.
//
// Adicionar um serviço novo é escrever o driver e incluí-lo nesta lista: o
// formulário, a lista de tipos e as sub-abas da UI saem dos metadados dele.
import type { DriverRegistry } from '../registry';
import { mysqlDriver } from './mysql';
import { postgresDriver } from './postgres';
import { sqliteDriver } from './sqlite';
import { sshDriver } from './ssh';

export const DRIVERS = [mysqlDriver, postgresDriver, sqliteDriver, sshDriver] as const;

export function registerBuiltinDrivers(registry: DriverRegistry): DriverRegistry {
  for (const driver of DRIVERS) {
    registry.register(driver);
  }
  return registry;
}
