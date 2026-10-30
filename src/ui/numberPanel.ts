/** The smallest and largest value a number can take, and where it starts. */
export interface NumberLimit {
  min: number;
  max: number;
  value: number;
}

/**
 * A small pop-up panel of − / + number pickers with one confirm button, such
 * as "Players 4, Cards each 4, Deal". The numbers are remembered in this
 * browser, so the panel opens with the last values used.
 *
 * Markup: buttons with `data-step="name-"` and `data-step="name+"`, an element
 * with `data-value="name"` that shows the number, and a `data-confirm` button.
 */
export class NumberPanel<K extends string> {
  private readonly values: Record<K, number>;
  private opened = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly storageKey: string,
    private readonly limits: Record<K, NumberLimit>,
    private readonly onConfirm: (values: Readonly<Record<K, number>>) => void,
    private readonly onToggle: (open: boolean) => void = () => {},
  ) {
    this.values = Object.fromEntries((Object.keys(limits) as K[]).map((name) => [name, limits[name].value])) as Record<
      K,
      number
    >;
    this.load();
    root.addEventListener('click', (event) => this.onClick(event));
    this.close();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get current(): Readonly<Record<K, number>> {
    return this.values;
  }

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  toggle(): void {
    this.setOpen(!this.opened);
  }

  private setOpen(open: boolean): void {
    const changed = open !== this.opened;
    this.opened = open;
    this.root.hidden = !open;
    if (open) this.show();
    if (changed) this.onToggle(open);
  }

  private onClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const step = button.dataset.step;
    if (step) {
      const name = step.slice(0, -1) as K;
      const limit = this.limits[name];
      if (!limit) return;
      const by = step.endsWith('+') ? 1 : -1;
      this.values[name] = Math.min(limit.max, Math.max(limit.min, this.values[name] + by));
      this.save();
      this.show();
    } else if (button.dataset.confirm !== undefined) {
      this.close();
      this.onConfirm({ ...this.values });
    }
  }

  private show(): void {
    for (const name of Object.keys(this.limits) as K[]) {
      const output = this.root.querySelector(`[data-value="${name}"]`);
      if (output) output.textContent = String(this.values[name]);
      const limit = this.limits[name];
      this.root
        .querySelector<HTMLButtonElement>(`[data-step="${name}-"]`)
        ?.toggleAttribute('disabled', this.values[name] <= limit.min);
      this.root
        .querySelector<HTMLButtonElement>(`[data-step="${name}+"]`)
        ?.toggleAttribute('disabled', this.values[name] >= limit.max);
    }
  }

  /** Browser storage may be missing or blocked, which only means the defaults come back. */
  private load(): void {
    try {
      const saved = JSON.parse(window.localStorage.getItem(this.storageKey) ?? 'null') as unknown;
      if (!saved || typeof saved !== 'object') return;
      for (const name of Object.keys(this.limits) as K[]) {
        const value = (saved as Record<string, unknown>)[name];
        const limit = this.limits[name];
        if (typeof value === 'number' && Number.isFinite(value)) {
          this.values[name] = Math.min(limit.max, Math.max(limit.min, Math.round(value)));
        }
      }
    } catch {
      // Keep the defaults.
    }
  }

  private save(): void {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.values));
    } catch {
      // Not saved; the defaults come back next time.
    }
  }
}
