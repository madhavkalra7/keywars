// Smoke test: two players join a room, race, and both finish.
const WebSocket = require('ws');
const url = 'ws://localhost:' + (process.env.PORT || 3000);
const open = (name, code) =>
  new Promise((res) => {
    const ws = new WebSocket(url);
    ws.log = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      ws.log.push(m);
      if (m.t === 'state') ws.room = m.room;
      if (m.t === 'start') ws.words = m.words;
      if (m.t === 'joined') res(Object.assign(ws, { code: m.code, id: m.id }));
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, house: 'storm', code })));
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (ok, msg) => { if (!ok) { console.error('FAIL: ' + msg); process.exit(1); } console.log('ok: ' + msg); };

(async () => {
  const page = await (await fetch(url.replace('ws', 'http'))).text();
  assert(page.includes('KEYWARS'), 'page is served');
  const a = await open('Alice');
  const b = await open('Bob', a.code.toLowerCase());
  await wait(100);
  assert(a.room.players.length === 2, 'both players in the room');
  b.send(JSON.stringify({ t: 'start', wordCount: 15 }));
  await wait(100);
  assert(a.room.state === 'lobby', 'non-host cannot start');
  a.send(JSON.stringify({ t: 'start', wordCount: 15 }));
  await wait(200);
  assert(a.room.state === 'countdown' && b.words.length === 15, 'countdown started with 15 words for both');
  b.send(JSON.stringify({ t: 'progress', w: 5, c: 1, wpm: 80, acc: 99 }));
  await wait(100);
  assert(a.room.players[1].prog === 0, 'progress ignored during countdown');
  await wait(4000);
  assert(a.room.state === 'racing', 'race is live');
  b.send(JSON.stringify({ t: 'progress', w: 5, c: 1, wpm: 80, acc: 99 }));
  await wait(100);
  const seen = a.room.players.find((p) => p.id === b.id);
  assert(seen.w === 5 && seen.wpm === 80 && seen.prog > 0.3, 'Alice sees Bob live progress');
  const c = await open('Cara', a.code);
  await wait(100);
  assert(c.words && c.room.players.find((p) => p.id === c.id).racing === false, 'late joiner spectates');
  b.send(JSON.stringify({ t: 'finish', wpm: 90, acc: 98 }));
  a.send(JSON.stringify({ t: 'finish', wpm: 70, acc: 95 }));
  await wait(200);
  assert(a.room.state === 'finished', 'race ends when all racers finish');
  assert(a.room.players.find((p) => p.id === b.id).place === 1, 'Bob placed first');
  a.send(JSON.stringify({ t: 'again' }));
  await wait(100);
  assert(b.room.state === 'lobby', 'host returns everyone to the lobby');
  a.close();
  await wait(100);
  assert(b.room.hostId === b.id && b.room.players.length === 2, 'host passes on when the host leaves');
  process.exit(0);
})();
