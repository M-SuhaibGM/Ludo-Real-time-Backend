import { Server } from 'socket.io';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { createInitialState, createTokens, applyMove } from './gameEngine.js';
import { handleRoll, handleMove, rollDiceValue } from './turnMachine.js';
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
const emptySince = new Map<string, number>(); // roomId -> when everyone went offline

const COLORS: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];
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
    for (const [token, s] of sessions) if (s.roomId === roomId) sessions.delete(token);
  }
}, 60_000);

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

  socket.on('room:create', ({ name }, cb) => {
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
    sessions.set(sessionToken, { roomId, playerId: player.id });
    bind(roomId, player.id);

    cb({ roomId, sessionToken, playerId: player.id, state });
    io.to(roomId).emit('game:state', state);
  });

  socket.on('room:join', ({ roomId, name }, cb) => {
    const state = rooms.get(roomId);
    if (!state) return cb({ error: 'Room not found' });
    if (state.players.length >= 4) return cb({ error: 'Room full' });
    if (state.status !== 'waiting') return cb({ error: 'Game already started' });

    const usedColors = state.players.map(p => p.color);
    const color = COLORS.find(c => !usedColors.includes(c))!;
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

    cb({ roomId, sessionToken, playerId: player.id, state });
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
      const value = rollDiceValue(state);
      io.to(roomId).emit('game:diceRolled', {
        value,
        rollId: state.rollId,
        color: state.turn,
      });

      handleRoll(state, value);

      setTimeout(() => {
        io.to(roomId).emit('game:state', state);
      }, 1000);
    } catch (e: any) {
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('game:move', ({ roomId, tokenId }) => {
    const state = rooms.get(roomId);
    if (!state || state.status !== 'playing' || !isMyTurn(state)) return;
    try {
      const movingColor = state.turn;
      const result = applyMove(state, tokenId);

      const currentPlayer = state.players.find(p => p.color === movingColor);
      if (currentPlayer) {
        currentPlayer.hitScore += result.capture.length;
      }

      handleMove(state, tokenId);

      io.to(roomId).emit('game:tokenMoved', {
        tokenId,
        color: movingColor,
        from: result.from,
        to: result.to,
        capture: result.capture,
      });

      io.to(roomId).emit('game:state', state);
    } catch (e: any) {
      socket.emit('error', { message: e.message });
    }
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

    if (state.players.every(p => !p.isConnected)) emptySince.set(roomId, Date.now());
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket server on :${PORT}`);
});