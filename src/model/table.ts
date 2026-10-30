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

/** The cards a player holds, left to right. They are off the table, and only their owner sees them. */
export interface HandState {
  id: string;
  cardIds: string[];
}

export interface TableState {
  cards: Readonly<Record<string, CardState>>;
  /**
   * Stacks in the order they were put down: a stack lies on top of any earlier
   * stack it overlaps. Creating or moving a stack puts it last.
   */
  stacks: Readonly<Record<string, StackState>>;
  hands: Readonly<Record<string, HandState>>;
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
   * their order. The source stack must keep at least one card. The new stack
   * takes the source's turn unless `turn` is given.
   */
  | { type: 'splitStack'; stackId: string; count: number; newStackId: string; x: number; z: number; turn?: number }
  /** Puts every card of `sourceId` on top of `targetId`, in the same order. The source stack goes away. */
  | { type: 'mergeStacks'; sourceId: string; targetId: string }
  /** Moves the top `count` cards of one stack onto another, one at a time, like dealing onto a pile. */
  | { type: 'transferTop'; fromStackId: string; toStackId: string; count: number }
  /** Turns a stack upside down, like flipping a real pile: the order reverses and every card turns over. */
  | { type: 'flipStack'; stackId: string }
  /** Turns a stack by quarter turns: 1 is clockwise seen from above, -1 is counter-clockwise. */
  | { type: 'turnStack'; stackId: string; by: number }
  /**
   * Puts a stack's cards in a new order, bottom first. The order is chosen by
   * whoever shuffles and sent with the action, so every player sees the same deck.
   */
  | { type: 'shuffleStack'; stackId: string; order: string[] }
  /**
   * Lays a stack out as single cards. The bottom card keeps the stack's id and
   * goes to `positions[0]`; each card above it gets the next new id and position.
   */
  | { type: 'spreadStack'; stackId: string; newStackIds: string[]; positions: { x: number; z: number }[] }
  /** Piles several stacks onto `targetId`, in the order given. The other stacks go away. */
  | { type: 'gatherStacks'; targetId: string; sourceIds: string[] }
  | { type: 'createHand'; handId: string }
  /** Takes the top `count` cards of a stack into a hand, top card first, at the right end. */
  | { type: 'drawToHand'; stackId: string; handId: string; count: number }
  /** Takes every card of a stack into a hand at `index`, top card first. The stack goes away. */
  | { type: 'stackToHand'; stackId: string; handId: string; index: number }
  /** Puts a card from a hand onto the table as a new stack. */
  | {
      type: 'playToTable';
      handId: string;
      cardId: string;
      faceUp: boolean;
      newStackId: string;
      x: number;
      z: number;
      turn: number;
    }
  /** Puts a card from a hand on top of a stack. */
  | { type: 'playOntoStack'; handId: string; cardId: string; faceUp: boolean; stackId: string }
  /** Moves a card to a new place in its hand, counted after it is taken out. */
  | { type: 'reorderHand'; handId: string; cardId: string; index: number };

export type ActionType = Action['type'];

export const emptyTable: TableState = { cards: {}, stacks: {}, hands: {} };

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
      return putDown(state, { ...stack, x: action.x, z: action.z });
    }
    case 'splitStack':
      return splitStack(state, action);
    case 'mergeStacks':
      return mergeStacks(state, action);
    case 'transferTop':
      return transferTop(state, action);
    case 'flipStack': {
      const stack = requireStack(state, action.stackId);
      const cards: Record<string, CardState> = { ...state.cards };
      for (const cardId of stack.cardIds) {
        const card = cards[cardId];
        if (card) cards[cardId] = { ...card, faceUp: !card.faceUp };
      }
      return {
        ...state,
        cards,
        stacks: { ...state.stacks, [stack.id]: { ...stack, cardIds: [...stack.cardIds].reverse() } },
      };
    }
    case 'turnStack': {
      const stack = requireStack(state, action.stackId);
      return withStack(state, { ...stack, turn: normalizeTurn(stack.turn + action.by) });
    }
    case 'shuffleStack': {
      const stack = requireStack(state, action.stackId);
      if (!isPermutation(action.order, stack.cardIds)) {
        throw new TableActionError(`A shuffle of stack ${stack.id} must list each of its cards exactly once.`);
      }
      return withStack(state, { ...stack, cardIds: [...action.order] });
    }
    case 'spreadStack':
      return spreadStack(state, action);
    case 'gatherStacks':
      return gatherStacks(state, action);
    case 'createHand': {
      if (state.hands[action.handId]) throw new TableActionError(`Hand ${action.handId} already exists.`);
      return { ...state, hands: { ...state.hands, [action.handId]: { id: action.handId, cardIds: [] } } };
    }
    case 'drawToHand':
      return drawToHand(state, action);
    case 'stackToHand': {
      const stack = requireStack(state, action.stackId);
      const hand = requireHand(state, action.handId);
      const cardIds = [...hand.cardIds];
      cardIds.splice(clampIndex(action.index, cardIds.length), 0, ...[...stack.cardIds].reverse());
      return { ...withoutStack(state, stack.id), hands: { ...state.hands, [hand.id]: { ...hand, cardIds } } };
    }
    case 'playToTable': {
      if (state.stacks[action.newStackId]) throw new TableActionError(`Stack ${action.newStackId} already exists.`);
      const next = takeFromHand(state, action.handId, action.cardId, action.faceUp);
      const stack: StackState = {
        id: action.newStackId,
        x: action.x,
        z: action.z,
        turn: normalizeTurn(action.turn),
        cardIds: [action.cardId],
      };
      return putDown(next, stack);
    }
    case 'playOntoStack': {
      const stack = requireStack(state, action.stackId);
      const next = takeFromHand(state, action.handId, action.cardId, action.faceUp);
      return withStack(next, { ...stack, cardIds: [...stack.cardIds, action.cardId] });
    }
    case 'reorderHand': {
      const hand = requireHand(state, action.handId);
      const from = hand.cardIds.indexOf(action.cardId);
      if (from < 0) throw new TableActionError(`Card ${action.cardId} is not in hand ${hand.id}.`);
      const cardIds = hand.cardIds.filter((id) => id !== action.cardId);
      cardIds.splice(clampIndex(action.index, cardIds.length), 0, action.cardId);
      return { ...state, hands: { ...state.hands, [hand.id]: { ...hand, cardIds } } };
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
  return putDown(
    { ...state, cards: newCards },
    { ...stack, turn: normalizeTurn(stack.turn), cardIds: [...stack.cardIds] },
  );
}

