// `npm run dev` sobe as DUAS metades da IDE.
//
// O `dev` era só `vite`, e o Vite serve a interface — não o motor. A página
// abria bonita e TODA chamada de API caía num 502, porque o proxy repassava
// para uma porta onde não havia ninguém. O que chegava à tela era "Resposta
// inválida do servidor (HTTP 502)", que não diz o que fazer.
//
// Custou tempo dele duas vezes. Agora o `dev` sobe o motor junto, e quando uma
// das metades cai o terminal diz — em vez de deixar a tela mentir.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORTA_DO_MOTOR = Number(process.env.PORT ?? 4321);
const MOTOR = 'dist/server/index.js';

/** Cor só no terminal de verdade: num arquivo de log seria sujeira. */
const ESC = '\u001b[';
const aviso = (t) =>
  console.log(process.stdout.isTTY ? `${ESC}36m[dev]${ESC}0m ${t}` : `[dev] ${t}`);

const filhos = [];
let encerrando = false;

function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  for (const p of filhos) p.kill('SIGTERM');
  process.exit(codigo);
}
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => encerrar(0));

function rodar(comando, args, nome, env) {
  const p = spawn(comando, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  filhos.push(p);
  p.on('exit', (codigo) => {
    if (encerrando) return;
    // Um dos dois morreu: derruba o outro em vez de deixar MEIA IDE de pé, que
    // é exatamente o estado que produzia o 502.
    aviso(`${nome} encerrou (código ${codigo ?? 0}). Derrubando o resto.`);
    encerrar(codigo ?? 0);
  });
  return p;
}

/**
 * Espera o motor atender, ou desiste dizendo por quê.
 *
 * Trinta segundos é folgado de propósito: numa máquina fria o primeiro
 * `node dist/server/index.js` demora mais que o esperado, e desistir cedo
 * demais trocaria um erro claro por outro.
 */
async function esperarOMotor() {
  const limite = Date.now() + 30_000;
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${PORTA_DO_MOTOR}/api/workspace`);
      return;
    } catch {
      if (Date.now() > limite) {
        aviso(`o motor não atendeu na porta ${PORTA_DO_MOTOR} em 30s. Veja o erro dele acima.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** Espera um `spawn` terminar, recusando se ele falhar. */
function esperar(p) {
  return new Promise((resolver, recusar) => {
    p.on('exit', (c) => (c === 0 ? resolver() : recusar(new Error(`saiu com ${c}`))));
  });
}

// Apontado para um motor de fora (`BRAYTECH_MOTOR`), não subimos nenhum: quem
// mandou o endereço sabe quem está servindo lá.
if (process.env.BRAYTECH_MOTOR !== undefined) {
  aviso(`motor externo: ${process.env.BRAYTECH_MOTOR} — subindo só a interface.`);
} else {
  if (!existsSync(MOTOR)) {
    // `npm test` apaga o `dist` inteiro. Sem esta linha, o primeiro `npm run
    // dev` depois de rodar a suíte caía no mesmo 502.
    aviso('sem `dist/server` — compilando o motor primeiro (o `npm test` apaga o dist).');
    await esperar(spawn('npm', ['run', 'build:server'], { stdio: 'inherit' }));
  }
  aviso(`motor em http://127.0.0.1:${PORTA_DO_MOTOR}`);
  rodar(process.execPath, [MOTOR], 'o motor');
  // ESPERA o motor atender antes de abrir a interface. Sem isto sobra uma
  // janela de um segundo em que o Vite já responde e o motor ainda não: quem
  // abre o navegador rápido demais leva um 502 de uma IDE que está subindo
  // certo — o mesmo erro, agora sem causa nenhuma para achar.
  await esperarOMotor();
  // O proxy passa a apontar para a porta que o motor REALMENTE abriu. Sem
  // isto, um `PORT=4466 npm run dev` subiria o motor na 4466 e o Vite
  // continuaria repassando para a 4321 — o mesmo 502, agora com as duas
  // metades de pé, que é ainda mais difícil de enxergar.
  process.env.BRAYTECH_MOTOR = `http://127.0.0.1:${PORTA_DO_MOTOR}`;
}

// O Vite pelo arquivo dele, e NÃO por `npx vite`.
//
// Com `npx` o filho é o npx, e o Vite é neto: o `SIGTERM` que este script
// manda ao derrubar tudo morre no npx e o Vite fica de pé sozinho — servindo a
// interface com o motor já morto, que é o 502 de novo, agora sem ninguém para
// perceber. Descoberto testando justamente essa queda.
rodar(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], 'o Vite', {
  BRAYTECH_MOTOR: process.env.BRAYTECH_MOTOR,
});
