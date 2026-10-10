import type { GameState, PlayerColor } from './types.js';
import { rollDice, getLegalMoves } from './gameEngine.js';

const ORDER: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

// Move to the next player who hasn't already won
export function advanceToNextActivePlayer(state: GameState): void {
  if (!state.turn) return;
  const startIdx = ORDER.indexOf(state.turn);
  for (let i = 1; i <= 4; i++) {
    const next = ORDER[(startIdx + i) % 4];
    const player = state.players.find(p => p.color === next);
    if (player && !state.winners.includes(next as any)) {
      state.turn = next as any;
      return;
    }
  }
  // No active players left
  state.turn = null;
}

export function rollDiceValue(state: GameState): number {
  if (state.status !== 'playing') throw new Error('Game not playing');
  const value = rollDice();
  state.dice = value;
  state.rollId += 1;
  return value;
}

export function handleRoll(state: GameState, value: number): GameState {
  if (value === 6) {
    state.consecutiveSixes += 1;
    if (state.consecutiveSixes === 3) {
      state.consecutiveSixes = 0;
      state.dice = null;
      advanceToNextActivePlayer(state);
      return state;
    }
  } else {
    state.consecutiveSixes = 0;
  }

  const player = state.players.find(p => p.color === state.turn);
  if (!player) return state;

  const legal = getLegalMoves(player, value);

  if (legal.length === 0) {
    if (value === 6) return state; // reroll allowed
    state.dice = null;
    advanceToNextActivePlayer(state);
  }
  return state;
}

export function handleMove(state: GameState, tokenId: string): GameState {
  const value = state.dice!;
  state.dice = null;

  const currentColor = state.turn!;
  const currentPlayer = state.players.find(p => p.color === currentColor);

  // Did the current player just finish all 4 tokens?
  if (currentPlayer && currentPlayer.tokens.every(t => t.steps === 56)) {
    if (!state.winners.includes(currentColor)) {
      state.winners.push(currentColor);
    }
  }

  // How many players are still playing?
  const stillPlaying = state.players.filter(
    p => !state.winners.includes(p.color)
  );

  // Game ends when only 1 player remains
  if (stillPlaying.length <= 1) {
    state.status = 'finished';
    state.turn = null;
    return state;
  }

  // If current player is a winner, they don't get another turn even on a 6
  if (state.winners.includes(currentColor)) {
    advanceToNextActivePlayer(state);
    return state;
  }

  if (value === 6) return state; // same player rolls again
  advanceToNextActivePlayer(state);
  return state;
}