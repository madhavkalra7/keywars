// Keywars game logic: rooms, races and live progress over WebSockets.
// Used by server.js (local / any Node host) and api/ws.js (Vercel Function).
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const MAX_PLAYERS = 8;
const COUNTDOWN_MS = 4000;
const HOUSES = ['ember', 'storm', 'briar', 'honey'];

const WORDS = (
  'the of and to in is you that it he was for on are as with his they at be this have from or one had by word but not ' +
  'what all were we when your can said there use an each which she do how their if will up other about out many then ' +
  'them these so some her would make like him into time has look two more write go see number no way could people my ' +
  'than first water been call who oil its now find long down day did get come made may part over new sound take only ' +
  'little work know place year live me back give most very after thing our just name good sentence man think say great ' +
  'where help through much before line right too mean old any same tell boy follow came want show also around form ' +
  'three small set put end does another well large must big even such because turn here why ask went men read need ' +
  'land different home us move try kind hand picture again change off play spell air away animal house point page ' +
  'letter mother answer found study still learn should world high every near add food between own below country plant ' +
  'wand potion cauldron owl castle wizard witch broom charm curse magic scroll quill ink candle tower dungeon forest ' +
  'dragon phoenix feather cloak robe midnight moon star lantern secret riddle portrait ghost goblin elixir crystal ' +
  'enchant vanish shimmer whisper parchment library raven toad lightning mirror stone chamber prophecy familiar ' +
  'herb root silver golden ember storm shadow lumen rune tome sorcery spellbook apprentice banquet staircase'
).split(' ');

const rooms = new Map();
let nextId = 1;

function pickWords(n) {
  const out = [];
  while (out.length < n) {
    const w = WORDS[Math.floor(Math.random() * WORDS.length)];
    if (w !== out[out.length - 1]) out.push(w);
  }
  return out;
}

function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const send = (ws, msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));

function snapshot(room) {
  return {
    t: 'state',
    room: {
      code: room.code,
      state: room.state,
      hostId: room.hostId,
      wordCount: room.wordCount,
      players: [...room.players.values()].map(({ ws, token, dropTimer, ...p }) => ({ ...p, away: !ws })),
    },
  };
}

function broadcast(room, msg = snapshot(room)) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(data);
}

function endRace(room) {
  clearTimeout(room.startTimer);
  clearTimeout(room.endTimer);
  room.state = 'finished';
  broadcast(room);
}

function checkEnd(room) {
  if (room.state !== 'racing') return;
  const racers = [...room.players.values()].filter((p) => p.racing);
  if (racers.every((p) => p.finished)) endRace(room);
}

