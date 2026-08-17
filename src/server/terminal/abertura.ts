// Traduz o pedido do navegador em opções de sessão.
//
// É a fronteira: o cliente diz "quero o shell" ou "quero a conexão X", e é aqui
// que isso vira um comando concreto. O navegador **nunca** manda executável nem
// argumentos — se mandasse, o terminal viraria execução remota arbitrária
// disfarçada de recurso.
import * as os from 'os';
import { montarComando } from '../../shared/terminal/comando';
import type { DriverRegistry } from '../connections/registry';
import type { Vault } from '../connections/vault';
import { MARCADOR_DE_CREDENCIAL, type OpcoesDeSessao } from './session';

export interface DepsDeAbertura {
  readonly registry: DriverRegistry;
  readonly vault: Vault;
  /** Pasta do projeto ativo, quando houver. */
  readonly cwdPadrao: () => string;
}

interface PedidoBruto {
  readonly connectionId?: unknown;
  readonly cols?: unknown;
  readonly rows?: unknown;
  readonly cwd?: unknown;
}

const numero = (valor: unknown, padrao: number): number =>
  typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? Math.trunc(valor) : padrao;

export function criarResolvedorDeAbertura({ registry, vault, cwdPadrao }: DepsDeAbertura) {
  return async function resolverAbertura(pedido: unknown): Promise<OpcoesDeSessao> {
    const p = (pedido ?? {}) as PedidoBruto;
    const cols = numero(p.cols, 80);
    const rows = numero(p.rows, 24);

    // Terminal geral: o shell do usuário, sem credencial nenhuma.
    if (typeof p.connectionId !== 'string' || p.connectionId === '') {
      return {
        comando: {
          exec: process.env.SHELL ?? '/bin/bash',
          // `-l` para o shell carregar o perfil do usuário: sem isso faltam
          // PATH, aliases e prompt, e o terminal parece quebrado.
          args: ['-l'],
          env: {},
          credencial: null,
        },
        cwd: typeof p.cwd === 'string' && p.cwd !== '' ? p.cwd : cwdPadrao(),
        cols,
        rows,
      };
    }

    // Terminal de conexão: o cliente do banco, direto, sem shell no meio.
    const config = vault.resolve(p.connectionId);
    const driver = registry.get(config.type);
    const secretos = registry.secretFields(config.type);

    const senha = String(
      (config.fields as Record<string, unknown>)[driver.cli?.campoDeSenha ?? ''] ?? ''
    );

    const comando = montarComando(
      driver.cli,
      {
        fields: config.fields,
        readOnly: config.readOnly,
        // O caminho real é decidido pela sessão, que escreve o arquivo; aqui
        // basta um marcador de que haverá um.
        arquivoDeCredencial: senha === '' ? null : MARCADOR_DE_CREDENCIAL,
      },
      senha,
      secretos
    );

    if (comando === null) {
      throw new Error(`O tipo "${config.type}" não tem cliente de linha de comando.`);
    }
    return { comando, cwd: os.homedir(), cols, rows };
  };
}
