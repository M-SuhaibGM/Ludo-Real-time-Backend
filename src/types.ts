export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export type Token = {
  id: string;
  color: PlayerColor;
  steps: number; // -1 yard, 0..50 track, 51..55 home column, 56 finished
};

export type Player = {
  id: string;
  name: string;
  color: PlayerColor;
  isConnected: boolean;
  tokens: Token[];
  hitScore: number;   // ← NEW: accumulates captures, never decreases
};

export type GameState = {
  roomId: string;
  players: Player[];
  turn: PlayerColor | null;
  dice: number | null;
  status: 'waiting' | 'playing' | 'finished';
  winners: PlayerColor[];
  consecutiveSixes: number;
  rollId: number;
};

export const START_OFFSET: Record<PlayerColor, number> = {
  red: 0, green: 13, yellow: 26, blue: 39,
};

// Safe cells (star cells on your board, NOT including start cells)
export const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Start cells = the colored entry cells. Track indices.
export const START_CELL_INDICES = new Set([0, 13, 26, 39]);