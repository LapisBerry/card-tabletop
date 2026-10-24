import type { CardFace } from './cardSet';
import { IdGenerator, type Action, type CardState } from './table';

export type Random = () => number;

/** Fisher-Yates shuffle into a new array. */
export function shuffled<T>(items: readonly T[], random: Random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Lays out a starting table to show the cards off: a face-down draw pile, a
 * small face-up discard pile, and a row of face-up cards in front of the first
 * seat, with one equipment card turned sideways.
 *
 * Returns the actions to dispatch, so the same setup can be sent to other players later.
 */
export function demoSetup(faces: readonly CardFace[], random: Random = Math.random): Action[] {
  const ids = new IdGenerator();
  const deck = shuffled(faces, random);
  const actions: Action[] = [];

  const place = (x: number, z: number, turn: number, pile: CardFace[], faceUp: boolean) => {
    if (pile.length === 0) return;
    const cards: CardState[] = pile.map((face) => ({ id: ids.make('card'), faceId: face.id, faceUp }));
    actions.push({
      type: 'createStack',
      stack: { id: ids.make('stack'), x, z, turn, cardIds: cards.map((card) => card.id) },
      cards,
    });
  };

  // One equipment card is shown turned sideways, the way a played card is marked in Bang!.
  const equipmentIndex = deck.findIndex((face) => face.kind === 'equipment');
  const turned = equipmentIndex >= 0 ? deck.splice(equipmentIndex, 1) : [];

  const row = deck.splice(0, 5);
  const discard = deck.splice(0, 3);

  row.forEach((face, i) => place(-16 + i * 8, 20, 0, [face], true));
  place(26, 20, 1, turned, true);
  place(5, -2, 0, discard, true);
  place(-5, -2, 0, deck, false);

  return actions;
}
