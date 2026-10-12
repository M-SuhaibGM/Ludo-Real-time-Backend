import { getLegalMoves } from './gameEngine.js';
import { SAFE_CELLS, START_CELL_INDICES, START_OFFSET } from './types.js';
import type { GameState, Player, PlayerColor } from './types.js';

export type BotLevel = 'easy' | 'medium' | 'hard';

// Same mapping the engine uses: shared-loop cell 0..51, or null for yard / home column
const absCell = (color: PlayerColor, steps: number): number | null =>
  steps < 0 || steps > 50 ? null : (START_OFFSET[color] + steps) % 52;

const isSafe = (cell: number) => SAFE_CELLS.has(cell) || START_CELL_INDICES.has(cell);

/**
 * Picks the token id the bot should move. Only ever returns a legal move.
 *  easy   - random legal move
 *  medium - captures > finishing > leaving the yard > entering home column > advancing
 *  hard   - medium + avoids cells an opponent can hit next turn, likes safe cells,
 *           and rescues tokens that are currently in danger
 */
export function chooseBotMove(state: GameState, player: Player, level: BotLevel): string {
  const dice = state.dice!;
  const legal = getLegalMoves(player, dice);
  if (legal.length === 0) throw new Error('Bot has no legal move');
  if (legal.length === 1 || level === 'easy') {
    return legal[Math.floor(Math.random() * legal.length)]!.id;
  }

  // Every opponent token that is on the shared loop
  const opp: { cell: number; steps: number }[] = [];
  for (const p of state.players) {
    if (p.color === player.color) continue;
    for (const t of p.tokens) {
      const cell = absCell(t.color, t.steps);
      if (cell !== null) opp.push({ cell, steps: t.steps });
    }
  }

  // How many opponent tokens are 1..6 cells behind this cell (could hit it with one roll)
  const dangerAt = (cell: number) =>
    opp.filter(o => {
      const d = (cell - o.cell + 52) % 52;
      return d >= 1 && d <= 6;
    }).length;

  let best = legal[0]!;
  let bestScore = -Infinity;

  for (const t of legal) {
    const to = t.steps === -1 ? 0 : t.steps + dice;
    const toCell = absCell(player.color, to);
    let score = to * 0.5 + Math.random(); // prefer advanced tokens, random tie-break

    if (t.steps === -1) score += 40; // bring a token out
    if (to === 56) score += 80; // reach the centre
    else if (to >= 51) score += 25; // safe in the home column

    // Capture: engine captures every opponent token on a non-safe landing cell
    if (toCell !== null && !isSafe(toCell)) {
      const victims = opp.filter(o => o.cell === toCell);
      if (victims.length) {
        score += 100 * victims.length + victims.reduce((s, v) => s + v.steps, 0);
        if (player.hitScore < 1) score += 50; // first hit unlocks the home column
      }
    }

    if (level === 'hard') {
      if (toCell !== null) {
        if (isSafe(toCell)) score += 20;
        else score -= 30 * dangerAt(toCell);
      }
      const fromCell = absCell(player.color, t.steps);
      if (fromCell !== null && !isSafe(fromCell)) {
        score += 25 * Math.min(dangerAt(fromCell), 2); // run away from threats
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best.id;
}