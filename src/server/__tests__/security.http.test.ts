import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * `fetch` não deixa forjar o cabeçalho Host, então o teste usa node:http direto —
 * é justamente o Host forjado que caracteriza o DNS rebinding.
 */
function request(port: number, headers: http.OutgoingHttpHeaders): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/projects', method: 'GET', headers },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('o app real recusa Host e Origin forjados', async (t) => {
  process.env.DEV_IDE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ide-http-'));
  const { app } = await import('../index');

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(() => resolve(null))));

  const { port } = server.address() as AddressInfo;

  await t.test('Host local passa', async () => {
    assert.equal(await request(port, { Host: `127.0.0.1:${port}` }), 200);
  });

  await t.test('Host de atacante é bloqueado', async () => {
    assert.equal(await request(port, { Host: 'evil.com' }), 403);
  });

  await t.test('Origin externo é bloqueado mesmo com Host local', async () => {
    const status = await request(port, {
      Host: `127.0.0.1:${port}`,
      Origin: 'https://evil.com',
    });
    assert.equal(status, 403);
  });
});
