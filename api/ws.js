// Vercel Function entrypoint: the game socket lives at /api/ws.
// The page itself is served statically from /public.
const http = require('http');
const { attach } = require('../game');

const server = http.createServer((req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('This endpoint expects a WebSocket connection.');
});
attach(server);

module.exports = server;
