// Driver FTP / FTPS (spec 057).
//
// É o segundo driver do painel `Service`, e existe tanto para conectar quanto
// para **provar o desenho**: a sessão dele expõe `files` e mais nada. A aba do
// servidor vai nascer só com a divisória SFTP — sem Terminal, sem Monitor —
// sem que ninguém escreva um `if` para o FTP em lugar nenhum.
//
// Se essa aba nascer com Terminal, o registry está errado.
import { Client, FileInfo } from 'basic-ftp';
import { Readable, Writable } from 'stream';
import { dentroDaRaiz, ehOculto, normalizarRemoto } from '../../../shared/remoto/caminho';
import { ordenarPorColuna } from '../../../shared/remoto/ordenacao';
import { entradaDeFtp, type EntradaDeFtp } from './ftp-entradas';
import { noDeEntrada } from './ssh-arvore';
import { ICONE_DE_FTP } from '../../../shared/icons';
import type { FieldSpec } from '../../../shared/contracts';
import type { Driver, RemoteFile, RemoteFiles, ResolvedConfig, Session } from '../types';

const PORTA_PADRAO = 21;
const TIMEOUT_PADRAO = 5_000;

/** Teto do que se abre no editor. Mesmo do SFTP, pela mesma razão. */
const MAX_BYTES = 5 * 1024 * 1024;

export const CAMPOS_FTP: readonly FieldSpec[] = [
  { name: 'host', label: 'Host', type: 'string', required: true, default: '127.0.0.1' },
  { name: 'port', label: 'Porta', type: 'number', required: true, default: PORTA_PADRAO },
  { name: 'username', label: 'Usuário', type: 'string', required: true, default: 'anonymous' },
  { name: 'password', label: 'Senha', type: 'password', secret: true },
  {
    name: 'tls',
    label: 'TLS (FTPS)',
    type: 'boolean',
    default: false,
    help: 'Cifra a conexão. O servidor precisa oferecer FTPS explícito.',
  },
  {
    name: 'root_path',
    label: 'Raiz',
    type: 'string',
    default: '/',
    help: 'Onde a árvore começa.',
  },
  { name: 'show_hidden', label: 'Mostrar arquivos ocultos', type: 'boolean', default: true },
  {
    name: 'compatible',
    label: 'Modo compatível',
    type: 'boolean',
    default: false,
    help: 'Para servidor antigo: usa LIST em vez de MLSD, e desliga o modo passivo estendido.',
  },
  {
    name: 'timeout',
    label: 'Tempo de conexão (ms)',
    type: 'number',
    default: TIMEOUT_PADRAO,
  },
  {
    name: 'encoding',
    label: 'Codificação',
    type: 'select',
    default: 'utf8',
    options: [
      { value: 'utf8', label: 'UTF-8' },
      { value: 'latin1', label: 'Latin-1 (ISO-8859-1)' },
    ],
    help: 'Servidor Windows antigo costuma falar Latin-1.',
  },
];

interface ConfigFtp {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly tls: boolean;
  readonly raiz: string;
  readonly mostrarOcultos: boolean;
  readonly compativel: boolean;
  readonly timeout: number;
  readonly encoding: string;
}

function lerConfig(campos: ResolvedConfig['fields']): ConfigFtp {
  const porta = Number(campos.port);
  const tempo = Number(campos.timeout);
  return {
    host: String(campos.host ?? '').trim(),
    port: Number.isFinite(porta) && porta > 0 ? porta : PORTA_PADRAO,
    user: String(campos.username ?? 'anonymous').trim(),
    password: String(campos.password ?? ''),
    tls: campos.tls === true,
    raiz: normalizarRemoto(String(campos.root_path ?? '/')),
    mostrarOcultos: campos.show_hidden !== false,
    compativel: campos.compatible === true,
    timeout: Number.isFinite(tempo) ? Math.max(1_000, tempo) : TIMEOUT_PADRAO,
    encoding: campos.encoding === 'latin1' ? 'latin1' : 'utf8',
  };
}

/**
 * Uma operação por vez.
 *
 * O FTP é um protocolo de **estado**: há um diretório corrente, e há um canal
 * de dados que só serve a um comando. Duas listagens em paralelo se atropelam
 * — a segunda vê o diretório que a primeira acabou de trocar. A fila é a forma
 * mais simples de garantir a ordem, e o custo é irrelevante numa árvore que o
 * usuário expande um nó por vez.
 */
function criarFila(): <T>(tarefa: () => Promise<T>) => Promise<T> {
  let ultima: Promise<unknown> = Promise.resolve();
  return <T>(tarefa: () => Promise<T>): Promise<T> => {
    const minha = ultima.then(tarefa, tarefa);
    // A fila não pode parar por causa de um erro de quem estava na frente.
    ultima = minha.catch(() => undefined);
    return minha;
  };
}