function splitStack(state: TableState, action: Extract<Action, { type: 'splitStack' }>): TableState {
  const stack = requireStack(state, action.stackId);
  if (state.stacks[action.newStackId]) throw new TableActionError(`Stack ${action.newStackId} already exists.`);
  requireCount(stack, action.count, stack.cardIds.length - 1);
  const keep = stack.cardIds.slice(0, stack.cardIds.length - action.count);
  const lifted = stack.cardIds.slice(stack.cardIds.length - action.count);
  const next = withStack(state, { ...stack, cardIds: keep });
  return putDown(next, {
    id: action.newStackId,
    x: action.x,
    z: action.z,
    turn: normalizeTurn(action.turn ?? stack.turn),
    cardIds: lifted,
  });
}

function mergeStacks(state: TableState, { sourceId, targetId }: Extract<Action, { type: 'mergeStacks' }>): TableState {
  if (sourceId === targetId) throw new TableActionError('Cannot stack a pile onto itself.');
  const source = requireStack(state, sourceId);
  const target = requireStack(state, targetId);
  return withStack(withoutStack(state, sourceId), { ...target, cardIds: [...target.cardIds, ...source.cardIds] });
}

function transferTop(state: TableState, action: Extract<Action, { type: 'transferTop' }>): TableState {
  if (action.fromStackId === action.toStackId) throw new TableActionError('Cannot deal a pile onto itself.');
  const from = requireStack(state, action.fromStackId);
  const to = requireStack(state, action.toStackId);
  requireCount(from, action.count, from.cardIds.length);
  // Dealing one card at a time reverses their order on the receiving pile.
  const moving = from.cardIds.slice(from.cardIds.length - action.count).reverse();
  const remaining = from.cardIds.slice(0, from.cardIds.length - action.count);
  const next = remaining.length ? withStack(state, { ...from, cardIds: remaining }) : withoutStack(state, from.id);
  return withStack(next, { ...to, cardIds: [...to.cardIds, ...moving] });
}

