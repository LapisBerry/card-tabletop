import type { TableCommands } from '../model/commands';
import { MAX_SEATS } from '../model/layout';
import type { Table } from '../model/table';
import type { CardInteraction } from '../view/interaction';

const DEAL_SETTING = 'card-tabletop:deal';

/**
 * The buttons for the selected stack: flip and turn for any stack; draw,
 * shuffle, deal and spread for piles; gather when other cards touch it.
 * Deal opens a small panel to pick the number of players and cards each.
 */
export class ActionBar {
  private players = 4;
  private perSeat = 4;
  private dealOpen = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly dealPanel: HTMLElement,
    private readonly table: Table,
    private readonly interaction: CardInteraction,
    private readonly commands: TableCommands,
  ) {
    this.loadDealSetting();
    root.addEventListener('click', (event) => this.onClick(event));
    dealPanel.addEventListener('click', (event) => this.onDealClick(event));
    interaction.subscribe(() => this.refresh());
    table.subscribe(() => this.refresh());
    this.refresh();
  }

  refresh(): void {
    const stackId = this.interaction.selected;
    const stack = stackId ? this.table.state.stacks[stackId] : undefined;
    this.root.hidden = !stack;
    if (!stack || !stackId) {
      this.setDealOpen(false);
      return;
    }
    const n = stack.cardIds.length;
    const count = this.root.querySelector<HTMLElement>('.count');
    if (count) count.textContent = n === 1 ? '1 card' : `${n} cards`;
    const draw = this.button('draw');
    if (draw) draw.textContent = n === 1 ? 'Take' : 'Draw';
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button[data-needs="many"]')) {
      button.hidden = n < 2;
    }
    const gather = this.button('gather');
    if (gather) gather.hidden = !this.commands.canGather(stackId);
    if (n < 2) this.setDealOpen(false);
  }

  private onClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const stackId = this.interaction.selected;
    if (!button || !stackId) return;
    switch (button.dataset.action) {
      case 'flip':
        this.commands.flip(stackId);
        break;
      case 'turn-left':
        this.commands.turn(stackId, -1);
        break;
      case 'turn-right':
        this.commands.turn(stackId, 1);
        break;
      case 'draw':
        this.commands.draw(stackId, 1);
        break;
      case 'shuffle':
        this.commands.shuffle(stackId);
        break;
      case 'spread':
        this.commands.spread(stackId);
        break;
      case 'gather':
        this.commands.gather(stackId);
        break;
      case 'deal':
        this.setDealOpen(!this.dealOpen);
        break;
    }
  }

  private onDealClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const step = button.dataset.step;
    if (step === 'players-') this.players = Math.max(2, this.players - 1);
    if (step === 'players+') this.players = Math.min(MAX_SEATS, this.players + 1);
    if (step === 'cards-') this.perSeat = Math.max(1, this.perSeat - 1);
    if (step === 'cards+') this.perSeat = Math.min(20, this.perSeat + 1);
    if (button.dataset.deal !== undefined) {
      const stackId = this.interaction.selected;
      if (stackId) this.commands.deal(stackId, this.players, this.perSeat);
      this.setDealOpen(false);
    }
    this.saveDealSetting();
    this.showDealValues();
  }

  private setDealOpen(open: boolean): void {
    this.dealOpen = open;
    this.dealPanel.hidden = !open;
    this.button('deal')?.setAttribute('aria-expanded', String(open));
    if (open) this.showDealValues();
  }

  private showDealValues(): void {
    const players = this.dealPanel.querySelector('[data-value="players"]');
    const cards = this.dealPanel.querySelector('[data-value="cards"]');
    if (players) players.textContent = String(this.players);
    if (cards) cards.textContent = String(this.perSeat);
  }

  private button(action: string): HTMLButtonElement | null {
    return this.root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
  }

  /** Remembers the last deal size in this browser; storage may be blocked, which is fine. */
  private loadDealSetting(): void {
    try {
      const saved = JSON.parse(window.localStorage.getItem(DEAL_SETTING) ?? 'null') as unknown;
      if (saved && typeof saved === 'object') {
        const { players, perSeat } = saved as { players?: unknown; perSeat?: unknown };
        if (typeof players === 'number') this.players = Math.min(MAX_SEATS, Math.max(2, Math.round(players)));
        if (typeof perSeat === 'number') this.perSeat = Math.min(20, Math.max(1, Math.round(perSeat)));
      }
    } catch {
      // Keep the defaults.
    }
  }

  private saveDealSetting(): void {
    try {
      window.localStorage.setItem(DEAL_SETTING, JSON.stringify({ players: this.players, perSeat: this.perSeat }));
    } catch {
      // Not saved; the defaults come back next time.
    }
  }
}
