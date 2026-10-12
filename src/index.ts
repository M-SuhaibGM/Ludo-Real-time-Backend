import { Server } from 'socket.io';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { createInitialState, createTokens, applyMove } from './gameEngine.js';
import { handleRoll, handleMove, rollDiceValue } from './turnMachine.js';
import { chooseBotMove, type BotLevel } from './bot.js';
import type { GameState, PlayerColor } from './types.js';

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ludo socket server is running\n');
});

const io = new Server(httpServer, {
  cors: { origin: FRONTEND_URL, credentials: true },
});

type ChatMessage = {
  id: string;
  playerId: string;
  name: string;
  color: PlayerColor;
  text: string;
  ts: number;
};

// Everything lives in memory (no database). It is gone when the server restarts.
const rooms = new Map<string, GameState>();
const sessions = new Map<string, { roomId: string; playerId: string }>(); // secret token -> player
const chats = new Map<string, ChatMessage[]>(); // roomId -> messages
const playerSocket = new Map<string, string>(); // playerId -> newest socket id
const emptySince = new Map<string, number>(); // roomId -> when every human went offline
const botTimers = new Map<string, ReturnType<typeof setTimeout>>(); // roomId -> pending bot action
const botLevels = new Map<string, BotLevel>(); // roomId -> difficulty
const roomMax = new Map<string, number>(); // roomId -> seats chosen by the host (2-4)

// Clockwise around the board, in the same order as the track offsets in types.ts
const COLORS: PlayerColor[] = ['red', 'green', 'blue', 'yellow'];
const CHAT_LIMIT = 100;
const ROOM_TTL_MS = 30 * 60 * 1000;

// Delete rooms where every player has been offline for 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [roomId, since] of emptySince) {
    if (now - since < ROOM_TTL_MS) continue;
    rooms.delete(roomId);
    chats.delete(roomId);
    emptySince.delete(roomId);
    clearTimeout(botTimers.get(roomId));
    botTimers.delete(roomId);
    botLevels.delete(roomId);
    roomMax.delete(roomId);
    for (const [token, s] of sessions) if (s.roomId === roomId) sessions.delete(token);
  }
}, 60_000);

// ───────── Game actions shared by humans and bots ─────────
function doRoll(roomId: string, state: GameState) {
  if (state.dice !== null) return; // already rolled, must move
  const value = rollDiceValue(state);
  io.to(roomId).emit('game:diceRolled', { value, rollId: state.rollId, color: state.turn });
  handleRoll(state, value);
  setTimeout(() => {
    io.to(roomId).emit('game:state', state);
    scheduleBot(roomId); // the turn may now belong to a bot
  }, 1000);
}

function doMove(roomId: string, state: GameState, tokenId: string) {
  const movingColor = state.turn;
  const result = applyMove(state, tokenId);

  const currentPlayer = state.players.find(p => p.color === movingColor);
  if (currentPlayer) currentPlayer.hitScore += result.capture.length;

  handleMove(state, tokenId);

  io.to(roomId).emit('game:tokenMoved', {
    tokenId,
    color: movingColor,
    from: result.from,
    to: result.to,
    capture: result.capture,
  });
  io.to(roomId).emit('game:state', state);
  scheduleBot(roomId);
}

/** If it is a bot's turn, roll or move for it after a short human-like pause. */
function scheduleBot(roomId: string) {
  const state = rooms.get(roomId);
  if (!state || state.status !== 'playing' || botTimers.has(roomId)) return;
  if (!state.players.find(p => p.color === state.turn)?.isBot) return;

  const delay = state.dice === null ? 900 : 1100;
  botTimers.set(
    roomId,
    setTimeout(() => {
      botTimers.delete(roomId);
      const s = rooms.get(roomId);
      const bot = s?.players.find(p => p.color === s.turn);
      if (!s || s.status !== 'playing' || !bot?.isBot) return;
      try {
        if (s.dice === null) doRoll(roomId, s);
        else doMove(roomId, s, chooseBotMove(s, bot, botLevels.get(roomId) ?? 'medium'));
      } catch (e) {
        console.error('bot error', e);
      }
    }, delay)
  );
}

