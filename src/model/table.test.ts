import { describe, expect, it, vi } from 'vitest';
import sample from '../data/wild-west-sample.json';
import { parseCardSet } from './cardSet';
import { demoSetup } from './setup';
import { Table, TableActionError, emptyTable, reduce, stackOfCard, type Action } from './table';

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

describe('demoSetup', () => {
  it('puts every card of the sample deck on the table exactly once', () => {
    const { faces } = parseCardSet(sample);
    const table = new Table();
    for (const action of demoSetup(faces, () => 0.5)) table.dispatch(action);

    const placed = Object.values(table.state.stacks).flatMap((stack) => stack.cardIds);
    expect(placed).toHaveLength(faces.length);
    expect(new Set(placed).size).toBe(faces.length);
    const faceIds = placed.map((id) => table.state.cards[id]?.faceId).sort();
    expect(faceIds).toEqual(faces.map((face) => face.id).sort());
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
