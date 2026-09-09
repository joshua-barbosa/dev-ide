// O motor da Braytech Code, visto de dentro do VS Code.
//
// **Esta é a peça que a prova de conceito existe para provar.** O motor —
// drivers, cofre, pool, rotas — não é reescrito nem adaptado: é o mesmo
// `dist/server/index.js` que a IDE própria roda, subido aqui dentro do host de
// extensão, que também é Node.
//
// Se já houver um Braytech Code de pé na porta, usamos ELE. Duas cópias do
// motor na mesma máquina brigariam pelo cofre e pelo arquivo de estado — e,
// pior, ele perderia as conexões abertas ao alternar entre as duas janelas.

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

export interface Motor {
  /** Faz um pedido à API do motor e devolve o `data` do envelope. */
  pedir<T>(metodo: string, rota: string, corpo?: unknown): Promise<T>;
  /**
   * O mesmo pedido, mas com corpo e resposta em BYTES.
   *
   * Subir e baixar arquivo do SFTP não passam pelo envelope JSON: o corpo é
   * binário cru. Sem este caminho, as duas únicas rotas binárias da IDE eram
   * as únicas que a webview não conseguia chamar.
   */
  pedirBytes(metodo: string, rota: string, corpo?: Uint8Array): Promise<Uint8Array>;
  readonly porta: number;
}

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
}

/** Há um motor respondendo nesta porta? */
async function jaEstaDePe(porta: number): Promise<boolean> {
  try {
    await pedidoCru('GET', porta, '/api/connections/drivers');
    return true;
  } catch {
    return false;
  }
}

function pedidoCru(
  metodo: string,
  porta: number,
  rota: string,
  corpo?: unknown
): Promise<string> {
  return pedidoBruto(metodo, porta, rota, corpo === undefined ? null : {
    tipo: 'application/json',
    bytes: Buffer.from(JSON.stringify(corpo), 'utf8'),
  }).then((b) => b.toString('utf8'));
}

/** O pedido de verdade. Corpo e resposta em bytes; quem quer texto converte. */
function pedidoBruto(
  metodo: string,
  porta: number,
  rota: string,
  corpo: { tipo: string; bytes: Buffer } | null
): Promise<Buffer> {
  return new Promise((resolver, recusar) => {
    const dados = corpo === null ? null : corpo.bytes;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: porta,
        path: rota,
        method: metodo,
        headers: {
          // A guarda de Host/Origin do motor só aceita loopback — é a mesma
          // proteção que vale para o navegador, e ela continua valendo aqui.
          Host: `127.0.0.1:${porta}`,
          ...(dados === null || corpo === null
            ? {}
            : { 'Content-Type': corpo.tipo, 'Content-Length': dados.length }),
        },
        timeout: 65_000,
      },
      (res) => {
        const pedacos: Buffer[] = [];
        res.on('data', (p: Buffer) => pedacos.push(p));
        res.on('end', () => resolver(Buffer.concat(pedacos)));
      }
    );
    req.on('error', recusar);
    req.on('timeout', () => {
      req.destroy(new Error('O motor não respondeu a tempo.'));
    });
    if (dados !== null) req.write(dados);
    req.end();
  });
}

/** O motor não foi achado em lugar nenhum — a mensagem diz o que fazer. */
export class MotorNaoEncontrado extends Error {
  constructor(readonly tentados: readonly string[]) {
    super(
      'Não encontrei o motor da Braytech Code. Aponte o caminho do ' +
        '`dist/server/index.js` na configuração `braytech.motor`.'
    );
    this.name = 'MotorNaoEncontrado';
  }
}

/**
 * Sobe o motor, ou se liga ao que já está de pé.
 *
 * A ordem importa e é esta:
 *
 * 1. **Já de pé na porta** — usa ELE. Duas cópias na mesma máquina brigariam
 *    pelo cofre e pelo arquivo de estado.
 * 2. **A configuração `braytech.motor`**.
 * 3. **As pastas abertas no editor** — se o projeto da Braytech Code estiver
 *    aberto, o motor dele está a um `dist/server/index.js` de distância. É o
 *    que faz a extensão instalada funcionar sem ninguém configurar nada.
 * 4. **Ao lado da extensão** — o caso de quem a roda de dentro do projeto.
 *
 * Sem nenhum dos quatro, o erro DIZ a configuração que resolve, em vez de falar
 * de rede.
 */
export async function ligarMotor(
  porta: number,
  caminhoDoMotor: string,
  pastasAbertas: readonly string[] = []
): Promise<Motor> {
  if (!(await jaEstaDePe(porta))) {
    // A ordem é de PRECEDÊNCIA, e o desenvolvimento vem antes do pacote: com o
    // repositório aberto, ele quer o motor que acabou de compilar — não uma
    // cópia congelada dentro do `.vsix`. O pacote é o último, e é o que faz a
    // extensão funcionar na máquina de quem só a instalou (spec 106).
    const candidatos = [
      ...(caminhoDoMotor === '' ? [] : [caminhoDoMotor]),
      ...pastasAbertas.map((pasta) => path.join(pasta, 'dist', 'server', 'index.js')),
      path.resolve(__dirname, '..', '..', 'dist', 'server', 'index.js'),
      path.resolve(__dirname, '..', 'motor', 'servidor.js'),
    ];
    const achado = candidatos.find((c) => fs.existsSync(c));
    if (achado === undefined) throw new MotorNaoEncontrado(candidatos);

    // `require` e não `import`: o caminho é decidido em tempo de execução, e o
    // host de extensão é CommonJS.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const servidor = require(achado) as { iniciarServidor(porta: number): Promise<void> };
    process.env.PORT = String(porta);
    await servidor.iniciarServidor(porta);
  }

  return {
    porta,
    async pedirBytes(metodo: string, rota: string, corpo?: Uint8Array): Promise<Uint8Array> {
      const resposta = await pedidoBruto(
        metodo,
        porta,
        rota,
        corpo === undefined
          ? null
          : { tipo: 'application/octet-stream', bytes: Buffer.from(corpo) }
      );
      // O erro do motor continua vindo em JSON, mesmo nas rotas binárias — é o
      // que `lerBytesRemotos` já distinguia pelo `Content-Type`. Aqui a régua é
      // o formato: um envelope de erro é JSON válido com `success: false`.
      if (resposta.length > 0 && resposta[0] === 0x7b) {
        try {
          const envelope = JSON.parse(resposta.toString('utf8')) as Envelope<unknown>;
          if (envelope.success === false) throw new Error(envelope.error ?? 'Erro do motor.');
        } catch (e) {
          if (e instanceof Error && e.name !== 'SyntaxError') throw e;
          // JSON quebrado não é envelope: são bytes que por acaso começam com
          // `{`. Seguem como estão.
        }
      }
      return new Uint8Array(resposta);
    },

    async pedir<T>(metodo: string, rota: string, corpo?: unknown): Promise<T> {
      const bruto = await pedidoCru(metodo, porta, rota, corpo);
      let envelope: Envelope<T>;
      try {
        envelope = JSON.parse(bruto) as Envelope<T>;
      } catch {
        throw new Error(`Resposta inválida do motor em ${rota}.`);
      }
      if (!envelope.success) throw new Error(envelope.error ?? 'Erro do motor.');
      return envelope.data;
    },
  };
}
