export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export type Token = {
  id: string;
  color: PlayerColor;
  steps: number;
};

export type Player = {
  id: string;
  name: string;
  color: PlayerColor;
  isConnected: boolean;
  tokens: Token[];
};

export type GameState = {
  roomId: string;
  players: Player[];
  turn: PlayerColor | null;
  dice: number | null;
  status: 'waiting' | 'playing' | 'finished';
  winner: PlayerColor | null;
  consecutiveSixes: number;
  rollId: number;   // ← ADDED
};

export const START_OFFSET: Record<PlayerColor, number> = {
  red: 0, green: 13, yellow: 26, blue: 39,
};

export const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);