io.on('connection', socket => {
  console.log('connected', socket.id);

  /** Ties this socket to a player so we know who is chatting / playing / online. */
  const bind = (roomId: string, playerId: string) => {
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;
    playerSocket.set(playerId, socket.id);
    socket.join(roomId);
    emptySince.delete(roomId);
  };

  const isMyTurn = (state: GameState) => {
    const player = state.players.find(p => p.id === socket.data.playerId);
    return Boolean(player && player.color === state.turn);
  };

  // Called on page load and after every reconnect.
  // The secret sessionToken proves who you are (playerId is visible to everyone in state).
  socket.on('room:sync', ({ roomId, sessionToken }, cb) => {
    const state = rooms.get(roomId);
    if (!state) return cb?.({ error: 'Room not found' });

    socket.join(roomId);

    const session = sessionToken ? sessions.get(sessionToken) : undefined;
    const player =
      session && session.roomId === roomId
        ? state.players.find(p => p.id === session.playerId)
        : undefined;

    if (player) {
      bind(roomId, player.id);
      player.isConnected = true;
      io.to(roomId).emit('game:state', state);
    }

    socket.emit('chat:history', chats.get(roomId) ?? []);
    cb?.({ state });
  });

  socket.on('chat:send', ({ roomId, text }) => {
    if (typeof text !== 'string' || roomId !== socket.data.roomId) return;
    const state = rooms.get(roomId);
    const player = state?.players.find(p => p.id === socket.data.playerId);
    if (!state || !player) return;

    // Rate limit: at most 5 messages per 5 seconds per socket
    const now = Date.now();
    const sent: number[] = (socket.data.sent ?? []).filter((t: number) => now - t < 5000);
    if (sent.length >= 5) return;
    sent.push(now);
    socket.data.sent = sent;

    const clean = text.trim().slice(0, 200);
    if (!clean) return;

    const msg: ChatMessage = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      playerId: player.id,
      name: player.name,
      color: player.color,
      text: clean,
      ts: now,
    };
    const list = chats.get(roomId) ?? [];
    list.push(msg);
    if (list.length > CHAT_LIMIT) list.shift();
    chats.set(roomId, list);

    io.to(roomId).emit('chat:message', msg);
  });

  socket.on('room:create', ({ name, maxPlayers }, cb) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const state = createInitialState(roomId);
    const sessionToken = randomUUID();
    const initialColor = COLORS[0]!;

    const player = {
      id: randomUUID(),
      name: String(name ?? '').trim().slice(0, 20) || 'Player',
      color: initialColor,
      isConnected: true,
      tokens: createTokens(initialColor),
      hitScore: 0,
    };
    state.players.push(player);
    state.turn = initialColor;

    rooms.set(roomId, state);
    chats.set(roomId, []);
    roomMax.set(roomId, Math.min(4, Math.max(2, Number(maxPlayers) || 4)));
    sessions.set(sessionToken, { roomId, playerId: player.id });
    bind(roomId, player.id);

    cb({ roomId, sessionToken, playerId: player.id, state });
    io.to(roomId).emit('game:state', state);
  });

  socket.on('room:join', ({ roomId, name }, cb) => {
    const state = rooms.get(roomId);
    if (!state) return cb({ error: 'Room not found' });
    const max = roomMax.get(roomId) ?? 4;
    if (state.players.length >= max) return cb({ error: 'Room full' });
    if (state.status !== 'waiting') return cb({ error: 'Game already started' });

    const usedColors = state.players.map(p => p.color);
    // 2-player rooms seat the players in opposite corners
    const seatOrder: PlayerColor[] = max === 2 ? ['red', 'blue'] : COLORS;
    const color = seatOrder.find(c => !usedColors.includes(c))!;
    const sessionToken = randomUUID();

    const player = {
      id: randomUUID(),
      name: String(name ?? '').trim().slice(0, 20) || 'Player',
      color,
      isConnected: true,
      tokens: createTokens(color),
      hitScore: 0,
    };
    state.players.push(player);
    sessions.set(sessionToken, { roomId, playerId: player.id });
    bind(roomId, player.id);

    // The game starts by itself once every seat chosen by the host is taken
    if (state.players.length === max) {
      state.status = 'playing';
      state.turn = state.players[0]?.color ?? null;
    }

    cb({ roomId, sessionToken, playerId: player.id, state });
    io.to(roomId).emit('game:state', state);
  });

  // Single player vs computer: 1-3 bots, game starts immediately
  socket.on('room:createSolo', ({ name, bots, level }, cb) => {
    const botCount = Math.min(3, Math.max(1, Number(bots) || 1));
    const difficulty: BotLevel = ['easy', 'medium', 'hard'].includes(level) ? level : 'medium';
    const botColors: PlayerColor[] =
      botCount === 1 ? ['blue'] : botCount === 2 ? ['green', 'blue'] : ['green', 'blue', 'yellow'];

    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const state = createInitialState(roomId);
    const sessionToken = randomUUID();

    const human = {
      id: randomUUID(),
      name: String(name ?? '').trim().slice(0, 20) || 'Player',
      color: 'red' as PlayerColor,
      isConnected: true,
      tokens: createTokens('red'),
      hitScore: 0,
    };
    state.players.push(human);
    botColors.forEach((color, i) =>
      state.players.push({
        id: randomUUID(),
        name: `Computer ${i + 1}`,
        color,
        isConnected: true,
        isBot: true,
        tokens: createTokens(color),
        hitScore: 0,
      })
    );
    state.status = 'playing';
    state.turn = 'red';

    rooms.set(roomId, state);
    chats.set(roomId, []);
    botLevels.set(roomId, difficulty);
    sessions.set(sessionToken, { roomId, playerId: human.id });
    bind(roomId, human.id);

    cb({ roomId, sessionToken, playerId: human.id, state });
    io.to(roomId).emit('game:state', state);
  });

  socket.on('game:start', ({ roomId }) => {
    const state = rooms.get(roomId);
    if (!state || state.players.length < 2) return;
    state.status = 'playing';
    state.turn = state.players[0]?.color ?? null;
    io.to(roomId).emit('game:state', state);
  });

  socket.on('game:roll', ({ roomId }) => {
    const state = rooms.get(roomId);
    if (!state || state.status !== 'playing' || !isMyTurn(state)) return;
    try {
      doRoll(roomId, state);
    } catch (e: any) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('game:move', ({ roomId, tokenId }) => {
    const state = rooms.get(roomId);
    if (!state || state.status !== 'playing' || !isMyTurn(state)) return;
    try {
      doMove(roomId, state, tokenId);
    } catch (e: any) {
      socket.emit('error', { message: e.message });
    }
  });

  // Same players, fresh board. Any player can start it once the game is finished.
  socket.on('game:rematch', ({ roomId }) => {
    const state = rooms.get(roomId);
    if (!state || state.status !== 'finished' || roomId !== socket.data.roomId) return;

    clearTimeout(botTimers.get(roomId));
    botTimers.delete(roomId);

    state.players.forEach(p => {
      p.tokens = createTokens(p.color);
      p.hitScore = 0;
    });
    state.winners = [];
    state.dice = null;
    state.consecutiveSixes = 0;
    state.status = 'playing';
    state.turn = state.players[0]?.color ?? null; // the host / human goes first

    io.to(roomId).emit('game:state', state);
    scheduleBot(roomId);
  });

  // Player pressed "Home": show them as offline to the others and leave the room channel
  socket.on('room:leave', ({ roomId }) => {
    const { roomId: boundRoom, playerId } = socket.data as { roomId?: string; playerId?: string };
    if (!playerId || boundRoom !== roomId) return;

    socket.leave(roomId);
    if (playerSocket.get(playerId) === socket.id) playerSocket.delete(playerId);
    socket.data.roomId = undefined;
    socket.data.playerId = undefined;

    const state = rooms.get(roomId);
    const player = state?.players.find(p => p.id === playerId);
    if (!state || !player) return;
    player.isConnected = false;
    io.to(roomId).emit('game:state', state);
    if (state.players.filter(p => !p.isBot).every(p => !p.isConnected)) emptySince.set(roomId, Date.now());
  });

  socket.on('disconnect', () => {
    const { roomId, playerId } = socket.data as { roomId?: string; playerId?: string };
    if (!roomId || !playerId) return;

    // A newer socket (reconnect / refresh) already took over: this one is stale, ignore it
    if (playerSocket.get(playerId) !== socket.id) return;
    playerSocket.delete(playerId);

    const state = rooms.get(roomId);
    const player = state?.players.find(p => p.id === playerId);
    if (!state || !player) return;

    player.isConnected = false;
    io.to(roomId).emit('game:state', state);

    if (state.players.filter(p => !p.isBot).every(p => !p.isConnected)) emptySince.set(roomId, Date.now());
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket server on :${PORT}`);
});