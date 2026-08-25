// `RemoteFiles` sobre SFTP (spec 052, AC-17).
//
// É a primeira implementação do contrato que a spec 005 declarou há um mês. O
// que ele prometia e o protocolo não entrega está anotado em cada método — e o
// que precisou mudar no contrato mudou lá, não aqui.
//
// **A cerca do `Prune Root` passa por aqui, e é o único lugar que a garante.**
// Esconder o botão de subir na tela não é fronteira: qualquer chamada direta à
// rota passaria por cima. Por isso todo caminho entra por `dentroDaCerca`.
import type { SFTPWrapper } from 'ssh2';
import { dentroDaRaiz, normalizarRemoto } from '../../../shared/remoto/caminho';
import {
  entradaDe,
  filtrarOcultos,
  ordenarEntradas,
  type EntradaRemota,
  type ItemDoSftp,
} from './ssh-entradas';
import type { RemoteFile, RemoteFiles } from '../types';

/** Teto de bytes ao abrir arquivo remoto. Acima disso o editor não ajuda. */
export const MAX_BYTES_DE_ARQUIVO = 5 * 1024 * 1024;

export interface ContextoDeArquivos {
  readonly sftp: () => Promise<SFTPWrapper>;
  readonly raiz: string;
  readonly prenderNaRaiz: boolean;
  readonly mostrarOcultos: boolean;
  readonly somenteLeitura: boolean;
  readonly donoPorUid: () => Promise<ReadonlyMap<number, string>>;
}

function dentroDaCerca(ctx: ContextoDeArquivos, caminho: string): string {
  const limpo = normalizarRemoto(caminho);
  if (ctx.prenderNaRaiz && !dentroDaRaiz(ctx.raiz, limpo)) {
    throw new Error(
      `Fora da raiz desta conexão (${ctx.raiz}). ` +
        'A conexão está presa à raiz — desligue "Prender na raiz" para navegar acima dela.'
    );
  }
  return limpo;
}

/**
 * Recusa escrita quando a conexão está marcada somente-leitura (AC-16).
 *
 * No SERVIDOR, e não escondendo botão: a tela é uma sugestão, a rota é a regra.
 * Mesma disciplina da D16, que vale para os bancos.
 */
function podeEscrever(ctx: ContextoDeArquivos): void {
  if (ctx.somenteLeitura) {
    throw new Error('Esta conexão está marcada como somente-leitura.');
  }
}

/** Promessa em cima de um método de callback do `ssh2`. */
function prometer<T>(executar: (pronto: (erro: unknown, valor: T) => void) => void): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    executar((erro, valor) => {
      if (erro !== undefined && erro !== null) {
        rejeitar(erro instanceof Error ? erro : new Error(String(erro)));
        return;
      }
      resolver(valor);
    });
  });
}

/** A listagem completa, sem esconder oculto — é o que a árvore e a tabela usam. */
export async function listarEntradas(
  ctx: ContextoDeArquivos,
  caminho: string
): Promise<readonly EntradaRemota[]> {
  const alvo = dentroDaCerca(ctx, caminho);
  const sftp = await ctx.sftp();
  const itens = await prometer<ItemDoSftp[]>((pronto) =>
    sftp.readdir(alvo, (e, lista) => pronto(e, lista as unknown as ItemDoSftp[]))
  );
  const donos = await ctx.donoPorUid();
  const entradas = itens.map((item) => entradaDe(alvo, item, donos));
  return ordenarEntradas(filtrarOcultos(entradas, ctx.mostrarOcultos));
}

export function criarArquivosRemotos(ctx: ContextoDeArquivos): RemoteFiles {
  return {
    list: async (remotePath) => [...(await listarEntradas(ctx, remotePath))],

    read: async (remotePath): Promise<RemoteFile> => {
      const alvo = dentroDaCerca(ctx, remotePath);
      const sftp = await ctx.sftp();
      const tamanho = await prometer<number>((pronto) =>
        sftp.stat(alvo, (e, attrs) => pronto(e, attrs?.size ?? 0))
      );
      if (tamanho > MAX_BYTES_DE_ARQUIVO) {
        throw new Error(
          `O arquivo tem ${Math.round(tamanho / 1024 / 1024)} MB e o limite para abrir é ` +
            `${MAX_BYTES_DE_ARQUIVO / 1024 / 1024} MB. Use o terminal para inspecioná-lo.`
        );
      }
      const buffer = await prometer<Buffer>((pronto) =>
        sftp.readFile(alvo, (e, dados) => pronto(e, dados))
      );
      return { path: alvo, content: buffer.toString('utf8'), bytes: buffer.byteLength };
    },

    writeBytes: async (remotePath, dados) => {
      podeEscrever(ctx);
      const alvo = dentroDaCerca(ctx, remotePath);
      const sftp = await ctx.sftp();
      await prometer<void>((pronto) => sftp.writeFile(alvo, dados, (e) => pronto(e, undefined)));
    },

    write: async (remotePath, content) => {
      podeEscrever(ctx);
      const alvo = dentroDaCerca(ctx, remotePath);
      const sftp = await ctx.sftp();
      await prometer<void>((pronto) =>
        sftp.writeFile(alvo, Buffer.from(content, 'utf8'), (e) => pronto(e, undefined))
      );
    },

    mkdir: async (remotePath) => {
      podeEscrever(ctx);
      const alvo = dentroDaCerca(ctx, remotePath);
      const sftp = await ctx.sftp();
      await prometer<void>((pronto) => sftp.mkdir(alvo, (e) => pronto(e, undefined)));
    },

    remove: async (remotePath) => {
      podeEscrever(ctx);
      const alvo = dentroDaCerca(ctx, remotePath);
      const sftp = await ctx.sftp();
      // O SFTP tem chamadas diferentes para arquivo e para pasta, e não tem
      // "apagar o que estiver aí". Perguntar antes é uma ida a mais; errar
      // devolve "failure" sem dizer o quê.
      const ehPasta = await prometer<boolean>((pronto) =>
        sftp.stat(alvo, (e, attrs) => pronto(e, attrs?.isDirectory() === true))
      );
      await prometer<void>((pronto) =>
        ehPasta
          ? sftp.rmdir(alvo, (e) => pronto(e, undefined))
          : sftp.unlink(alvo, (e) => pronto(e, undefined))
      );
    },

    rename: async (from, to) => {
      podeEscrever(ctx);
      const origem = dentroDaCerca(ctx, from);
      const destino = dentroDaCerca(ctx, to);
      const sftp = await ctx.sftp();
      await prometer<void>((pronto) =>
        sftp.rename(origem, destino, (e) => pronto(e, undefined))
      );
    },
  };
}
