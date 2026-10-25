import { describe, expect, it, vi } from 'vitest';
import sample from '../data/wild-west-sample.json';
import { parseCardSet } from './cardSet';
import { demoSetup } from './setup';
import { Table, TableActionError, emptyTable, reduce, type Action } from './table';

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
