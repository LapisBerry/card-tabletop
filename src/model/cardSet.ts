/**
 * Card sets: the printed faces of the cards, loaded from a JSON file.
 *
 * A JSON entry describes one card design and lists the physical copies of it
 * by rank and suit (for example "10H" for the ten of hearts), the way Bang!
 * prints a poker value on every card. Each copy becomes its own CardFace.
 */

export type CardKind = 'action' | 'equipment' | 'character' | 'role';
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

/** The printed face of one physical card. */
export interface CardFace {
  /** Unique within the set, for example "shot#3". */
  id: string;
  /** The design this copy was printed from, for example "shot". */
  designId: string;
  name: string;
  kind: CardKind;
  text: string;
  suit?: Suit;
  rank?: string;
  /** Starting health printed on a character card. */
  health?: number;
}

export interface CardSet {
  id: string;
  name: string;
  /** Printed on the back of every card in the set. */
  backLabel: string;
  faces: CardFace[];
}

/** The shape of a card set JSON file. */
export interface CardSetJson {
  id: string;
  name: string;
  backLabel: string;
  cards: CardDesignJson[];
}

export interface CardDesignJson {
  id: string;
  name: string;
  kind: CardKind;
  text?: string;
  /** Rank and suit of each copy, like "AS" or "10H". Leave out for a single unmarked copy. */
  copies?: string[];
  /** Starting health, printed on character cards: a whole number from 1 to 9. */
  health?: number;
}

const KINDS: readonly CardKind[] = ['action', 'equipment', 'character', 'role'];
const SUITS: Record<string, Suit> = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' };
const COPY_CODE = /^(10|[2-9AJQK])([HDCS])$/;

export class CardSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardSetError';
  }
}

/** Checks a card set JSON file and expands it into one face per physical card. */
export function parseCardSet(json: unknown): CardSet {
  if (!isObject(json)) throw new CardSetError('Card set must be a JSON object.');
  const id = requireString(json, 'id', 'card set');
  const name = requireString(json, 'name', 'card set');
  const backLabel = requireString(json, 'backLabel', 'card set');
  if (!Array.isArray(json.cards)) throw new CardSetError('Card set needs a "cards" list.');

  const designIds = new Set<string>();
  const faces: CardFace[] = [];

  json.cards.forEach((entry: unknown, index: number) => {
    const where = `card #${index + 1}`;
    if (!isObject(entry)) throw new CardSetError(`${where} must be an object.`);
    const designId = requireString(entry, 'id', where);
    const label = `card "${designId}"`;
    if (designIds.has(designId)) throw new CardSetError(`Two cards share the id "${designId}".`);
    designIds.add(designId);

    const cardName = requireString(entry, 'name', label);
    const kind = entry.kind;
    if (typeof kind !== 'string' || !KINDS.includes(kind as CardKind)) {
      throw new CardSetError(`${label} has kind ${JSON.stringify(kind)}; use one of ${KINDS.join(', ')}.`);
    }
    const text = entry.text === undefined ? '' : requireString(entry, 'text', label);
    const health = entry.health;
    if (health !== undefined && (typeof health !== 'number' || !Number.isInteger(health) || health < 1 || health > 9)) {
      throw new CardSetError(`${label} has health ${JSON.stringify(health)}; use a whole number from 1 to 9.`);
    }
    const extra = health === undefined ? {} : { health };

    const copies = entry.copies;
    if (copies === undefined) {
      faces.push({ id: designId, designId, name: cardName, kind: kind as CardKind, text, ...extra });
      return;
    }
    if (!Array.isArray(copies) || copies.length === 0) {
      throw new CardSetError(`${label} "copies" must be a non-empty list like ["AS", "10H"].`);
    }
    copies.forEach((code: unknown, copyIndex: number) => {
      const match = typeof code === 'string' ? COPY_CODE.exec(code) : null;
      if (!match) {
        throw new CardSetError(
          `${label} has copy ${JSON.stringify(code)}; use a rank (2-10, J, Q, K, A) and a suit (H, D, C, S), like "10H".`,
        );
      }
      faces.push({
        id: `${designId}#${copyIndex + 1}`,
        designId,
        name: cardName,
        kind: kind as CardKind,
        text,
        rank: match[1],
        suit: SUITS[match[2] as string],
        ...extra,
      });
    });
  });

  return { id, name, backLabel, faces };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CardSetError(`${where} needs a text "${key}".`);
  }
  return value;
}
