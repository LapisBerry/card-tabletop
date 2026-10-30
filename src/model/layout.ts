/**
 * Fixed places on the table: marked spots for the draw and discard piles, and
 * the seats players sit at. Everyone shares the same layout.
 */
import { TABLE_DEPTH, TABLE_WIDTH } from './dimensions';
import { normalizeTurn } from './table';

/** A marked spot on the felt that a dropped card snaps to. */
export interface Zone {
  id: string;
  label: string;
  x: number;
  z: number;
  turn: number;
}

export const DRAW_ZONE: Zone = { id: 'draw', label: 'DRAW', x: -5, z: -2, turn: 0 };
export const DISCARD_ZONE: Zone = { id: 'discard', label: 'DISCARD', x: 5, z: -2, turn: 0 };
export const ZONES: readonly Zone[] = [DRAW_ZONE, DISCARD_ZONE];

/** The hand of the person at this screen. With online play, each player will have their own. */
export const LOCAL_HAND_ID = 'hand-1';

/** Where a seat's cards go on the table, and the quarter turns that make them read the right way up for that seat. */
export interface Seat {
  index: number;
  x: number;
  z: number;
  turn: number;
}

/** Most seats around one table, as in Bang!. */
export const MAX_SEATS = 7;

/**
 * Seats spaced evenly around the table edge, starting with seat 0 in front of
 * the first player (the +z edge) and going clockwise seen from above.
 */
export function seats(count: number): Seat[] {
  const n = Math.max(1, Math.min(MAX_SEATS, Math.round(count)));
  const rx = TABLE_WIDTH / 2 - 12;
  const rz = TABLE_DEPTH / 2 - 11;
  return Array.from({ length: n }, (_, index) => {
    // Angle around the table: 90° is the first seat at +z; going clockwise seen from above means increasing angle.
    const angle = Math.PI / 2 + (index * 2 * Math.PI) / n;
    return {
      index,
      x: round(Math.cos(angle) * rx),
      z: round(Math.sin(angle) * rz),
      // A card's top must point away from the seat, toward the middle of the table.
      turn: normalizeTurn((angle - Math.PI / 2) / (Math.PI / 2)),
    };
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100 || 0; // no -0
}
