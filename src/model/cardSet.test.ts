import { describe, expect, it } from 'vitest';
import sample from '../data/wild-west-sample.json';
import { CardSetError, parseCardSet } from './cardSet';

describe('parseCardSet', () => {
  it('expands each copy into its own face with rank and suit', () => {
    const set = parseCardSet({
      id: 'test',
      name: 'Test',
      backLabel: 'TEST',
      cards: [{ id: 'shot', name: 'Shot', kind: 'action', text: 'Bang.', copies: ['AS', '10H'] }],
    });
    expect(set.faces).toEqual([
      { id: 'shot#1', designId: 'shot', name: 'Shot', kind: 'action', text: 'Bang.', rank: 'A', suit: 'spades' },
      { id: 'shot#2', designId: 'shot', name: 'Shot', kind: 'action', text: 'Bang.', rank: '10', suit: 'hearts' },
    ]);
  });

  it('makes one unmarked face when copies are left out', () => {
    const set = parseCardSet({
      id: 'test',
      name: 'Test',
      backLabel: 'TEST',
      cards: [{ id: 'sheriff', name: 'Sheriff', kind: 'role' }],
    });
    expect(set.faces).toEqual([{ id: 'sheriff', designId: 'sheriff', name: 'Sheriff', kind: 'role', text: '' }]);
  });

  it('rejects bad copy codes, kinds and duplicate ids with a clear message', () => {
    const base = { id: 't', name: 'T', backLabel: 'T' };
    expect(() => parseCardSet({ ...base, cards: [{ id: 'a', name: 'A', kind: 'action', copies: ['1H'] }] })).toThrow(
      /copy "1H"/,
    );
    expect(() => parseCardSet({ ...base, cards: [{ id: 'a', name: 'A', kind: 'spell' }] })).toThrow(/kind "spell"/);
    expect(() =>
      parseCardSet({
        ...base,
        cards: [
          { id: 'a', name: 'A', kind: 'action' },
          { id: 'a', name: 'B', kind: 'action' },
        ],
      }),
    ).toThrow(CardSetError);
  });

  it('reads the health printed on character cards and rejects odd values', () => {
    const base = { id: 't', name: 'T', backLabel: 'T' };
    const set = parseCardSet({ ...base, cards: [{ id: 'kid', name: 'Kid', kind: 'character', health: 4 }] });
    expect(set.faces[0]).toMatchObject({ id: 'kid', kind: 'character', health: 4 });
    expect(() => parseCardSet({ ...base, cards: [{ id: 'kid', name: 'Kid', kind: 'character', health: 0 }] })).toThrow(
      /health 0/,
    );
    expect(() =>
      parseCardSet({ ...base, cards: [{ id: 'kid', name: 'Kid', kind: 'character', health: '4' }] }),
    ).toThrow(/health "4"/);
  });

  it('loads the bundled sample set: 55 play cards and 8 characters', () => {
    const set = parseCardSet(sample);
    expect(set.faces).toHaveLength(63);
    expect(new Set(set.faces.map((face) => face.id)).size).toBe(63);
    const characters = set.faces.filter((face) => face.kind === 'character');
    expect(characters).toHaveLength(8);
    expect(characters.every((face) => face.health && !face.rank)).toBe(true);
  });
});
