/**
 * The table's state, kept apart from the 3D view.
 *
 * Every change goes through an Action, applied by a pure `reduce` function.
 * Actions carry all the ids they need, so the same list of actions gives the
 * same table on any machine. That is what online multiplayer will build on.
 */

/** One physical card. Where it lies is decided by the stack that holds it. */
export interface CardState {
  id: string;
  faceId: string;
  faceUp: boolean;
}

/**
 * A pile of cards at one spot on the table. A single loose card is a stack of
 * one, and a deck is just a tall stack.
 */
export interface StackState {
  id: string;
  /** Table position in centimetres. The table centre is 0,0 and +z is toward the first seat. */
  x: number;
  z: number;
  /** Quarter turns clockwise, seen from above: 0 to 3. */
  turn: number;
  /** Bottom card first, top card last. */
  cardIds: string[];
}

export interface TableState {
  cards: Readonly<Record<string, CardState>>;
  stacks: Readonly<Record<string, StackState>>;
}

export type Action = {
  type: 'createStack';
  stack: StackState;
  /** The cards in the new stack, which must not be on the table yet. */
  cards: CardState[];
};

export const emptyTable: TableState = { cards: {}, stacks: {} };

export class TableActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableActionError';
  }
}

export function reduce(state: TableState, action: Action): TableState {
  switch (action.type) {
    case 'createStack':
      return createStack(state, action);
  }
}

function createStack(state: TableState, { stack, cards }: Extract<Action, { type: 'createStack' }>): TableState {
  if (state.stacks[stack.id]) throw new TableActionError(`Stack ${stack.id} already exists.`);
  if (stack.cardIds.length === 0) throw new TableActionError('A stack needs at least one card.');
  const given = new Map(cards.map((card) => [card.id, card]));
  if (given.size !== cards.length || given.size !== stack.cardIds.length) {
    throw new TableActionError(`Stack ${stack.id} must list each of its cards exactly once.`);
  }
  for (const cardId of stack.cardIds) {
    if (!given.has(cardId)) throw new TableActionError(`Card ${cardId} is missing from stack ${stack.id}.`);
    if (state.cards[cardId]) throw new TableActionError(`Card ${cardId} is already on the table.`);
  }
  const newCards: Record<string, CardState> = { ...state.cards };
  for (const card of cards) newCards[card.id] = { ...card };
  return {
    cards: newCards,
    stacks: { ...state.stacks, [stack.id]: { ...stack, turn: normalizeTurn(stack.turn), cardIds: [...stack.cardIds] } },
  };
}

export function normalizeTurn(turn: number): number {
  return ((Math.round(turn) % 4) + 4) % 4;
}

type Listener = (state: TableState, action: Action) => void;

/** Holds the current state and tells listeners, such as the 3D view, about each change. */
export class Table {
  private current: TableState = emptyTable;
  private readonly listeners = new Set<Listener>();

  get state(): TableState {
    return this.current;
  }

  dispatch(action: Action): void {
    this.current = reduce(this.current, action);
    for (const listener of this.listeners) listener(this.current, action);
  }

  /** Calls `listener` after every change. Returns a function that stops it. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Makes short ids like "card-12". One generator per table keeps them unique. */
export class IdGenerator {
  private next = 1;

  constructor(private readonly prefix = '') {}

  make(kind: string): string {
    return `${this.prefix}${kind}-${this.next++}`;
  }
}
