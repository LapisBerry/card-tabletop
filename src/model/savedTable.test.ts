import { describe, expect, it } from 'vitest';
import sample from '../data/wild-west-sample.json';
import { parseCardSet } from './cardSet';
import { LOCAL_HAND_ID } from './layout';
import { parseSavedTable, serializeTable } from './savedTable';
import { newGame } from './setup';
import { buildTable, type TableState } from './table';

const set = parseCardSet(sample);
const faceIds = new Set(set.faces.map((face) => face.id));
const game = buildTable(newGame(set.faces));

function edited(change: (state: { cards: any; stacks: any; hands: any }) => void): string {
  const copy = JSON.parse(serializeTable(game, set.id));
  change(copy.state);
  return JSON.stringify(copy);
}

const read = (text: string | null): TableState | null => parseSavedTable(text, set.id, faceIds, LOCAL_HAND_ID);

describe('saved tables', () => {
  it('reads back exactly what was saved, in the same placement order', () => {
    const back = read(serializeTable(game, set.id));
    expect(back).toEqual(game);
    expect(Object.keys(back?.stacks ?? {})).toEqual(Object.keys(game.stacks));
  });

  it('ignores nothing saved, broken text, and saves from another card set', () => {
    expect(read(null)).toBeNull();
    expect(read('{not json')).toBeNull();
    expect(parseSavedTable(serializeTable(game, set.id), 'other-set', faceIds, LOCAL_HAND_ID)).toBeNull();
  });

  it('ignores a save whose cards do not add up', () => {
    const [firstStack] = Object.keys(game.stacks);
    const [handCard] = game.hands[LOCAL_HAND_ID]?.cardIds ?? [];
    // A card in two places.
    expect(read(edited((s) => s.stacks[firstStack as string].cardIds.push(handCard)))).toBeNull();
    // A card that is nowhere.
    expect(read(edited((s) => (s.hands[LOCAL_HAND_ID].cardIds = [])))).toBeNull();
    // A face this card set does not have.
    expect(read(edited((s) => (s.cards[handCard as string].faceId = 'gone#1')))).toBeNull();
    // A stack off the table, or turned an odd way.
    expect(read(edited((s) => (s.stacks[firstStack as string].x = 900)))).toBeNull();
    expect(read(edited((s) => (s.stacks[firstStack as string].turn = 1.5)))).toBeNull();
    // No hand for this screen.
    expect(read(edited((s) => delete s.hands[LOCAL_HAND_ID]))).toBeNull();
  });
});
