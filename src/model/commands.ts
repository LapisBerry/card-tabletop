import { MAX_SEATS, seats } from './layout';
import { planDeal, planGather, planShuffle, planSpread, touchingGroup } from './plans';
import type { Random } from './setup';
import { TableActionError, type Action, type IdGenerator, type Table } from './table';

/** Pause between dealt cards, so the deal reads as cards going round the table. */
const DEAL_STEP_MS = 70;

/**
 * The table commands behind the buttons and keys: flip, turn, shuffle, draw,
 * deal, spread and gather. Each one turns into plain actions on the table.
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

  flip(stackId: string): void {
    if (this.has(stackId)) this.table.dispatch({ type: 'flipStack', stackId });
  }

  turn(stackId: string, by: number): void {
    if (this.has(stackId)) this.table.dispatch({ type: 'turnStack', stackId, by });
  }

  shuffle(stackId: string): void {
    const action = planShuffle(this.table.state, stackId, this.random);
    if (action) this.table.dispatch(action);
  }

  /** Takes up to `count` cards off the top of a stack into the hand. */
  draw(stackId: string, count = 1): void {
    const stack = this.table.state.stacks[stackId];
    if (!stack) return;
    const n = Math.min(count, stack.cardIds.length);
    if (n > 0) this.table.dispatch({ type: 'drawToHand', stackId, handId: this.handId, count: n });
  }

  spread(stackId: string): void {
    const action = planSpread(this.table.state, stackId, this.ids);
    if (action) this.table.dispatch(action);
  }

  gather(stackId: string): void {
    for (const action of planGather(this.table.state, stackId)) this.table.dispatch(action);
  }

  /** Whether there is anything touching this stack to gather. */
  canGather(stackId: string): boolean {
    return touchingGroup(this.table.state, stackId).length > 1;
  }

  /**
   * Deals `perSeat` cards from a stack to `players` seats round the table:
   * this screen's hand is seat 0, and other seats get face-down piles at their
   * places. Cards go out one by one with a short pause; a second deal, or a
   * move that makes the next card impossible, stops the one in progress.
   */
  deal(stackId: string, players: number, perSeat: number): void {
    this.stopDealing();
    const seatList = seats(Math.min(MAX_SEATS, Math.max(2, players)));
    const queue: Action[] = planDeal(this.table.state, stackId, seatList, perSeat, this.handId, this.ids);
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

  private has(stackId: string): boolean {
    return Boolean(this.table.state.stacks[stackId]);
  }
}
