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

const rooms = new Map<string, GameState>();
const sessionToRoom = new Map<string, string>();

const COLORS: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

io.on('connection', socket => {
  console.log('connected', socket.id);

  socket.on('room:sync', ({ roomId }, cb) => {
    const state = rooms.get(roomId);
    if (!state) return cb({ error: 'Room not found' });
    socket.join(roomId);
    cb({ state });
  });

  socket.on('room:create', ({ name }, cb) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const state = createInitialState(roomId);
    const sessionToken = randomUUID();
    const initialColor = COLORS[0]!;

    const player = {
      id: randomUUID(),
      name,
      color: initialColor,
      isConnected: true,
      tokens: createTokens(initialColor),
      hitScore: 0,
    };
    state.players.push(player);
    state.turn = initialColor;

    rooms.set(roomId, state);
    sessionToRoom.set(sessionToken, roomId);

    socket.join(roomId);
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
    const newSession = randomUUID();

    const player = {
      id: randomUUID(),
      name,
      color,
      isConnected: true,
      tokens: createTokens(color),
      hitScore: 0,
    };
    state.players.push(player);
    sessionToRoom.set(newSession, roomId);

    socket.join(roomId);
    cb({ roomId, sessionToken: newSession, playerId: player.id, state });
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
    if (!state || state.status !== 'playing') return;
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
    if (!state || state.status !== 'playing') return;
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
    // TODO reconnection
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket server on :${PORT}`);
});