function spreadStack(state: TableState, action: Extract<Action, { type: 'spreadStack' }>): TableState {
  const stack = requireStack(state, action.stackId);
  const n = stack.cardIds.length;
  if (action.positions.length !== n || action.newStackIds.length !== n - 1) {
    throw new TableActionError(`Spreading stack ${stack.id} needs ${n} positions and ${n - 1} new stack ids.`);
  }
  const ids = [stack.id, ...action.newStackIds];
  if (new Set(ids).size !== ids.length) throw new TableActionError('Spread stack ids must all differ.');
  for (const id of action.newStackIds) {
    if (state.stacks[id]) throw new TableActionError(`Stack ${id} already exists.`);
  }
  let next = withoutStack(state, stack.id);
  stack.cardIds.forEach((cardId, i) => {
    const position = action.positions[i] as { x: number; z: number };
    next = putDown(next, { id: ids[i] as string, x: position.x, z: position.z, turn: stack.turn, cardIds: [cardId] });
  });
  return next;
}

function gatherStacks(
  state: TableState,
  { targetId, sourceIds }: Extract<Action, { type: 'gatherStacks' }>,
): TableState {
  const target = requireStack(state, targetId);
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.includes(targetId)) {
    throw new TableActionError('Gather needs different stacks, without the target among them.');
  }
  const cardIds = [...target.cardIds];
  let next = state;
  for (const sourceId of sourceIds) {
    cardIds.push(...requireStack(state, sourceId).cardIds);
    next = withoutStack(next, sourceId);
  }
  return withStack(next, { ...target, cardIds });
}

function drawToHand(state: TableState, action: Extract<Action, { type: 'drawToHand' }>): TableState {
  const stack = requireStack(state, action.stackId);
  const hand = requireHand(state, action.handId);
  requireCount(stack, action.count, stack.cardIds.length);
  const drawn = stack.cardIds.slice(stack.cardIds.length - action.count).reverse();
  const remaining = stack.cardIds.slice(0, stack.cardIds.length - action.count);
  const next = remaining.length ? withStack(state, { ...stack, cardIds: remaining }) : withoutStack(state, stack.id);
  return { ...next, hands: { ...state.hands, [hand.id]: { ...hand, cardIds: [...hand.cardIds, ...drawn] } } };
}

/** Takes a card out of a hand and sets which way up it will lie. */
function takeFromHand(state: TableState, handId: string, cardId: string, faceUp: boolean): TableState {
  const hand = requireHand(state, handId);
  const card = state.cards[cardId];
  if (!card || !hand.cardIds.includes(cardId)) throw new TableActionError(`Card ${cardId} is not in hand ${handId}.`);
  return {
    ...state,
    cards: { ...state.cards, [cardId]: { ...card, faceUp } },
    hands: { ...state.hands, [handId]: { ...hand, cardIds: hand.cardIds.filter((id) => id !== cardId) } },
  };
}

function requireStack(state: TableState, stackId: string): StackState {
  const stack = state.stacks[stackId];
  if (!stack) throw new TableActionError(`There is no stack ${stackId}.`);
  return stack;
}

function requireHand(state: TableState, handId: string): HandState {
  const hand = state.hands[handId];
  if (!hand) throw new TableActionError(`There is no hand ${handId}.`);
  return hand;
}

function requireCount(stack: StackState, count: number, max: number): void {
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new TableActionError(`Can only take 1 to ${max} cards from stack ${stack.id}, not ${count}.`);
  }
}

/** Replaces a stack where it is in the placement order. */
function withStack(state: TableState, stack: StackState): TableState {
  return { ...state, stacks: { ...state.stacks, [stack.id]: stack } };
}

/** Puts a stack down last in the placement order, so it lies on top of whatever it overlaps. */
function putDown(state: TableState, stack: StackState): TableState {
  const stacks: Record<string, StackState> = { ...state.stacks };
  delete stacks[stack.id];
  stacks[stack.id] = stack;
  return { ...state, stacks };
}

function withoutStack(state: TableState, stackId: string): TableState {
  const stacks: Record<string, StackState> = { ...state.stacks };
  delete stacks[stackId];
  return { ...state, stacks };
}

function isPermutation(order: readonly string[], cardIds: readonly string[]): boolean {
  if (order.length !== cardIds.length) return false;
  const wanted = new Set(cardIds);
  return new Set(order).size === order.length && order.every((id) => wanted.has(id));
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length, Math.round(index)));
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
