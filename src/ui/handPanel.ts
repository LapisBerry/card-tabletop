import type { CardFace } from '../model/cardSet';
import type { Table } from '../model/table';
import { drawCardFront } from '../view/cardArt';
import type { HandDock } from '../view/interaction';

/** How far (in screen pixels) a press must travel before it counts as a drag. */
const DRAG_THRESHOLD = 6;
/** Dragging a card this far above the hand takes it out onto the table. */
const LEAVE_MARGIN = 12;
/** Card pictures in the hand are drawn at this width, enough for sharp text on high-density screens. */
const ART_WIDTH = 256;

export interface HandPanelEvents {
  /** A card was dragged out of the hand onto the table; the table should carry it from here. */
  onCarryOut(cardId: string, event: PointerEvent): void;
  /** The card to show enlarged changed (hovered with a mouse, or tapped). */
  onFocus(faceId: string | null): void;
}

interface CardElement {
  el: HTMLButtonElement;
  faceId: string;
}

interface Press {
  cardId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

/**
 * The player's hand: a fan of cards along the bottom of the screen, drawn as
 * plain HTML so text stays crisp and touch works well.
 *
 * Drag a card sideways to reorder, or up onto the table to play it. Cards
 * carried over the hand from the table drop into it, at the gap that opens.
 */
export class HandPanel implements HandDock {
  private readonly elements = new Map<string, CardElement>();
  private order: string[] = [];
  private press: Press | null = null;
  private dropIndex: number | null = null;
  private focusedId: string | null = null;
  private pinnedId: string | null = null;
  /** Where the pointer is while a hand card is dragged, to open a gap there. */
  private lastPointerX: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly cardsRoot: HTMLElement,
    private readonly table: Table,
    private readonly handId: string,
    private readonly faces: ReadonlyMap<string, CardFace>,
    private readonly events: HandPanelEvents,
  ) {
    table.subscribe(() => this.render());
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e, false));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e, true));
    this.render();
  }

  // --- HandDock -------------------------------------------------------------

  hit(clientX: number, clientY: number): boolean {
    const rect = this.root.getBoundingClientRect();
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top - LEAVE_MARGIN && clientY <= rect.bottom
    );
  }

  indexAt(clientX: number): number {
    return this.slotAt(clientX, this.press?.dragging ? this.press.cardId : null);
  }

  /** How many cards (other than `skip`) lie left of a screen x. */
  private slotAt(clientX: number, skip: string | null): number {
    let index = 0;
    for (const cardId of this.order) {
      if (cardId === skip) continue;
      const rect = this.elements.get(cardId)?.el.getBoundingClientRect();
      if (rect && clientX > rect.left + rect.width / 2) index++;
    }
    return index;
  }

  showDrop(index: number | null): void {
    if (index === this.dropIndex) return;
    this.dropIndex = index;
    this.root.classList.toggle('drop', index !== null);
    this.layout();
  }

  // --- rendering -------------------------------------------------------------

  private render(): void {
    const hand = this.table.state.hands[this.handId];
    const cardIds = hand?.cardIds ?? [];
    const state = this.table.state;
    for (const [cardId, item] of this.elements) {
      if (cardIds.includes(cardId)) continue;
      item.el.remove();
      this.elements.delete(cardId);
      if (this.pinnedId === cardId) this.pinnedId = null;
      if (this.focusedId === cardId) this.setFocus(null);
    }
    for (const cardId of cardIds) {
      if (this.elements.has(cardId)) continue;
      const faceId = state.cards[cardId]?.faceId;
      const face = faceId ? this.faces.get(faceId) : undefined;
      if (!faceId || !face) continue;
      const el = this.createCard(cardId, face);
      this.elements.set(cardId, { el, faceId });
      this.cardsRoot.append(el);
      // Start just below the hand, so a drawn card slides up into place.
      el.style.transform = `translate(${this.cardsRoot.clientWidth / 2}px, 80px)`;
      el.style.opacity = '0';
    }
    this.order = [...cardIds];
    this.root.classList.toggle('empty', cardIds.length === 0);
    this.root.setAttribute('aria-label', `Your hand, ${cardIds.length} ${cardIds.length === 1 ? 'card' : 'cards'}`);
    // Let new cards take their starting spot before they move, so the slide-in plays.
    requestAnimationFrame(() => this.layout());
  }

  private createCard(cardId: string, face: CardFace): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'hand-card';
    el.dataset.cardId = cardId;
    el.setAttribute('aria-label', `${face.name}${face.rank ? `, ${face.rank} of ${face.suit}` : ''}. ${face.text}`);
    el.append(this.artFor(face));
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e, cardId));
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && !this.press) this.setFocus(cardId);
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.press && this.focusedId === cardId) this.setFocus(this.pinnedId);
    });
    el.addEventListener('focus', () => this.setFocus(cardId));
    el.addEventListener('blur', () => this.setFocus(this.pinnedId));
    return el;
  }

  /** A small copy of the card picture, made once when the card enters the hand. */
  private artFor(face: CardFace): HTMLCanvasElement {
    const full = drawCardFront(face);
    const canvas = document.createElement('canvas');
    canvas.width = ART_WIDTH;
    canvas.height = Math.round((ART_WIDTH * full.height) / full.width);
    canvas.getContext('2d')?.drawImage(full, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** Places every card along a gentle arc, overlapping more as the hand fills up. */
  private layout(): void {
    const width = this.cardsRoot.clientWidth;
    const sample = this.elements.values().next().value?.el;
    const cardWidth = sample?.offsetWidth ?? 96;
    const dragging = this.press?.dragging ? this.press.cardId : null;
    const laidOut = this.order.filter((id) => id !== dragging);
    const slots = laidOut.length + (this.dropIndex !== null || dragging ? 1 : 0);
    const step = slots > 1 ? Math.min(cardWidth * 0.92, (width - cardWidth) / (slots - 1)) : 0;
    const total = cardWidth + step * Math.max(0, slots - 1);
    const left = (width - total) / 2;
    const middle = (slots - 1) / 2;
    const gapAt = this.dropIndex ?? (dragging ? this.dragTargetIndex() : null);
    laidOut.forEach((cardId, i) => {
      const item = this.elements.get(cardId);
      if (!item) return;
      const slot = gapAt !== null && i >= gapAt ? i + 1 : i;
      const offset = slot - middle;
      const angle = offset * Math.min(4, 24 / Math.max(slots, 1));
      const drop = Math.abs(offset) ** 2 * Math.min(1.6, 10 / Math.max(slots, 1));
      const raised = this.focusedId === cardId ? -22 : 0;
      item.el.style.transform = `translate(${left + slot * step}px, ${drop + raised}px) rotate(${angle}deg)`;
      item.el.style.zIndex = String(this.focusedId === cardId ? 100 : slot + 1);
      item.el.style.opacity = '1';
      item.el.classList.toggle('focused', this.focusedId === cardId);
    });
  }

  private dragTargetIndex(): number | null {
    const press = this.press;
    if (!press?.dragging || this.lastPointerX === null) return null;
    return this.slotAt(this.lastPointerX, press.cardId);
  }

  // --- pointer handling ------------------------------------------------------

  private onPointerDown(e: PointerEvent, cardId: string): void {
    if (this.press || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const el = this.elements.get(cardId)?.el;
    el?.setPointerCapture(e.pointerId);
    this.press = { cardId, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
  }

  private onPointerMove(e: PointerEvent): void {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!press.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      press.dragging = true;
      this.setFocus(null);
    }
    this.lastPointerX = e.clientX;
    const rect = this.root.getBoundingClientRect();
    if (e.clientY < rect.top - LEAVE_MARGIN) {
      // Up and out of the hand: the card becomes a real card on the table, still under the pointer.
      const el = this.elements.get(press.cardId)?.el;
      el?.releasePointerCapture(e.pointerId);
      el?.classList.remove('dragging');
      this.press = null;
      this.lastPointerX = null;
      this.events.onCarryOut(press.cardId, e);
      this.layout();
      return;
    }
    const item = this.elements.get(press.cardId);
    if (item) {
      // Follow the pointer, keeping the grabbed point under it.
      const base = this.cardsRoot.getBoundingClientRect();
      const x = e.clientX - base.left - item.el.offsetWidth / 2;
      const y = e.clientY - base.top - item.el.offsetHeight / 2;
      item.el.classList.add('dragging');
      item.el.style.transform = `translate(${x}px, ${y}px) rotate(0deg) scale(1.08)`;
      item.el.style.zIndex = '200';
    }
    this.layout();
  }

  private onPointerUp(e: PointerEvent, cancelled: boolean): void {
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    this.press = null;
    const el = this.elements.get(press.cardId)?.el;
    el?.classList.remove('dragging');
    if (press.dragging && !cancelled) {
      const index = this.slotAt(e.clientX, press.cardId);
      this.table.dispatch({ type: 'reorderHand', handId: this.handId, cardId: press.cardId, index });
    } else if (!press.dragging && !cancelled) {
      // A tap pins the card as the one shown large, or unpins it.
      this.pinnedId = this.pinnedId === press.cardId ? null : press.cardId;
      this.setFocus(this.pinnedId);
    }
    this.lastPointerX = null;
    this.layout();
  }

  private setFocus(cardId: string | null): void {
    if (cardId === this.focusedId) return;
    this.focusedId = cardId;
    this.events.onFocus(cardId ? (this.elements.get(cardId)?.faceId ?? null) : null);
    this.layout();
  }
}
