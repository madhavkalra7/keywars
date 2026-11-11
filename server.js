// Local / standalone server: serves the page and the game socket on one port.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { attach } = require('./game');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Missing public/index.html');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

attach(server);

let port = Number(PORT);
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && !process.env.PORT && port < 3020) {
    console.log(`  Port ${port} is busy, trying ${port + 1}…`);
    server.listen(++port);
  } else {
    console.error(err.message);
    process.exit(1);
  }
});
server.on('listening', () => {
  console.log(`\n  Keywars is running`);
  console.log(`  Local:   http://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  Network: http://${i.address}:${port}`);
    }
  }
  console.log('');
});
server.listen(port);
