import { describe, expect, it } from 'vitest';
import { seats } from './layout';
import {
  planDeal,
  planGather,
  planPile,
  planShuffle,
  planShuffleTogether,
  planSpread,
  SPREAD_STEP,
  touchingGroup,
} from './plans';
import { IdGenerator, emptyTable, reduce, type Action, type TableState } from './table';

/** A face-down deck of `n` cards c1 (bottom) .. cn (top) at x, z, plus an empty hand "me". */
function deck(n: number, x = 0, z = 0): TableState {
  const cardIds = Array.from({ length: n }, (_, i) => `c${i + 1}`);
  let state = reduce(emptyTable, {
    type: 'createStack',
    stack: { id: 'deck', x, z, turn: 0, cardIds },
    cards: cardIds.map((id) => ({ id, faceId: id, faceUp: false })),
  });
  state = reduce(state, { type: 'createHand', handId: 'me' });
  return state;
}

function run(state: TableState, actions: Action[] | Action | null): TableState {
  const list = actions === null ? [] : Array.isArray(actions) ? actions : [actions];
  return list.reduce(reduce, state);
}

describe('planShuffle', () => {
  it('reorders the deck with the given random source and skips single cards', () => {
    const state = deck(4);
    const action = planShuffle(state, 'deck', () => 0);
    expect(action?.type).toBe('shuffleStack');
    const after = run(state, action);
    expect([...(after.stacks.deck?.cardIds ?? [])].sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(after.stacks.deck?.cardIds).not.toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(planShuffle(deck(1), 'deck')).toBeNull();
  });
});

describe('planDeal', () => {
  it('deals round the table, seat 0 into the hand and the others into turned piles', () => {
    const state = deck(10);
    const after = run(state, planDeal(state, 'deck', seats(3), 2, 'me', new IdGenerator('t-')));
    expect(after.hands.me?.cardIds).toHaveLength(2);
    const piles = Object.values(after.stacks).filter((s) => s.id !== 'deck');
    expect(piles.map((p) => [p.cardIds.length, p.turn])).toEqual([
      [2, 1],
      [2, 3],
    ]);
    expect(after.stacks.deck?.cardIds).toHaveLength(4);
    // Seat 1 is dealt first, then seat 2, then the dealer's own hand.
    expect(after.hands.me?.cardIds).toEqual(['c8', 'c5']);
  });

  it('stops when the deck runs out, using the last card itself', () => {
    const state = deck(3);
    const after = run(state, planDeal(state, 'deck', seats(4), 5, 'me', new IdGenerator('t-')));
    expect(after.stacks.deck).toBeDefined(); // the deck's last card became seat 3's pile
    const cardsOnTable = Object.values(after.stacks).reduce((n, s) => n + s.cardIds.length, 0);
    expect(cardsOnTable + (after.hands.me?.cardIds.length ?? 0)).toBe(3);
    expect(Object.values(after.stacks).map((s) => s.cardIds.length)).toEqual([1, 1, 1]);
  });
});

describe('planSpread and planGather', () => {
  it('spreads into overlapping single cards that gather back into the same order', () => {
    const state = deck(6, -10, 0);
    const spread = run(state, planSpread(state, 'deck', new IdGenerator('t-')));
    const stacks = Object.values(spread.stacks);
    expect(stacks).toHaveLength(6);
    expect(stacks.map((s) => s.x)).toEqual([
      -10,
      -10 + SPREAD_STEP,
      -4,
      -10 + 3 * SPREAD_STEP,
      -10 + 4 * SPREAD_STEP,
      5,
    ]);
    expect(touchingGroup(spread, 'deck')).toHaveLength(6);

    // Gather from a card in the middle: the pile lands there, in the original order.
    const middle = stacks[3]?.id as string;
    const gathered = run(spread, planGather(spread, middle));
    const [only] = Object.values(gathered.stacks);
    expect(Object.keys(gathered.stacks)).toHaveLength(1);
    expect(only?.cardIds).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect([only?.x, only?.z]).toEqual([stacks[3]?.x, stacks[3]?.z]);
  });

  it('wraps long spreads into rows and starts from the left edge when there is no room', () => {
    const state = deck(40, 50, -20);
    const spread = run(state, planSpread(state, 'deck', new IdGenerator('t-')));
    const xs = Object.values(spread.stacks).map((s) => s.x);
    expect(Math.min(...xs)).toBeLessThan(-45);
    expect(new Set(Object.values(spread.stacks).map((s) => s.z)).size).toBeGreaterThan(1);
  });

  it('does nothing for a lone card', () => {
    expect(planGather(deck(1), 'deck')).toEqual([]);
    expect(planSpread(deck(1), 'deck', new IdGenerator())).toBeNull();
  });
});

describe('planPile and planShuffleTogether', () => {
  /** Three single cards a, b, c put down in that order, far apart. */
  function loose(): TableState {
    let state = emptyTable;
    ['a', 'b', 'c'].forEach((id, i) => {
      state = reduce(state, {
        type: 'createStack',
        stack: { id: `s-${id}`, x: i * 20, z: 0, turn: 0, cardIds: [id] },
        cards: [{ id, faceId: id, faceUp: true }],
      });
    });
    return state;
  }

  it('piles the chosen stacks onto the one lying lowest, later ones on top', () => {
    const state = loose();
    const after = run(state, planPile(state, ['s-c', 's-a']));
    expect(after.stacks['s-a']?.cardIds).toEqual(['a', 'c']);
    expect(after.stacks['s-c']).toBeUndefined();
    expect(after.stacks['s-b']).toBeDefined();
    expect(planPile(state, ['s-a'])).toBeNull();
  });

  it('shuffles several stacks into one pile', () => {
    const state = loose();
    const after = run(
      state,
      planShuffleTogether(state, ['s-a', 's-b', 's-c'], () => 0),
    );
    expect(Object.keys(after.stacks)).toEqual(['s-a']);
    expect([...(after.stacks['s-a']?.cardIds ?? [])].sort()).toEqual(['a', 'b', 'c']);
    expect(after.stacks['s-a']?.cardIds).not.toEqual(['a', 'b', 'c']);
  });
});
