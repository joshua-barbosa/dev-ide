// Um motor de mentira que DEVOLVE o corpo recebido.
//
// Prova o caminho binário de SUBIDA, que não dá para exercitar contra o
// SQLite: só as rotas de arquivo remoto aceitam corpo cru, e elas exigem um
// servidor SSH de pé.
import http from 'node:http';

const porta = Number(process.argv[2] ?? 4489);

http
  .createServer((req, res) => {
    // `ligarMotor` confere esta rota antes de aceitar a porta.
    if (req.url.startsWith('/api/connections/drivers')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [], error: null }));
      return;
    }
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => {
      const corpo = Buffer.concat(pedacos);
      if (req.url.includes('erro=1')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, data: null, error: 'o motor recusou' }));
        return;
      }
      // O caso do UPLOAD: sucesso sem bytes para devolver.
      if (req.url.includes('sucessoJson=1')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { bytes: corpo.length }, error: null }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(corpo);
    });
  })
  .listen(porta, '127.0.0.1');
