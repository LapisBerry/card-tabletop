/**
 * Turns table commands like "deal" or "spread" into plain actions.
 *
 * Each plan reads the current state and returns the actions to dispatch, with
 * every random choice and new id already made. Sending those actions to other
 * players later gives them the exact same result.
 */
import { CARD_HEIGHT, CARD_WIDTH, TABLE_DEPTH, TABLE_WIDTH } from './dimensions';
import type { Seat } from './layout';
import { shuffled, type Random } from './random';
import { reduce, type Action, type IdGenerator, type StackState, type TableState } from './table';

export function planShuffle(state: TableState, stackId: string, random: Random = Math.random): Action | null {
  const stack = state.stacks[stackId];
  if (!stack || stack.cardIds.length < 2) return null;
  return { type: 'shuffleStack', stackId, order: shuffled(stack.cardIds, random) };
}

/**
 * Piles several stacks into one where the lowest of them lies. Stacks put down
 * later go on top and each keeps its own order, as when sweeping cards together.
 */
export function planPile(state: TableState, stackIds: readonly string[]): Action | null {
  const wanted = new Set(stackIds);
  // Object order is the placement order, so the first match is the one lying lowest.
  const [bottom, ...rest] = Object.values(state.stacks).filter((stack) => wanted.has(stack.id));
  if (!bottom || rest.length === 0) return null;
  return { type: 'gatherStacks', targetId: bottom.id, sourceIds: rest.map((stack) => stack.id) };
}

/** Piles several stacks into one and shuffles it, as when shuffling the discard pile back into the deck. */
export function planShuffleTogether(
  state: TableState,
  stackIds: readonly string[],
  random: Random = Math.random,
): Action[] {
  const pile = planPile(state, stackIds);
  if (!pile || pile.type !== 'gatherStacks') {
    const shuffle = stackIds[0] ? planShuffle(state, stackIds[0], random) : null;
    return shuffle ? [shuffle] : [];
  }
  const shuffle = planShuffle(reduce(state, pile), pile.targetId, random);
  return shuffle ? [pile, shuffle] : [pile];
}

/**
 * Deals `perSeat` cards to each seat, one at a time and round the table,
 * starting with the seat after the first and ending with the first, the way a
 * dealer at seat 0 would. Seat 0's cards go into `handId`; every other seat
 * gets a pile at its place. Stops early if the deck runs out.
 */
export function planDeal(
  state: TableState,
  stackId: string,
  seatList: readonly Seat[],
  perSeat: number,
  handId: string,
  ids: IdGenerator,
): Action[] {
  const deck = state.stacks[stackId];
  if (!deck || seatList.length === 0) return [];
  let left = deck.cardIds.length;
  const piles = new Map<number, string>();
  const actions: Action[] = [];
  const order = [...seatList.slice(1), ...seatList.slice(0, 1)];
  for (let round = 0; round < perSeat; round++) {
    for (const seat of order) {
      if (left === 0) return actions;
      if (seat.index === 0) {
        actions.push({ type: 'drawToHand', stackId, handId, count: 1 });
      } else {
        const pileId = piles.get(seat.index);
        if (pileId) {
          actions.push({ type: 'transferTop', fromStackId: stackId, toStackId: pileId, count: 1 });
        } else if (left === 1) {
          // The very last card: move the deck itself rather than splitting off nothing.
          actions.push({ type: 'moveStack', stackId, x: seat.x, z: seat.z });
          actions.push({ type: 'turnStack', stackId, by: seat.turn - deck.turn });
        } else {
          const newStackId = ids.make('stack');
          piles.set(seat.index, newStackId);
          actions.push({ type: 'splitStack', stackId, count: 1, newStackId, x: seat.x, z: seat.z, turn: seat.turn });
        }
      }
      left--;
    }
  }
  return actions;
}

/** Gap between spread cards, so each card's left strip (rank, suit and the start of its name) shows. */
export const SPREAD_STEP = 3;
const SPREAD_ROW_GAP = CARD_HEIGHT + 1.5;

/**
 * Lays a stack out in overlapping rows, bottom card first, starting where the
 * stack is and going right. Rows wrap before the table edge; if there is no
 * room for a few cards to the right, the rows start from the left edge instead.
 */
export function planSpread(state: TableState, stackId: string, ids: IdGenerator): Action | null {
  const stack = state.stacks[stackId];
  if (!stack || stack.cardIds.length < 2) return null;
  const minX = -TABLE_WIDTH / 2 + CARD_WIDTH / 2 + 1;
  const maxX = TABLE_WIDTH / 2 - CARD_WIDTH / 2 - 1;
  const startX = maxX - stack.x >= SPREAD_STEP * 5 ? stack.x : minX;
  const perRow = Math.max(1, Math.floor((maxX - startX) / SPREAD_STEP) + 1);
  const maxZ = TABLE_DEPTH / 2 - CARD_HEIGHT / 2 - 1;
  const positions = stack.cardIds.map((_, i) => ({
    x: round(startX + (i % perRow) * SPREAD_STEP),
    z: round(Math.min(maxZ, stack.z + Math.floor(i / perRow) * SPREAD_ROW_GAP)),
  }));
  return {
    type: 'spreadStack',
    stackId,
    newStackIds: stack.cardIds.slice(1).map(() => ids.make('stack')),
    positions,
  };
}

/**
 * Gathers the stacks that touch this one, and the ones touching those, into a
 * single pile where this one is. Cards are piled in reading order (row by row,
 * left to right), with the first card at the bottom, so gathering a spread
 * gives back the order it was spread in.
 */
export function planGather(state: TableState, stackId: string): Action[] {
  const clicked = state.stacks[stackId];
  const group = touchingGroup(state, stackId);
  if (!clicked || group.length < 2) return [];
  const row = (s: StackState) => Math.round(s.z / (CARD_HEIGHT / 2));
  const ordered = [...group].sort((a, b) => row(a) - row(b) || a.x - b.x);
  const [bottom, ...rest] = ordered as [StackState, ...StackState[]];
  const actions: Action[] = [{ type: 'gatherStacks', targetId: bottom.id, sourceIds: rest.map((s) => s.id) }];
  if (bottom.id !== stackId) actions.push({ type: 'moveStack', stackId: bottom.id, x: clicked.x, z: clicked.z });
  return actions;
}

/** Stacks whose footprints overlap, reached step by step from `stackId`. */
export function touchingGroup(state: TableState, stackId: string): StackState[] {
  const start = state.stacks[stackId];
  if (!start) return [];
  const all = Object.values(state.stacks);
  const found = new Map<string, StackState>([[start.id, start]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift() as StackState;
    for (const other of all) {
      if (!found.has(other.id) && footprintsOverlap(current, other)) {
        found.set(other.id, other);
        queue.push(other);
      }
    }
  }
  return [...found.values()];
}

/** Half the width and depth a stack covers on the table, given its quarter turns. */
export function halfSize(turn: number): [number, number] {
  return turn % 2 === 0 ? [CARD_WIDTH / 2, CARD_HEIGHT / 2] : [CARD_HEIGHT / 2, CARD_WIDTH / 2];
}

/** True when two stacks' outlines overlap, ignoring a sliver at the edges. */
export function footprintsOverlap(a: StackState, b: StackState, margin = 0.05): boolean {
  const [aw, ah] = halfSize(a.turn);
  const [bw, bh] = halfSize(b.turn);
  return Math.abs(a.x - b.x) < aw + bw - margin && Math.abs(a.z - b.z) < ah + bh - margin;
}

function round(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}
