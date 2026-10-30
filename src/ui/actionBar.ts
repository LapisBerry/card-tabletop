import type { TableCommands } from '../model/commands';
import { MAX_SEATS } from '../model/layout';
import { MAX_DEAL, MIN_PLAYERS } from '../model/setup';
import type { Table } from '../model/table';
import type { CardInteraction } from '../view/interaction';
import { NumberPanel } from './numberPanel';

/**
 * The buttons for the selection, shown above the hand.
 *
 * One stack: flip, turn, draw, and for piles shuffle, deal and spread; gather
 * when other cards touch it. Several stacks: flip and turn each, take the top
 * card of each, shuffle them together, or gather them into one pile.
 * Deal opens a small panel to pick the number of players and cards each.
 */
export class ActionBar {
  private readonly deal: NumberPanel<'players' | 'perSeat'>;

  constructor(
    private readonly root: HTMLElement,
    dealPanel: HTMLElement,
    private readonly table: Table,
    private readonly interaction: CardInteraction,
    private readonly commands: TableCommands,
  ) {
    this.deal = new NumberPanel(
      dealPanel,
      'card-tabletop:deal',
      {
        players: { min: MIN_PLAYERS, max: MAX_SEATS, value: 4 },
        perSeat: { min: 1, max: MAX_DEAL, value: 4 },
      },
      ({ players, perSeat }) => {
        const pile = this.pile();
        if (pile) this.commands.deal(pile, players, perSeat);
      },
      (open) => this.button('deal')?.setAttribute('aria-expanded', String(open)),
    );
    root.addEventListener('click', (event) => this.onClick(event));
    window.addEventListener('keydown', (event) => this.onKey(event));
    interaction.subscribe(() => this.refresh());
    table.subscribe(() => this.refresh());
    this.refresh();
  }

  refresh(): void {
    const state = this.table.state;
    const stacks = this.interaction.selection.flatMap((id) => state.stacks[id] ?? []);
    this.root.hidden = stacks.length === 0;
    if (stacks.length === 0) {
      this.deal.close();
      return;
    }
    const many = stacks.length > 1;
    const cards = stacks.reduce((sum, stack) => sum + stack.cardIds.length, 0);
    const count = this.root.querySelector<HTMLElement>('.count');
    if (count) {
      count.textContent =
        many && cards > stacks.length ? `${stacks.length} piles, ${cards} cards` : plural(cards, 'card', 'cards');
    }
    const draw = this.button('draw');
    if (draw) {
      draw.textContent = many || cards === 1 ? 'Take' : 'Draw';
      draw.title = many ? 'Take the top card of each into your hand (D)' : 'Into your hand (D)';
    }
    const shuffle = this.button('shuffle');
    if (shuffle) {
      shuffle.hidden = cards < 2;
      shuffle.title = many ? 'Pile them up and shuffle (S)' : 'Shuffle (S)';
    }
    const pile = this.pile();
    for (const action of ['deal', 'spread']) {
      const button = this.button(action);
      if (button) button.hidden = !pile;
    }
    const gather = this.button('gather');
    if (gather) {
      gather.hidden = !this.commands.canGather(this.interaction.selection);
      gather.title = many ? 'Pile them up into one (G)' : 'Pile up the cards touching this one (G)';
    }
    if (!pile) this.deal.close();
  }

  /** The one selected stack, when it has two or more cards to deal or spread. */
  private pile(): string | null {
    const selection = this.interaction.selection;
    const only = selection.length === 1 ? selection[0] : undefined;
    const stack = only ? this.table.state.stacks[only] : undefined;
    return stack && stack.cardIds.length > 1 ? stack.id : null;
  }

  private onClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const targets = this.interaction.selection;
    if (!button || targets.length === 0) return;
    switch (button.dataset.action) {
      case 'flip':
        this.commands.flip(targets);
        break;
      case 'turn-left':
        this.commands.turn(targets, -1);
        break;
      case 'turn-right':
        this.commands.turn(targets, 1);
        break;
      case 'draw':
        this.commands.draw(targets, 1);
        break;
      case 'shuffle':
        this.commands.shuffle(targets);
        break;
      case 'spread': {
        const pile = this.pile();
        if (pile) this.commands.spread(pile);
        break;
      }
      case 'gather':
        this.commands.gather(targets);
        break;
      case 'deal':
        this.deal.toggle();
        break;
    }
  }

  /** Shift + D opens the deal options for the selected pile; Esc closes them. */
  private onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && this.deal.isOpen) {
      this.deal.close();
    } else if (event.shiftKey && event.key.toLowerCase() === 'd' && this.pile()) {
      this.deal.toggle();
      event.preventDefault();
    }
  }

  private button(action: string): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