function clampNum(v, lo, hi) {
  v = Number(v);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

// A player whose socket dropped is kept for a grace period so they can reconnect
// (hosts like Vercel close every connection when the function hits its max duration).
const GRACE_MS = 12000;

function resume(ws, room, p) {
  clearTimeout(p.dropTimer);
  if (p.ws && p.ws !== ws) {
    const stale = p.ws;
    stale.player = stale.room = null;
    stale.close();
  }
  p.ws = ws;
  ws.player = p;
  ws.room = room;
  send(ws, { t: 'joined', id: p.id, code: room.code, token: p.token, resumed: true });
  broadcast(room);
  if (room.state === 'countdown' || room.state === 'racing') {
    send(ws, { t: 'start', words: room.words, in: room.startAt - Date.now(), racing: p.racing, resumed: true });
  }
}

function drop(room, player) {
  if (player.ws || room.players.get(player.id) !== player) return;
  room.players.delete(player.id);
  if (room.players.size === 0) {
    clearTimeout(room.startTimer);
    clearTimeout(room.endTimer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === player.id) room.hostId = room.players.keys().next().value;
  broadcast(room);
  checkEnd(room);
}

const handlers = {
  join(ws, m) {
    if (ws.player) return;
    let room;
    if (m.code) {
      room = rooms.get(String(m.code).toUpperCase().trim());
      if (room && m.token) {
        const old = [...room.players.values()].find((p) => p.token === m.token);
        if (old) return resume(ws, room, old);
      }
      if (!room) return send(ws, { t: 'error', msg: 'No such chamber. Check the code.' });
      if (room.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'That chamber is full.' });
    } else {
      room = { code: makeCode(), state: 'lobby', players: new Map(), hostId: null, wordCount: 30, words: [], places: 0 };
      rooms.set(room.code, room);
    }
    const player = {
      id: nextId++,
      name: String(m.name || '').trim().slice(0, 16) || 'Wizard',
      house: HOUSES.includes(m.house) ? m.house : HOUSES[0],
      ws,
      token: crypto.randomBytes(12).toString('hex'),
      dropTimer: null,
      w: 0, c: 0, prog: 0, wpm: 0, acc: 100,
      finished: false, place: 0, racing: false,
    };
    room.players.set(player.id, player);
    if (!room.hostId) room.hostId = player.id;
    ws.player = player;
    ws.room = room;
    send(ws, { t: 'joined', id: player.id, code: room.code, token: player.token });
    broadcast(room);
    if (room.state === 'countdown' || room.state === 'racing') {
      send(ws, { t: 'start', words: room.words, in: room.startAt - Date.now(), racing: false });
    }
  },

  start(ws, m) {
    const { room, player } = ws;
    if (!room || room.hostId !== player.id || room.state !== 'lobby') return;
    room.wordCount = [15, 30, 50].includes(m.wordCount) ? m.wordCount : 30;
    room.words = pickWords(room.wordCount);
    room.state = 'countdown';
    room.startAt = Date.now() + COUNTDOWN_MS;
    room.places = 0;
    for (const p of room.players.values()) {
      Object.assign(p, { w: 0, c: 0, prog: 0, wpm: 0, acc: 100, finished: false, place: 0, racing: true });
    }
    broadcast(room);
    broadcast(room, { t: 'start', words: room.words, in: COUNTDOWN_MS, racing: true });
    room.startTimer = setTimeout(() => {
      room.state = 'racing';
      broadcast(room);
      checkEnd(room);
    }, COUNTDOWN_MS);
    room.endTimer = setTimeout(() => endRace(room), COUNTDOWN_MS + 30000 + room.wordCount * 3000);
  },

  progress(ws, m) {
    const { room, player: p } = ws;
    if (!room || room.state !== 'racing' || !p.racing || p.finished) return;
    const n = room.words.length;
    p.w = Math.floor(clampNum(m.w, 0, n - 1));
    p.c = Math.floor(clampNum(m.c, 0, 40));
    const len = room.words[p.w].length;
    p.prog = (p.w + Math.min(p.c, len) / len) / n;
    p.wpm = Math.round(clampNum(m.wpm, 0, 400));
    p.acc = Math.round(clampNum(m.acc, 0, 100));
    broadcast(room);
  },

  finish(ws, m) {
    const { room, player: p } = ws;
    if (!room || room.state !== 'racing' || !p.racing || p.finished) return;
    p.finished = true;
    p.place = ++room.places;
    p.w = room.words.length;
    p.c = 0;
    p.prog = 1;
    p.wpm = Math.round(clampNum(m.wpm, 0, 400));
    p.acc = Math.round(clampNum(m.acc, 0, 100));
    broadcast(room);
    checkEnd(room);
  },

  again(ws) {
    const { room, player } = ws;
    if (!room || room.hostId !== player.id || room.state !== 'finished') return;
    room.state = 'lobby';
    broadcast(room);
  },
};

function attach(server) {
  const wss = new WebSocketServer({ server, maxPayload: 4096 });
    wss.on('error', () => {}); // listen errors surface on the http server

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;
      if (m.t !== 'join' && !ws.player) return;
      const h = Object.prototype.hasOwnProperty.call(handlers, m.t) && handlers[m.t];
      if (h) h(ws, m);
    });

    ws.on('close', () => {
      const { room, player } = ws;
      if (!room || player.ws !== ws) return;
      player.ws = null;
      player.dropTimer = setTimeout(() => drop(room, player), GRACE_MS);
      broadcast(room);
    });

    ws.on('error', () => {});
  });
  return wss;
}

module.exports = { attach };
