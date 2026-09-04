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

import * as http from 'http';

export interface Motor {
  /** Faz um pedido à API do motor e devolve o `data` do envelope. */
  pedir<T>(metodo: string, rota: string, corpo?: unknown): Promise<T>;
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
  return new Promise((resolver, recusar) => {
    const dados = corpo === undefined ? null : JSON.stringify(corpo);
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
          ...(dados === null
            ? {}
            : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) }),
        },
        timeout: 65_000,
      },
      (res) => {
        const pedacos: Buffer[] = [];
        res.on('data', (p: Buffer) => pedacos.push(p));
        res.on('end', () => resolver(Buffer.concat(pedacos).toString('utf8')));
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

/**
 * Sobe o motor, ou se liga ao que já está de pé.
 *
 * @param caminhoDoMotor o `dist/server/index.js`. Vazio usa o que veio junto.
 */
export async function ligarMotor(porta: number, caminhoDoMotor: string): Promise<Motor> {
  if (!(await jaEstaDePe(porta))) {
    const alvo = caminhoDoMotor === '' ? '../../dist/server/index.js' : caminhoDoMotor;
    // `require` e não `import`: o caminho é decidido em tempo de execução, e o
    // host de extensão é CommonJS.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const servidor = require(alvo) as { iniciarServidor(porta: number): Promise<void> };
    process.env.PORT = String(porta);
    await servidor.iniciarServidor(porta);
  }

  return {
    porta,
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
