import type { CardFace } from './cardSet';
import { MAX_SEATS, seats } from './layout';
import { planDeal, planGather, planPile, planShuffle, planShuffleTogether, planSpread, touchingGroup } from './plans';
import type { Random } from './random';
import { newGame, type GameOptions } from './setup';
import { TableActionError, buildTable, type Action, type IdGenerator, type Table } from './table';

/** Pause between dealt cards, so the deal reads as cards going round the table. */
const DEAL_STEP_MS = 70;

/** One stack, or several selected together. */
export type Targets = string | readonly string[];

/**
 * The table commands behind the buttons and keys: flip, turn, shuffle, draw,
 * deal, spread, gather, undo and redo, and a new game. Each one turns into
 * plain actions on the table and counts as one step for Undo.
 *
 * Commands that take `Targets` work on one stack or on a whole selection.
 */
export class TableCommands {
  private dealing: number | undefined;

  constructor(
    private readonly table: Table,
    private readonly ids: IdGenerator,
    /** The hand that "draw" fills: the person at this screen. */
    readonly handId: string,
    private readonly random: Random = Math.random,
  ) {}

  /** Turns each stack over in place. */
  flip(targets: Targets): void {
    this.run(this.existing(targets).map((stackId): Action => ({ type: 'flipStack', stackId })));
  }

  /** Turns each stack by quarter turns: 1 is clockwise, -1 counter-clockwise. */
  turn(targets: Targets, by: number): void {
    this.run(this.existing(targets).map((stackId): Action => ({ type: 'turnStack', stackId, by })));
  }

  /** Shuffles one stack, or piles several together and shuffles the pile. */
  shuffle(targets: Targets): void {
    const stackIds = this.existing(targets);
    if (stackIds.length > 1) {
      this.run(planShuffleTogether(this.table.state, stackIds, this.random));
    } else if (stackIds[0]) {
      const action = planShuffle(this.table.state, stackIds[0], this.random);
      if (action) this.run([action]);
    }
  }

  /** Takes up to `count` cards off the top of each stack into the hand. */
  draw(targets: Targets, count = 1): void {
    const state = this.table.state;
    const actions: Action[] = [];
    for (const stackId of this.existing(targets)) {
      const n = Math.min(count, state.stacks[stackId]?.cardIds.length ?? 0);
      if (n > 0) actions.push({ type: 'drawToHand', stackId, handId: this.handId, count: n });
    }
    this.run(actions);
  }

  /** Lays one stack out in a row. */
  spread(stackId: string): void {
    const action = planSpread(this.table.state, stackId, this.ids);
    if (action) this.run([action]);
  }

  /**
   * One stack: piles up every card touching it, where it lies.
   * Several: piles them all together where the lowest of them lies.
   */
  gather(targets: Targets): void {
    const stackIds = this.existing(targets);
    if (stackIds.length > 1) {
      const action = planPile(this.table.state, stackIds);
      if (action) this.run([action]);
    } else if (stackIds[0]) {
      this.run(planGather(this.table.state, stackIds[0]));
    }
  }

  /** Whether Gather would do anything: several stacks, or one with something touching it. */
  canGather(targets: Targets): boolean {
    const stackIds = this.existing(targets);
    if (stackIds.length > 1) return true;
    return stackIds[0] ? touchingGroup(this.table.state, stackIds[0]).length > 1 : false;
  }

  /**
   * Deals `perSeat` cards from a stack to `players` seats round the table:
   * this screen's hand is seat 0, and other seats get face-down piles at their
   * places. Cards go out one by one with a short pause; a second deal, an
   * undo, or a move that makes the next card impossible stops the one in progress.
   */
  deal(stackId: string, players: number, perSeat: number): void {
    this.stopDealing();
    const seatList = seats(Math.min(MAX_SEATS, Math.max(2, players)));
    const queue: Action[] = planDeal(this.table.state, stackId, seatList, perSeat, this.handId, this.ids);
    if (queue.length === 0) return;
    this.table.checkpoint();
    const step = () => {
      const action = queue.shift();
      if (!action) {
        this.dealing = undefined;
        return;
      }
      try {
        this.table.dispatch(action);
        // A pile's first card and its turn arrive together, so do not pause between them.
        if (queue[0]?.type === 'turnStack') this.table.dispatch(queue.shift() as Action);
      } catch (error) {
        if (!(error instanceof TableActionError)) throw error;
        this.dealing = undefined;
        return;
      }
      this.dealing = window.setTimeout(step, DEAL_STEP_MS);
    };
    step();
  }

  stopDealing(): void {
    window.clearTimeout(this.dealing);
    this.dealing = undefined;
  }

  undo(): void {
    this.stopDealing();
    this.table.undo();
  }

  redo(): void {
    this.stopDealing();
    this.table.redo();
  }

  /** Clears the table and sets up a fresh game. Undo brings the old table back. */
  newGame(faces: readonly CardFace[], options: GameOptions): void {
    this.stopDealing();
    this.table.replace(buildTable(newGame(faces, options, this.random)));
  }

  /** Dispatches a list of actions as one undo step, stopping at the first that no longer fits the table. */
  private run(actions: readonly Action[]): void {
    if (actions.length === 0) return;
    this.table.checkpoint();
    for (const action of actions) {
      try {
        this.table.dispatch(action);
      } catch (error) {
        if (!(error instanceof TableActionError)) throw error;
        return;
      }
    }
  }

  /** The stacks among `targets` that are still on the table. */
  private existing(targets: Targets): string[] {
    const list = typeof targets === 'string' ? [targets] : targets;
    return list.filter((stackId) => Boolean(this.table.state.stacks[stackId]));
  }
}
