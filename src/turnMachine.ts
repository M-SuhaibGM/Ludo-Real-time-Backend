import type { GameState, PlayerColor } from './types.js';
import { rollDice, getLegalMoves, checkWin } from './gameEngine.js';

const ORDER: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

export function nextTurn(state: GameState): GameState {
  const idx = ORDER.indexOf(state.turn!);
  for (let i = 1; i <= 4; i++) {
    const next = ORDER[(idx + i) % ORDER.length] as PlayerColor;
    if (state.players.some(p => p.color === next)) {
      state.turn = next;
      return state;
    }
  }
  return state;
}

// Rolls the dice and stores it, bumps rollId. Does NOT apply turn logic.
export function rollDiceValue(state: GameState): number {
  if (state.status !== 'playing') throw new Error('Game not playing');
  const value = rollDice();
  state.dice = value;
  state.rollId += 1;
  return value;
}

// Applies turn logic given the pre-rolled value. Do NOT roll here.
export function handleRoll(state: GameState, value: number): GameState {
  if (value === 6) {
    state.consecutiveSixes += 1;
    if (state.consecutiveSixes === 3) {
      state.consecutiveSixes = 0;
      state.dice = null;
      nextTurn(state);
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
    nextTurn(state);
  }

  return state;
}

export function handleMove(state: GameState, tokenId: string): GameState {
  const value = state.dice!;
  state.dice = null;

  const winner = checkWin(state);
  if (winner) {
    state.status = 'finished';
    state.winner = winner;
    return state;
  }

  if (value === 6) return state; // same player rolls again
  nextTurn(state);
  return state;
}