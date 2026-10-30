import type { CardFace } from './cardSet';
import { DRAW_ZONE, LOCAL_HAND_ID, MAX_SEATS, seats, type Seat } from './layout';
import { planDeal } from './plans';
import { shuffled, type Random } from './random';
import { IdGenerator, buildTable, type Action, type CardState } from './table';

export interface GameOptions {
  /** Seats round the table, 2 to 7. This screen is seat 0. */
  players: number;
  /** Cards dealt to each seat to start. */
  perSeat: number;
}

export const DEFAULT_GAME: GameOptions = { players: 4, perSeat: 4 };
export const MIN_PLAYERS = 2;
export const MAX_DEAL = 20;

/** How far from a seat's place its character card lies (to the seat's left) and its hand pile (to its right). */
const SEAT_SPREAD = 4.5;

/**
 * Sets up a new game: the play cards shuffled face down on the draw spot, a
 * character card face up at each seat, and `perSeat` cards dealt round the
 * table, into this screen's hand for seat 0 and into a face-down pile at each
 * other seat. The discard spot starts empty.
 *
 * Returns the actions, so the same setup can be sent to other players later.
 */
export function newGame(
  faces: readonly CardFace[],
  options: GameOptions = DEFAULT_GAME,
  random: Random = Math.random,
): Action[] {
  const ids = new IdGenerator();
  const players = clamp(options.players, MIN_PLAYERS, MAX_SEATS);
  const perSeat = clamp(options.perSeat, 0, MAX_DEAL);
  const seatList = seats(players);
  const characters = shuffled(
    faces.filter((face) => face.kind === 'character'),
    random,
  );
  const deck = shuffled(
    faces.filter((face) => face.kind !== 'character' && face.kind !== 'role'),
    random,
  );
  const actions: Action[] = [{ type: 'createHand', handId: LOCAL_HAND_ID }];

  const place = (x: number, z: number, turn: number, pile: readonly CardFace[], faceUp: boolean): string | null => {
    if (pile.length === 0) return null;
    const cards: CardState[] = pile.map((face) => ({ id: ids.make('card'), faceId: face.id, faceUp }));
    const stackId = ids.make('stack');
    actions.push({ type: 'createStack', stack: { id: stackId, x, z, turn, cardIds: cards.map((c) => c.id) }, cards });
    return stackId;
  };

  seatList.forEach((seat, i) => {
    const face = characters[i];
    if (face) place(...besideSeat(seat, -SEAT_SPREAD), seat.turn, [face], true);
  });
  const deckId = place(DRAW_ZONE.x, DRAW_ZONE.z, DRAW_ZONE.turn, deck, false);
  if (deckId && perSeat > 0) {
    const handSeats = seatList.map((seat) => {
      const [x, z] = besideSeat(seat, SEAT_SPREAD);
      return { ...seat, x, z };
    });
    actions.push(...planDeal(buildTable(actions), deckId, handSeats, perSeat, LOCAL_HAND_ID, ids));
  }
  return actions;
}

/** A spot `offset` along a seat's left-to-right line from its place; negative is to the seat's left. */
function besideSeat(seat: Seat, offset: number): [number, number] {
  // A seat's cards are turned by `turn` quarter turns, so its right hand points this way on the table.
  const angle = (seat.turn * Math.PI) / 2;
  return [round(seat.x + Math.cos(angle) * offset), round(seat.z + Math.sin(angle) * offset)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}
