import { describe, expect, it, vi } from 'vitest';
import sample from '../data/wild-west-sample.json';
import { parseCardSet } from './cardSet';
import { LOCAL_HAND_ID, seats } from './layout';
import { newGame } from './setup';
import { Table, TableActionError, buildTable, emptyTable, reduce, stackOfCard, type Action } from './table';

const oneCard = (stackId: string, cardId: string): Action => ({
  type: 'createStack',
  stack: { id: stackId, x: 1, z: 2, turn: 5, cardIds: [cardId] },
  cards: [{ id: cardId, faceId: 'shot#1', faceUp: true }],
});

describe('reduce', () => {
  it('creates a stack without changing the old state', () => {
    const next = reduce(emptyTable, oneCard('s1', 'c1'));
    expect(emptyTable.stacks).toEqual({});
    expect(next.stacks.s1).toEqual({ id: 's1', x: 1, z: 2, turn: 1, cardIds: ['c1'] });
    expect(next.cards.c1).toEqual({ id: 'c1', faceId: 'shot#1', faceUp: true });
  });

  it('refuses a card that is already on the table', () => {
    const state = reduce(emptyTable, oneCard('s1', 'c1'));
    expect(() => reduce(state, oneCard('s2', 'c1'))).toThrow(TableActionError);
  });

  it('refuses a stack whose card list does not match its cards', () => {
    const action: Action = {
      type: 'createStack',
      stack: { id: 's1', x: 0, z: 0, turn: 0, cardIds: ['c1', 'c2'] },
      cards: [{ id: 'c1', faceId: 'x', faceUp: false }],
    };
    expect(() => reduce(emptyTable, action)).toThrow(TableActionError);
  });
});

