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

export type Action =
  | {
      type: 'createStack';
      stack: StackState;
      /** The cards in the new stack, which must not be on the table yet. */
      cards: CardState[];
    }
  /** Moves a whole stack to a new spot. */
  | { type: 'moveStack'; stackId: string; x: number; z: number }
  /**
   * Lifts the top `count` cards off a stack into a new stack at x, z, keeping
   * their order. The source stack must keep at least one card.
   */
  | { type: 'splitStack'; stackId: string; count: number; newStackId: string; x: number; z: number }
  /** Puts every card of `sourceId` on top of `targetId`, in the same order. The source stack goes away. */
  | { type: 'mergeStacks'; sourceId: string; targetId: string }
  /** Turns a stack upside down, like flipping a real pile: the order reverses and every card turns over. */
  | { type: 'flipStack'; stackId: string }
  /** Turns a stack by quarter turns: 1 is clockwise seen from above, -1 is counter-clockwise. */
  | { type: 'turnStack'; stackId: string; by: number };

export type ActionType = Action['type'];

export const emptyTable: TableState = { cards: {}, stacks: {} };

export class TableActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableActionError';
  }
}

/** Applies one action and returns the new state. The old state is never changed. */
export function reduce(state: TableState, action: Action): TableState {
  switch (action.type) {
    case 'createStack':
      return createStack(state, action);
    case 'moveStack': {
      const stack = requireStack(state, action.stackId);
      return withStack(state, { ...stack, x: action.x, z: action.z });
    }
    case 'splitStack':
      return splitStack(state, action);
    case 'mergeStacks':
      return mergeStacks(state, action);
    case 'flipStack': {
      const stack = requireStack(state, action.stackId);
      const cards: Record<string, CardState> = { ...state.cards };
      for (const cardId of stack.cardIds) {
        const card = cards[cardId];
        if (card) cards[cardId] = { ...card, faceUp: !card.faceUp };
      }
      return { cards, stacks: { ...state.stacks, [stack.id]: { ...stack, cardIds: [...stack.cardIds].reverse() } } };
    }
    case 'turnStack': {
      const stack = requireStack(state, action.stackId);
      return withStack(state, { ...stack, turn: normalizeTurn(stack.turn + action.by) });
    }
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

function splitStack(state: TableState, action: Extract<Action, { type: 'splitStack' }>): TableState {
  const stack = requireStack(state, action.stackId);
  if (state.stacks[action.newStackId]) throw new TableActionError(`Stack ${action.newStackId} already exists.`);
  if (!Number.isInteger(action.count) || action.count < 1 || action.count >= stack.cardIds.length) {
    throw new TableActionError(
      `Can only take 1 to ${stack.cardIds.length - 1} cards off stack ${stack.id}, not ${action.count}.`,
    );
  }
  const keep = stack.cardIds.slice(0, stack.cardIds.length - action.count);
  const lifted = stack.cardIds.slice(stack.cardIds.length - action.count);
  return {
    cards: state.cards,
    stacks: {
      ...state.stacks,
      [stack.id]: { ...stack, cardIds: keep },
      [action.newStackId]: { id: action.newStackId, x: action.x, z: action.z, turn: stack.turn, cardIds: lifted },
    },
  };
}

function mergeStacks(state: TableState, { sourceId, targetId }: Extract<Action, { type: 'mergeStacks' }>): TableState {
  if (sourceId === targetId) throw new TableActionError('Cannot stack a pile onto itself.');
  const source = requireStack(state, sourceId);
  const target = requireStack(state, targetId);
  const stacks: Record<string, StackState> = { ...state.stacks };
  delete stacks[sourceId];
  stacks[targetId] = { ...target, cardIds: [...target.cardIds, ...source.cardIds] };
  return { cards: state.cards, stacks };
}

function requireStack(state: TableState, stackId: string): StackState {
  const stack = state.stacks[stackId];
  if (!stack) throw new TableActionError(`There is no stack ${stackId}.`);
  return stack;
}

function withStack(state: TableState, stack: StackState): TableState {
  return { cards: state.cards, stacks: { ...state.stacks, [stack.id]: stack } };
}

export function normalizeTurn(turn: number): number {
  return ((Math.round(turn) % 4) + 4) % 4;
}

/** The stack that holds a card, if the card is on the table. */
export function stackOfCard(state: TableState, cardId: string): StackState | undefined {
  for (const stack of Object.values(state.stacks)) {
    if (stack.cardIds.includes(cardId)) return stack;
  }
  return undefined;
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
