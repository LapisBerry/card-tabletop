/**
 * Saving the table in the browser, so a reload carries on with the same game.
 *
 * A saved table is only used if it still fits: the same card set, faces that
 * exist, and every card in exactly one place. Anything else is ignored and a
 * new game starts instead, so a broken or old save can never stop the page.
 */
import { TABLE_DEPTH, TABLE_WIDTH } from './dimensions';
import type { CardState, HandState, StackState, TableState } from './table';

const VERSION = 1;

export interface SavedTable {
  version: number;
  setId: string;
  state: TableState;
}

export function serializeTable(state: TableState, setId: string): string {
  const saved: SavedTable = { version: VERSION, setId, state };
  return JSON.stringify(saved);
}

/** Reads a saved table back, or returns null if it does not fit this card set and hand. */
export function parseSavedTable(
  text: string | null,
  setId: string,
  faceIds: ReadonlySet<string>,
  handId: string,
): TableState | null {
  if (!text) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(json) || json.version !== VERSION || json.setId !== setId || !isObject(json.state)) return null;
  const { cards, stacks, hands } = json.state;
  if (!isObject(cards) || !isObject(stacks) || !isObject(hands)) return null;

  const cardOut: Record<string, CardState> = {};
  for (const [id, card] of Object.entries(cards)) {
    if (!isObject(card) || card.id !== id || typeof card.faceId !== 'string' || typeof card.faceUp !== 'boolean') {
      return null;
    }
    if (!faceIds.has(card.faceId)) return null;
    cardOut[id] = { id, faceId: card.faceId, faceUp: card.faceUp };
  }

  const placed = new Set<string>();
  const takeCards = (list: unknown, allowEmpty: boolean): string[] | null => {
    if (!Array.isArray(list) || (!allowEmpty && list.length === 0)) return null;
    for (const cardId of list) {
      if (typeof cardId !== 'string' || !cardOut[cardId] || placed.has(cardId)) return null;
      placed.add(cardId);
    }
    return [...(list as string[])];
  };

  const stackOut: Record<string, StackState> = {};
  for (const [id, stack] of Object.entries(stacks)) {
    if (!isObject(stack) || stack.id !== id) return null;
    const { x, z, turn } = stack;
    if (!isNumber(x) || !isNumber(z) || Math.abs(x) > TABLE_WIDTH / 2 || Math.abs(z) > TABLE_DEPTH / 2) return null;
    if (!Number.isInteger(turn) || (turn as number) < 0 || (turn as number) > 3) return null;
    const cardIds = takeCards(stack.cardIds, false);
    if (!cardIds) return null;
    stackOut[id] = { id, x, z, turn: turn as number, cardIds };
  }

  const handOut: Record<string, HandState> = {};
  for (const [id, hand] of Object.entries(hands)) {
    if (!isObject(hand) || hand.id !== id) return null;
    const cardIds = takeCards(hand.cardIds, true);
    if (!cardIds) return null;
    handOut[id] = { id, cardIds };
  }

  if (!handOut[handId] || placed.size !== Object.keys(cardOut).length) return null;
  return { cards: cardOut, stacks: stackOut, hands: handOut };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