describe('Table', () => {
  it('tells listeners about each change until they unsubscribe', () => {
    const table = new Table();
    const listener = vi.fn();
    const stop = table.subscribe(listener);
    table.dispatch(oneCard('s1', 'c1'));
    stop();
    table.dispatch(oneCard('s2', 'c2'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(table.state.stacks)).toEqual(['s1', 's2']);
  });
});

describe('Table history', () => {
  it('undoes and redoes whole steps, each made of every action since its checkpoint', () => {
    const table = new Table();
    table.dispatch(oneCard('s1', 'c1')); // setup: not undoable
    table.checkpoint();
    table.dispatch({ type: 'moveStack', stackId: 's1', x: 5, z: 5 });
    table.dispatch({ type: 'turnStack', stackId: 's1', by: 1 });
    table.checkpoint();
    table.dispatch({ type: 'flipStack', stackId: 's1' });
    const flipped = table.state;

    expect(table.undo()).toBe(true);
    expect(table.state.cards.c1?.faceUp).toBe(true);
    expect(table.state.stacks.s1).toMatchObject({ x: 5, z: 5, turn: 2 });
    expect(table.undo()).toBe(true);
    expect(table.state.stacks.s1).toMatchObject({ x: 1, z: 2, turn: 1 });
    expect(table.undo()).toBe(false);
    expect(table.canUndo).toBe(false);

    table.redo();
    table.redo();
    expect(table.state).toBe(flipped);
    expect(table.canRedo).toBe(false);
  });

  it('does not record a checkpoint that nothing followed, and a new step clears redo', () => {
    const table = new Table();
    table.dispatch(oneCard('s1', 'c1'));
    table.checkpoint();
    table.dispatch({ type: 'turnStack', stackId: 's1', by: 1 });
    table.undo();
    table.checkpoint(); // a click that changed nothing
    expect(table.canRedo).toBe(true);
    table.dispatch({ type: 'turnStack', stackId: 's1', by: -1 });
    expect(table.canRedo).toBe(false);
  });

  it('cancels the step in progress without keeping it for redo', () => {
    const table = new Table();
    table.dispatch(oneCard('s1', 'c1'));
    const before = table.state;
    table.checkpoint();
    table.dispatch({ type: 'moveStack', stackId: 's1', x: 9, z: 9 });
    table.cancelStep();
    expect(table.state).toBe(before);
    expect(table.canUndo).toBe(false);
    expect(table.canRedo).toBe(false);
  });

  it('keeps the history when an action fails', () => {
    const table = new Table();
    table.dispatch(oneCard('s1', 'c1'));
    table.checkpoint();
    expect(() => table.dispatch({ type: 'flipStack', stackId: 'nope' })).toThrow(TableActionError);
    expect(table.canUndo).toBe(false);
  });

  it('replaces the whole table as one undoable step, and loads without history', () => {
    const table = new Table();
    const changes: string[] = [];
    table.subscribe((_, change) => changes.push(change.type));
    table.dispatch(oneCard('s1', 'c1'));
    const fresh = reduce(emptyTable, oneCard('s9', 'c9'));
    table.replace(fresh);
    expect(table.state).toBe(fresh);
    table.undo();
    expect(Object.keys(table.state.stacks)).toEqual(['s1']);
    table.load(fresh);
    expect(table.canUndo || table.canRedo).toBe(false);
    expect(changes).toEqual(['createStack', 'restore', 'restore', 'load']);
  });
});

describe('newGame', () => {
  const { faces } = parseCardSet(sample);

  it('puts every play card and one character per seat on the table or in the hand, each once', () => {
    const state = buildTable(newGame(faces, { players: 4, perSeat: 4 }, () => 0.5));
    const placed = [
      ...Object.values(state.stacks).flatMap((stack) => stack.cardIds),
      ...Object.values(state.hands).flatMap((hand) => hand.cardIds),
    ];
    expect(new Set(placed).size).toBe(placed.length);
    const placedFaces = placed.map((id) => state.cards[id]?.faceId);
    const playFaces = faces.filter((face) => face.kind !== 'character').map((face) => face.id);
    expect(placedFaces.filter((id) => playFaces.includes(id as string)).sort()).toEqual([...playFaces].sort());
    // The characters left over stay in the box.
    expect(placed).toHaveLength(playFaces.length + 4);
  });

  it('gives each seat a face-up character, deals the hands, and leaves the deck face down on the draw spot', () => {
    const state = buildTable(newGame(faces, { players: 5, perSeat: 3 }, Math.random));
    const kindOf = (cardId: string) => faces.find((face) => face.id === state.cards[cardId]?.faceId)?.kind;
    const stacks = Object.values(state.stacks);
    const characters = stacks.filter((stack) => stack.cardIds.some((id) => kindOf(id) === 'character'));
    expect(characters).toHaveLength(5);
    for (const stack of characters) {
      expect(stack.cardIds).toHaveLength(1);
      expect(state.cards[stack.cardIds[0] as string]?.faceUp).toBe(true);
    }
    expect(state.hands[LOCAL_HAND_ID]?.cardIds).toHaveLength(3);
    const handPiles = stacks.filter((stack) => stack.cardIds.length === 3);
    expect(handPiles).toHaveLength(4);
    expect(handPiles.every((pile) => pile.cardIds.every((id) => !state.cards[id]?.faceUp))).toBe(true);
    const deck = stacks.find((stack) => stack.x === -5 && stack.z === -2);
    const playCards = faces.filter((face) => face.kind !== 'character').length;
    expect(deck?.cardIds).toHaveLength(playCards - 5 * 3);
    expect(deck?.cardIds.some((id) => kindOf(id) === 'character')).toBe(false);
  });

  it("keeps every seat's cards apart and on the table, for any number of players", () => {
    for (let players = 2; players <= 7; players++) {
      const state = buildTable(newGame(faces, { players, perSeat: 2 }));
      const stacks = Object.values(state.stacks);
      for (const a of stacks) {
        expect(Math.abs(a.x)).toBeLessThan(55 - 3);
        expect(Math.abs(a.z)).toBeLessThan(36 - 3);
        for (const b of stacks) {
          if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(6);
        }
      }
    }
  });
});

describe('seats', () => {
  it('puts seat 0 in front of the first player and turns each seat to face the middle', () => {
    expect(seats(4).map((seat) => [Math.round(seat.x) || 0, Math.round(seat.z) || 0, seat.turn])).toEqual([
      [0, 25, 0],
      [-43, 0, 1],
      [0, -25, 2],
      [43, 0, 3],
    ]);
    expect(seats(99)).toHaveLength(7);
  });
});

/** A table with one stack "deck" of cards a (bottom), b, c (top), all face down. */
function deckOfThree() {
  return reduce(emptyTable, {
    type: 'createStack',
    stack: { id: 'deck', x: 0, z: 0, turn: 0, cardIds: ['a', 'b', 'c'] },
    cards: ['a', 'b', 'c'].map((id) => ({ id, faceId: `face-${id}`, faceUp: false })),
  });
}

describe('card control actions', () => {
  it('moves a stack', () => {
    const state = reduce(deckOfThree(), { type: 'moveStack', stackId: 'deck', x: 5, z: -3 });
    expect(state.stacks.deck).toMatchObject({ x: 5, z: -3, cardIds: ['a', 'b', 'c'] });
  });

  it('takes the top card off into a new stack, keeping the turn', () => {
    const turned = reduce(deckOfThree(), { type: 'turnStack', stackId: 'deck', by: 1 });
    const state = reduce(turned, { type: 'splitStack', stackId: 'deck', count: 1, newStackId: 'hand', x: 9, z: 9 });
    expect(state.stacks.deck?.cardIds).toEqual(['a', 'b']);
    expect(state.stacks.hand).toEqual({ id: 'hand', x: 9, z: 9, turn: 1, cardIds: ['c'] });
  });

  it('refuses to split off every card or none', () => {
    const state = deckOfThree();
    for (const count of [0, 3, 1.5]) {
      expect(() => reduce(state, { type: 'splitStack', stackId: 'deck', count, newStackId: 'x', x: 0, z: 0 })).toThrow(
        TableActionError,
      );
    }
  });

  it('puts one stack on top of another and removes the source', () => {
    const split = reduce(deckOfThree(), {
      type: 'splitStack',
      stackId: 'deck',
      count: 2,
      newStackId: 'top',
      x: 1,
      z: 1,
    });
    expect(split.stacks.top?.cardIds).toEqual(['b', 'c']);
    const merged = reduce(split, { type: 'mergeStacks', sourceId: 'top', targetId: 'deck' });
    expect(merged.stacks.top).toBeUndefined();
    expect(merged.stacks.deck?.cardIds).toEqual(['a', 'b', 'c']);
    expect(() => reduce(merged, { type: 'mergeStacks', sourceId: 'deck', targetId: 'deck' })).toThrow(TableActionError);
  });

  it('flips a stack like a real pile: order reverses and each card turns over', () => {
    const state = reduce(deckOfThree(), { type: 'flipStack', stackId: 'deck' });
    expect(state.stacks.deck?.cardIds).toEqual(['c', 'b', 'a']);
    expect(Object.values(state.cards).every((card) => card.faceUp)).toBe(true);
  });

  it('turns by quarter turns and wraps around', () => {
    let state = deckOfThree();
    state = reduce(state, { type: 'turnStack', stackId: 'deck', by: -1 });
    expect(state.stacks.deck?.turn).toBe(3);
    state = reduce(state, { type: 'turnStack', stackId: 'deck', by: 2 });
    expect(state.stacks.deck?.turn).toBe(1);
  });

  it('finds the stack that holds a card', () => {
    const state = deckOfThree();
    expect(stackOfCard(state, 'b')?.id).toBe('deck');
    expect(stackOfCard(state, 'zzz')).toBeUndefined();
  });

  it('rejects actions on a stack that does not exist', () => {
    expect(() => reduce(emptyTable, { type: 'flipStack', stackId: 'nope' })).toThrow(/no stack nope/);
  });
});

/** deckOfThree plus an empty hand "me". */
function withHand() {
  return reduce(deckOfThree(), { type: 'createHand', handId: 'me' });
}

describe('placement order', () => {
  it('puts a created or moved stack last, so it lies on top', () => {
    let state = deckOfThree();
    state = reduce(state, oneCard('loose', 'x'));
    expect(Object.keys(state.stacks)).toEqual(['deck', 'loose']);
    state = reduce(state, { type: 'moveStack', stackId: 'deck', x: 1, z: 1 });
    expect(Object.keys(state.stacks)).toEqual(['loose', 'deck']);
    state = reduce(state, { type: 'turnStack', stackId: 'loose', by: 1 });
    expect(Object.keys(state.stacks)).toEqual(['loose', 'deck']);
  });
});

describe('deck actions', () => {
  it('shuffles into the given order and refuses an order that is not a shuffle', () => {
    const state = reduce(deckOfThree(), { type: 'shuffleStack', stackId: 'deck', order: ['c', 'a', 'b'] });
    expect(state.stacks.deck?.cardIds).toEqual(['c', 'a', 'b']);
    for (const order of [
      ['a', 'b'],
      ['a', 'a', 'b'],
      ['a', 'b', 'z'],
    ]) {
      expect(() => reduce(state, { type: 'shuffleStack', stackId: 'deck', order })).toThrow(TableActionError);
    }
  });

  it('deals the top cards onto another pile one at a time', () => {
    let state = reduce(deckOfThree(), oneCard('pile', 'x'));
    state = reduce(state, { type: 'transferTop', fromStackId: 'deck', toStackId: 'pile', count: 2 });
    expect(state.stacks.deck?.cardIds).toEqual(['a']);
    expect(state.stacks.pile?.cardIds).toEqual(['x', 'c', 'b']);
    state = reduce(state, { type: 'transferTop', fromStackId: 'deck', toStackId: 'pile', count: 1 });
    expect(state.stacks.deck).toBeUndefined();
  });

  it('spreads a stack into single cards, bottom card keeping the id', () => {
    const state = reduce(deckOfThree(), {
      type: 'spreadStack',
      stackId: 'deck',
      newStackIds: ['s2', 's3'],
      positions: [
        { x: 0, z: 0 },
        { x: 3, z: 0 },
        { x: 6, z: 0 },
      ],
    });
    expect(Object.values(state.stacks).map((s) => [s.id, s.x, s.cardIds])).toEqual([
      ['deck', 0, ['a']],
      ['s2', 3, ['b']],
      ['s3', 6, ['c']],
    ]);
    expect(() =>
      reduce(deckOfThree(), { type: 'spreadStack', stackId: 'deck', newStackIds: ['s2'], positions: [] }),
    ).toThrow(TableActionError);
  });

  it('gathers stacks back into one, in the order given', () => {
    let state = reduce(deckOfThree(), {
      type: 'spreadStack',
      stackId: 'deck',
      newStackIds: ['s2', 's3'],
      positions: [
        { x: 0, z: 0 },
        { x: 3, z: 0 },
        { x: 6, z: 0 },
      ],
    });
    state = reduce(state, { type: 'gatherStacks', targetId: 'deck', sourceIds: ['s3', 's2'] });
    expect(Object.keys(state.stacks)).toEqual(['deck']);
    expect(state.stacks.deck?.cardIds).toEqual(['a', 'c', 'b']);
    expect(() => reduce(state, { type: 'gatherStacks', targetId: 'deck', sourceIds: ['deck'] })).toThrow(
      TableActionError,
    );
  });
});

describe('hand actions', () => {
  it('draws the top cards into the hand, top card first, and removes an emptied stack', () => {
    let state = reduce(withHand(), { type: 'drawToHand', stackId: 'deck', handId: 'me', count: 2 });
    expect(state.hands.me?.cardIds).toEqual(['c', 'b']);
    expect(state.stacks.deck?.cardIds).toEqual(['a']);
    state = reduce(state, { type: 'drawToHand', stackId: 'deck', handId: 'me', count: 1 });
    expect(state.hands.me?.cardIds).toEqual(['c', 'b', 'a']);
    expect(state.stacks.deck).toBeUndefined();
    expect(() => reduce(withHand(), { type: 'drawToHand', stackId: 'deck', handId: 'me', count: 4 })).toThrow(
      TableActionError,
    );
  });

  it('plays a card from the hand to the table, face up or down', () => {
    let state = reduce(withHand(), { type: 'drawToHand', stackId: 'deck', handId: 'me', count: 2 });
    state = reduce(state, {
      type: 'playToTable',
      handId: 'me',
      cardId: 'b',
      faceUp: true,
      newStackId: 'played',
      x: 4,
      z: 5,
      turn: 1,
    });
    expect(state.hands.me?.cardIds).toEqual(['c']);
    expect(state.stacks.played).toEqual({ id: 'played', x: 4, z: 5, turn: 1, cardIds: ['b'] });
    expect(state.cards.b?.faceUp).toBe(true);
    expect(Object.keys(state.stacks).at(-1)).toBe('played');
  });

  it('plays a card from the hand onto a stack', () => {
    let state = reduce(withHand(), { type: 'drawToHand', stackId: 'deck', handId: 'me', count: 1 });
    state = reduce(state, { type: 'playOntoStack', handId: 'me', cardId: 'c', faceUp: true, stackId: 'deck' });
    expect(state.stacks.deck?.cardIds).toEqual(['a', 'b', 'c']);
    expect(state.cards.c?.faceUp).toBe(true);
    expect(() =>
      reduce(state, { type: 'playOntoStack', handId: 'me', cardId: 'c', faceUp: true, stackId: 'deck' }),
    ).toThrow(/not in hand/);
  });

  it('takes a whole stack into the hand at a place', () => {
    let state = reduce(withHand(), { type: 'splitStack', stackId: 'deck', count: 1, newStackId: 'top', x: 9, z: 9 });
    state = reduce(state, { type: 'stackToHand', stackId: 'deck', handId: 'me', index: 0 });
    state = reduce(state, { type: 'stackToHand', stackId: 'top', handId: 'me', index: 1 });
    expect(state.hands.me?.cardIds).toEqual(['b', 'c', 'a']);
    expect(state.stacks).toEqual({});
  });

  it('reorders cards in the hand', () => {
    let state = reduce(withHand(), { type: 'drawToHand', stackId: 'deck', handId: 'me', count: 3 });
    state = reduce(state, { type: 'reorderHand', handId: 'me', cardId: 'c', index: 2 });
    expect(state.hands.me?.cardIds).toEqual(['b', 'a', 'c']);
    state = reduce(state, { type: 'reorderHand', handId: 'me', cardId: 'a', index: -5 });
    expect(state.hands.me?.cardIds).toEqual(['a', 'b', 'c']);
  });
});
