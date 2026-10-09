import{
  SAFE_CELLS,
  type GameState, type Player, type PlayerColor, type Token,
  START_OFFSET,
} from './types.js';

export function createTokens(color: PlayerColor): Token[] {
  return [0, 1, 2, 3].map(i => ({
    id: `${color}-${i}`,
    color,
    steps: -1,
  }));
}

export function createInitialState(roomId: string): GameState {
  return {
    roomId,
    players: [],
    turn: null,
    dice: null,
    status: 'waiting',
    winner: null,
    consecutiveSixes: 0,
    rollId: 0,   // ← ADDED
  };
}

export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function getLegalMoves(player: Player, dice: number): Token[] {
  return player.tokens.filter(t => {
    if (t.steps === 56) return false;
    if (t.steps === -1) return dice === 6;
    if (t.steps + dice > 56) return false;
    return true;
  });
}

function absoluteCell(color: PlayerColor, steps: number): number | null {
  if (steps < 0 || steps > 50) return null;
  return (START_OFFSET[color] + steps) % 52;
}

export function hasOwnTokenOnCell(state: GameState, player: Player, targetSteps: number): boolean {
  const abs = absoluteCell(player.color, targetSteps);
  if (abs === null) return false; // home column / yard — no conflict rule there
  return player.tokens.some(t => {
    if (t.id === player.tokens.find(x => x.steps === targetSteps)?.id) return false;
    return absoluteCell(t.color, t.steps) === abs;
  });
}

export type Capture = { tokenId: string; cell: number };

export function resolveCapture(state: GameState, moved: Token): Capture | null {
  const abs = absoluteCell(moved.color, moved.steps);
  if (abs === null) return null;
  if (SAFE_CELLS.has(abs)) return null;

  for (const p of state.players) {
    if (p.color === moved.color) continue;
    for (const t of p.tokens) {
      if (absoluteCell(t.color, t.steps) === abs) {
        t.steps = -1;
        return { tokenId: t.id, cell: abs };
      }
    }
  }
  return null;
}

export function applyMove(
  state: GameState,
  tokenId: string
): { state: GameState; from: number; to: number; capture: Capture | null } {
  if (state.dice === null) throw new Error('No dice rolled');
  const player = state.players.find(p => p.color === state.turn);
  if (!player) throw new Error('No current player');

  const token = player.tokens.find(t => t.id === tokenId);
  if (!token) throw new Error('Token not found');

  const legal = getLegalMoves(player, state.dice);
  if (!legal.some(t => t.id === tokenId)) throw new Error('Illegal move');

  const from = token.steps;
  const to = from === -1 ? 0 : from + state.dice;

  // Prevent landing on own token on the main track
  if (to <= 50) {
    const conflict = player.tokens.some(t => t.id !== token.id && absoluteCell(t.color, t.steps) === absoluteCell(token.color, to));
    if (conflict) throw new Error('Own token on target cell');
  }

  token.steps = to;
  const capture = resolveCapture(state, token);

  return { state, from, to, capture };
}

export function checkWin(state: GameState): PlayerColor | null {
  for (const p of state.players) {
    if (p.tokens.every(t => t.steps === 56)) return p.color;
  }
  return null;
}