async function connect(config: ResolvedConfig): Promise<Session> {
  const ftp = lerConfig(config.fields);
  const client = new Client(ftp.timeout);
  // O `basic-ftp` fala UTF-8 por padrão; servidor Windows antigo não.
  client.ftp.encoding = ftp.encoding === 'latin1' ? 'latin1' : 'utf8';
  if (ftp.compativel) {
    // `MLSD` é a listagem moderna e estruturada; `LIST` é a antiga, texto solto
    // no formato do `ls`. Servidor velho só tem a segunda.
    client.parseList = client.parseList.bind(client);
    client.ftp.ipFamily = 4;
  }

  await client.access({
    host: ftp.host,
    port: ftp.port,
    user: ftp.user,
    password: ftp.password,
    secure: ftp.tls,
    // Um FTPS caseiro costuma ter certificado próprio; recusar por isso seria
    // trocar uma conexão cifrada por nenhuma conexão.
    secureOptions: ftp.tls ? { rejectUnauthorized: false } : undefined,
  });

  const fila = criarFila();

  const dentro = (caminho: string): string => {
    const limpo = normalizarRemoto(caminho);
    if (!dentroDaRaiz(ftp.raiz, limpo)) {
      throw new Error(`Fora da raiz desta conexão (${ftp.raiz}).`);
    }
    return limpo;
  };

  const podeEscrever = (): void => {
    if (config.readOnly) throw new Error('Esta conexão está marcada como somente-leitura.');
  };

  const listar = async (caminho: string): Promise<readonly EntradaDeFtp[]> => {
    const alvo = dentro(caminho);
    const itens: FileInfo[] = await fila(() => client.list(alvo));
    const entradas = itens.map((i) => entradaDeFtp(alvo, i as unknown as Parameters<typeof entradaDeFtp>[1]));
    const visiveis = ftp.mostrarOcultos ? entradas : entradas.filter((e) => !ehOculto(e.name));
    // Pastas antes, e o resto em ordem de gente — o mesmo do SFTP, pela mesma
    // função pura: duas listagens que se parecem têm que ordenar igual.
    return ordenarPorColuna(visiveis, 'nome', 'asc');
  };

  const files: RemoteFiles = {
    list: async (caminho) => [...(await listar(caminho))],

    read: async (caminho): Promise<RemoteFile> => {
      const alvo = dentro(caminho);
      const pedacos: Buffer[] = [];
      let bytes = 0;
      const destino = new Writable({
        write(pedaco: Buffer, _enc, pronto) {
          bytes += pedaco.byteLength;
          // O teto é conferido ENQUANTO baixa, e não depois: o FTP não conta o
          // tamanho antes, e esperar o fim de um arquivo de 2 GB para então
          // recusá-lo seria baixar 2 GB à toa.
          if (bytes > MAX_BYTES) {
            pronto(new Error(`O arquivo passa de ${MAX_BYTES / 1024 / 1024} MB.`));
            return;
          }
          pedacos.push(pedaco);
          pronto();
        },
      });
      await fila(() => client.downloadTo(destino, alvo));
      const conteudo = Buffer.concat(pedacos);
      return { path: alvo, content: conteudo.toString('utf8'), bytes: conteudo.byteLength };
    },

    writeBytes: async (caminho, dados) => {
      podeEscrever();
      const alvo = dentro(caminho);
      await fila(() => client.uploadFrom(Readable.from([dados]), alvo));
    },

    write: async (caminho, conteudo) => {
      podeEscrever();
      const alvo = dentro(caminho);
      await fila(() => client.uploadFrom(Readable.from([Buffer.from(conteudo, 'utf8')]), alvo));
    },

    mkdir: async (caminho) => {
      podeEscrever();
      const alvo = dentro(caminho);
      // `ensureDir` cria os intermediários e MUDA o diretório corrente; voltar
      // à raiz depois é o que mantém a próxima listagem previsível.
      await fila(async () => {
        await client.ensureDir(alvo);
        await client.cd(ftp.raiz);
      });
    },

    remove: async (caminho) => {
      podeEscrever();
      const alvo = dentro(caminho);
      await fila(async () => {
        // O FTP tem comandos diferentes para arquivo e para pasta, e não diz
        // qual é qual sem perguntar. Tentar o de arquivo e cair no de pasta
        // economiza uma ida ao servidor no caso comum.
        try {
          await client.remove(alvo);
        } catch {
          await client.removeDir(alvo);
        }
      });
    },

    rename: async (de, para) => {
      podeEscrever();
      const origem = dentro(de);
      const destino = dentro(para);
      await fila(() => client.rename(origem, destino));
    },
  };

  return {
    kind: 'files',
    children: async (nodePath) => {
      const ultimo = nodePath[nodePath.length - 1];
      const alvo = ultimo === undefined || !ultimo.startsWith('/') ? ftp.raiz : ultimo;
      return (await listar(alvo)).map(noDeEntrada);
    },
    files,
    somenteLeitura: config.readOnly,
    rootPath: ftp.raiz,
    // Nem `shell`, nem `monitor`, nem `exec`: não existe nada disso em FTP, e
    // declarar o que não se tem é o que faria a tela oferecer uma aba vazia.
    describe: async () => (ftp.tls ? 'FTPS' : 'FTP'),
    close: async () => client.close(),
  };
}

export const ftpDriver: Driver = {
  type: 'ftp',
  label: 'FTP / FTPS',
  kind: 'files',
  panel: 'service',
  icon: ICONE_DE_FTP,
  defaultPort: PORTA_PADRAO,
  fields: CAMPOS_FTP,
  connect,
};
