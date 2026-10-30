import type { CardFace } from './cardSet';
import { DISCARD_ZONE, DRAW_ZONE, LOCAL_HAND_ID } from './layout';
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

/** Cards the first player starts with in hand. */
export const STARTING_HAND = 5;

/**
 * Lays out a starting table: a shuffled face-down deck on the draw spot, one
 * face-up card on the discard spot, two equipment cards face up in front of
 * the first seat, and a starting hand.
 *
 * Returns the actions to dispatch, so the same setup can be sent to other players later.
 */
export function demoSetup(faces: readonly CardFace[], random: Random = Math.random): Action[] {
  const ids = new IdGenerator();
  const deck = shuffled(faces, random);
  const actions: Action[] = [{ type: 'createHand', handId: LOCAL_HAND_ID }];

  const place = (x: number, z: number, turn: number, pile: CardFace[], faceUp: boolean) => {
    if (pile.length === 0) return;
    const cards: CardState[] = pile.map((face) => ({ id: ids.make('card'), faceId: face.id, faceUp }));
    actions.push({
      type: 'createStack',
      stack: { id: ids.make('stack'), x, z, turn, cardIds: cards.map((card) => card.id) },
      cards,
    });
  };

  // Two equipment cards in play in front of the first seat, the way Bang! players lay out guns and horses.
  const equipment: CardFace[] = [];
  for (let i = 0; i < deck.length && equipment.length < 2; ) {
    if (deck[i]?.kind === 'equipment') equipment.push(...deck.splice(i, 1));
    else i++;
  }
  equipment.forEach((face, i) => place(-4 + i * 8, 20, 0, [face], true));

  const discard = deck.splice(0, 1);
  place(DISCARD_ZONE.x, DISCARD_ZONE.z, DISCARD_ZONE.turn, discard, true);

  const deckStackIndex = actions.length;
  place(DRAW_ZONE.x, DRAW_ZONE.z, DRAW_ZONE.turn, deck, false);
  const deckAction = actions[deckStackIndex];
  if (deckAction?.type === 'createStack' && deck.length >= STARTING_HAND) {
    actions.push({ type: 'drawToHand', stackId: deckAction.stack.id, handId: LOCAL_HAND_ID, count: STARTING_HAND });
  }
  return actions;
}
