import {
  SAFE_CELLS,
  START_CELL_INDICES,
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
    winners: [],          // ← was `winner: null`
    consecutiveSixes: 0,
    rollId: 0,
  };
}

export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

// ─────────────────────────────────────────────────────────────
// LEGAL MOVES
// Rules baked in:
//   - Yard token: only on a 6
//   - Finished token: never
//   - Cannot overshoot 56 (exact roll to finish)  [R9]
//   - Locked at step 50 if hitScore === 0 (can't enter home) [R4]
//   - Stacking allowed: own tokens can share any cell [R1]
// ─────────────────────────────────────────────────────────────
export function getLegalMoves(player: Player, dice: number): Token[] {
  return player.tokens.filter(t => {
    if (t.steps === 56) return false;

    // Yard → only leave on a 6
    if (t.steps === -1) return dice === 6;

    const next = t.steps + dice;

    // Exact roll to finish
    if (next > 56) return false;

    // Home column gate: if at 50 (last track cell) and moving past it,
    // require at least 1 hit on this player.
    if (t.steps === 50 && next > 50 && player.hitScore < 1) return false;

    // Defensive: a token already in the home column (51..55) is fine to move,
    // but only further into home column (already covered by next > 56 check).
    return true;
  });
}

// Convert a token's (color, steps) into the absolute 0..51 cell index on the shared loop.
// Returns null for yard and home column.
function absoluteCell(color: PlayerColor, steps: number): number | null {
  if (steps < 0 || steps > 50) return null;
  return (START_OFFSET[color] + steps) % 52;
}

export type Capture = { tokenId: string; cell: number };

// Capture ALL opponent tokens on the moved token's destination cell.
// Respects safe cells and start cells. Returns [] if nothing captured.
export function resolveCapture(state: GameState, moved: Token): Capture[] {
  const abs = absoluteCell(moved.color, moved.steps);
  if (abs === null) return [];                 // home column — no captures
  if (SAFE_CELLS.has(abs)) return [];          // star cells are safe
  if (START_CELL_INDICES.has(abs)) return [];  // start cells are safe

  const captured: Capture[] = [];
  for (const p of state.players) {
    if (p.color === moved.color) continue;
    for (const t of p.tokens) {
      if (absoluteCell(t.color, t.steps) === abs) {
        t.steps = -1;
        captured.push({ tokenId: t.id, cell: abs });
      }
    }
  }
  return captured;
}

export function applyMove(
  state: GameState,
  tokenId: string
): { state: GameState; from: number; to: number; capture: Capture[] } {
  if (state.dice === null) throw new Error('No dice rolled');
  const player = state.players.find(p => p.color === state.turn);
  if (!player) throw new Error('No current player');

  const token = player.tokens.find(t => t.id === tokenId);
  if (!token) throw new Error('Token not found');

  const legal = getLegalMoves(player, state.dice);
  if (!legal.some(t => t.id === tokenId)) throw new Error('Illegal move');

  const from = token.steps;
  const to = from === -1 ? 0 : from + state.dice;

  token.steps = to;
  const capture = resolveCapture(state, token);

  return { state, from, to, capture };
}

// export function checkWin(state: GameState): PlayerColor | null {
//   for (const p of state.players) {
//     if (p.tokens.every(t => t.steps === 56)) return p.color;
//   }
//   return null;
// }