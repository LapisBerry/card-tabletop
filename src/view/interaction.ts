import * as THREE from 'three';
import type { TableCommands } from '../model/commands';
import { TABLE_DEPTH, TABLE_WIDTH } from '../model/dimensions';
import type { Zone } from '../model/layout';
import { halfSize } from '../model/plans';
import type { IdGenerator, Table } from '../model/table';
import type { CardLayer } from './cardLayer';
import type { HighlightKind, Highlights } from './highlights';

/** How far (in screen pixels) a press must travel before it counts as a drag rather than a click. */
const DRAG_THRESHOLD = { mouse: 5, touch: 10 } as const;
/**
 * On touch, holding a card this long without moving grabs the whole stack instead of the top card.
 * Mouse users have Shift for that, so a slow start with the mouse never grabs a whole deck by surprise.
 */
const LONG_PRESS_MS = 450;
/** Two clicks on the same stack within this time flip it. */
const DOUBLE_TAP_MS = 350;
/** Carried cards float this far above whatever is under them. */
const CARRY_HEIGHT = 1.2;
/** A dropped card joins a stack (or snaps to a marked spot) when its centre lands within this share of its half size. */
const SNAP_REACH = 0.75;

/** The player's hand on screen, as a place carried cards can be dropped. */
export interface HandDock {
  /** Whether a screen point is over the hand. */
  hit(clientX: number, clientY: number): boolean;
  /** Where in the hand a card dropped at this screen x would go. */
  indexAt(clientX: number): number;
  /** Shows that a drop would land in the hand, opening a gap at `index`; `null` clears it. */
  showDrop(index: number | null): void;
}

export interface InteractionListener {
  /** The stack under the mouse, the selected stack, or whether a drag is going on changed. */
  (): void;
}

interface Press {
  pointerId: number;
  pointerType: string;
  stackId: string;
  startX: number;
  startY: number;
  /** From the stack centre to the grabbed point, on the table plane. */
  grabOffset: THREE.Vector2;
  wholeStack: boolean;
  longPressTimer: number | undefined;
  drag: Drag | null;
}

type Origin =
  | { kind: 'split'; fromStackId: string }
  | { kind: 'whole' }
  | { kind: 'hand'; handId: string; index: number };

interface Drag {
  stackId: string;
  /** Where the carried cards came from, to put them back if the drag is cancelled. */
  origin: Origin;
  x: number;
  z: number;
  /** What a drop right now would do: land on a stack, snap to a marked spot, go into the hand, or lie where it is. */
  target:
    | { kind: 'stack'; stackId: string }
    | { kind: 'zone'; zone: Zone }
    | { kind: 'hand'; index: number }
    | { kind: 'table' };
}

/**
 * Turns mouse, touch and keyboard input into table actions.
 *
 * - Drag a card to pick up the top card of its stack and drop it anywhere.
 *   Shift + drag, or on touch a short hold before dragging, carries the whole stack.
 * - Dropping onto another stack puts the cards on top of it; near a marked
 *   spot they snap onto it; over the hand they go into the hand.
 * - Click or tap selects a stack; double-click or double-tap flips it.
 * - Keys work on the stack under the mouse, or else the selected one:
 *   F flip, Q / E turn, S shuffle, D draw one, 1-9 draw that many, Esc cancel.
 *
 * Presses that start on empty table, and the right and middle mouse buttons,
 * are left to the camera controls.
 */
export class CardInteraction {
  private press: Press | null = null;
  /** Pointers the camera controls own, such as a one-finger pan on empty table. */
  private readonly cameraPointers = new Set<number>();
  private emptyPress: { pointerId: number; x: number; y: number } | null = null;
  private lastTap: { stackId: string; time: number } | null = null;
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private hand: HandDock | null = null;
  private readonly listeners = new Set<InteractionListener>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly scratchPoint = new THREE.Vector3();
  private readonly abort = new AbortController();
  private readonly unsubscribeTable: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly table: Table,
    private readonly cards: CardLayer,
    private readonly highlights: Highlights,
    private readonly ids: IdGenerator,
    private readonly commands: TableCommands,
    private readonly zones: readonly Zone[],
  ) {
    const signal = this.abort.signal;
    // Capture phase on window, so a press on a card is claimed before the camera controls see it.
    window.addEventListener('pointerdown', (e) => this.onPointerDown(e), { capture: true, signal });
    window.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e, false), { signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e, true), { signal });
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { signal });
    window.addEventListener('blur', () => this.cancelPress(), { signal });
    canvas.addEventListener('pointerleave', () => this.setHovered(null), { signal });
    this.unsubscribeTable = table.subscribe((state) => {
      if (this.selectedId && !state.stacks[this.selectedId]) this.setSelected(null);
      if (this.hoveredId && !state.stacks[this.hoveredId]) this.setHovered(null);
      this.refreshHighlights();
      this.emit();
    });
  }

  /** Connects the on-screen hand, so cards can be dropped into it. */
  setHandDock(hand: HandDock): void {
    this.hand = hand;
  }

  get hovered(): string | null {
    return this.hoveredId;
  }

  get selected(): string | null {
    return this.selectedId;
  }

  get dragging(): boolean {
    return Boolean(this.press?.drag);
  }

  /** Calls `listener` when the hovered or selected stack, the drag state, or the table changes. */
  subscribe(listener: InteractionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The stack that keyboard keys work on. */
  get focusStackId(): string | null {
    return this.press?.drag?.stackId ?? this.hoveredId ?? this.selectedId;
  }

  select(stackId: string | null): void {
    this.setSelected(stackId && this.table.state.stacks[stackId] ? stackId : null);
  }

  /**
   * Takes over a card being dragged out of the hand: it goes onto the table,
   * face up, under the pointer, and is carried from there like any other card.
   */
  carryFromHand(handId: string, cardId: string, e: PointerEvent): void {
    if (this.press) return;
    const hand = this.table.state.hands[handId];
    const index = hand?.cardIds.indexOf(cardId) ?? -1;
    if (index < 0) return;
    const point = this.tablePoint(e);
    const [hw, hh] = halfSize(0);
    const x = THREE.MathUtils.clamp(point?.x ?? 0, -TABLE_WIDTH / 2 + hw, TABLE_WIDTH / 2 - hw);
    const z = THREE.MathUtils.clamp(point?.z ?? 0, -TABLE_DEPTH / 2 + hh, TABLE_DEPTH / 2 - hh);
    const stackId = this.ids.make('stack');
    this.table.dispatch({ type: 'playToTable', handId, cardId, faceUp: true, newStackId: stackId, x, z, turn: 0 });
    const press: Press = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      stackId,
      startX: e.clientX,
      startY: e.clientY,
      grabOffset: new THREE.Vector2(0, 0),
      wholeStack: true,
      longPressTimer: undefined,
      drag: { stackId, origin: { kind: 'hand', handId, index }, x, z, target: { kind: 'table' } },
    };
    this.press = press;
    this.setHovered(null);
    this.setSelected(stackId);
    this.moveDrag(press, e);
    this.emit();
  }

  dispose(): void {
    this.cancelPress();
    this.abort.abort();
    this.unsubscribeTable();
  }

  // --- pointer handling -------------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    if (e.target !== this.canvas) return;
    // A pointer that comes down again was lifted somewhere we did not hear about.
    this.cameraPointers.delete(e.pointerId);
    if (this.press) {
      // A second finger while carrying a card: keep it away from the camera too.
      e.stopPropagation();
      return;
    }
    const primary = e.pointerType === 'mouse' ? e.button === 0 : true;
    const hit = primary && this.cameraPointers.size === 0 ? this.pick(e) : null;
    if (!hit) {
      this.cameraPointers.add(e.pointerId);
      if (primary) this.emptyPress = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }

    e.stopPropagation();
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    // Keep getting this pointer's events even if it leaves the window mid-drag.
    this.canvas.setPointerCapture(e.pointerId);
    const stack = this.table.state.stacks[hit.stackId];
    const point = this.tablePoint(e);
    if (!stack || !point) return;
    const press: Press = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      stackId: hit.stackId,
      startX: e.clientX,
      startY: e.clientY,
      // Measured on the felt, like every carried position, so the cards do not jump when picked up.
      grabOffset: new THREE.Vector2(point.x - stack.x, point.z - stack.z),
      wholeStack: e.shiftKey || stack.cardIds.length === 1,
      longPressTimer: undefined,
      drag: null,
    };
    if (!press.wholeStack && e.pointerType !== 'mouse') {
      press.longPressTimer = window.setTimeout(() => this.onLongPress(press), LONG_PRESS_MS);
    }
    this.press = press;
  }

  private onLongPress(press: Press): void {
    if (this.press !== press || press.drag) return;
    press.wholeStack = true;
    const stack = this.table.state.stacks[press.stackId];
    if (!stack) return;
    // Raise the whole stack a little to show it is now held as one.
    this.cards.setLift({ stackId: stack.id, x: stack.x, z: stack.z, y: this.cards.baseY(stack.id) + 0.6 });
    navigator.vibrate?.(15);
  }

  private onPointerMove(e: PointerEvent): void {
    const press = this.press;
    if (press && e.pointerId === press.pointerId) {
      if (!press.drag) {
        const limit = press.pointerType === 'mouse' ? DRAG_THRESHOLD.mouse : DRAG_THRESHOLD.touch;
        if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < limit) return;
        this.startDrag(press, e.shiftKey);
      }
      this.moveDrag(press, e);
      return;
    }
    if (!press && e.pointerType === 'mouse' && this.cameraPointers.size === 0) {
      this.setHovered(e.target === this.canvas ? (this.pick(e)?.stackId ?? null) : null);
    }
  }

  private onPointerUp(e: PointerEvent, cancelled: boolean): void {
    this.cameraPointers.delete(e.pointerId);
    if (this.emptyPress?.pointerId === e.pointerId) {
      const moved = Math.hypot(e.clientX - this.emptyPress.x, e.clientY - this.emptyPress.y);
      this.emptyPress = null;
      if (!cancelled && moved < DRAG_THRESHOLD.touch) this.setSelected(null);
    }
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    window.clearTimeout(press.longPressTimer);
    this.press = null;
    if (press.drag) {
      this.endDrag(press.drag, cancelled);
    } else {
      this.cards.setLift(null);
      if (!cancelled) this.onTap(press.stackId);
    }
    this.emit();
  }

  private onTap(stackId: string): void {
    const now = performance.now();
    if (this.lastTap && this.lastTap.stackId === stackId && now - this.lastTap.time < DOUBLE_TAP_MS) {
      this.lastTap = null;
      this.commands.flip(stackId);
    } else {
      this.lastTap = { stackId, time: now };
    }
    this.setSelected(stackId);
  }

  private startDrag(press: Press, shiftKey: boolean): void {
    window.clearTimeout(press.longPressTimer);
    const stack = this.table.state.stacks[press.stackId];
    if (!stack) return;
    const whole = press.wholeStack || shiftKey || stack.cardIds.length === 1;
    let drag: Drag;
    if (whole) {
      drag = { stackId: stack.id, origin: { kind: 'whole' }, x: stack.x, z: stack.z, target: { kind: 'table' } };
    } else {
      const newStackId = this.ids.make('stack');
      this.table.dispatch({ type: 'splitStack', stackId: stack.id, count: 1, newStackId, x: stack.x, z: stack.z });
      drag = {
        stackId: newStackId,
        origin: { kind: 'split', fromStackId: stack.id },
        x: stack.x,
        z: stack.z,
        target: { kind: 'table' },
      };
    }
    press.drag = drag;
    this.lastTap = null;
    this.setHovered(null);
    this.setSelected(drag.stackId);
  }

  private moveDrag(press: Press, e: PointerEvent): void {
    const drag = press.drag;
    if (!drag) return;
    const stack = this.table.state.stacks[drag.stackId];
    // The spot on the felt under the pointer is where the cards will land; they float just above it.
    const point = this.tablePoint(e);
    if (!stack) return;
    if (point) {
      const [hw, hh] = halfSize(stack.turn);
      drag.x = THREE.MathUtils.clamp(point.x - press.grabOffset.x, -TABLE_WIDTH / 2 + hw, TABLE_WIDTH / 2 - hw);
      drag.z = THREE.MathUtils.clamp(point.z - press.grabOffset.y, -TABLE_DEPTH / 2 + hh, TABLE_DEPTH / 2 - hh);
    }
    drag.target = this.dropTarget(drag, e);
    this.hand?.showDrop(drag.target.kind === 'hand' ? drag.target.index : null);
    const floor = drag.target.kind === 'stack' ? this.cards.topY(drag.target.stackId) : 0;
    this.cards.setLift({ stackId: drag.stackId, x: drag.x, z: drag.z, y: floor + CARRY_HEIGHT });
    this.refreshHighlights();
  }

  private endDrag(drag: Drag, cancelled: boolean): void {
    this.hand?.showDrop(null);
    const state = this.table.state;
    if (!state.stacks[drag.stackId]) {
      this.cards.setLift(null);
      return;
    }
    const target = drag.target;
    if (cancelled) {
      // Put the cards back where they came from.
      if (drag.origin.kind === 'split' && state.stacks[drag.origin.fromStackId]) {
        this.table.dispatch({ type: 'mergeStacks', sourceId: drag.stackId, targetId: drag.origin.fromStackId });
        this.setSelected(drag.origin.fromStackId);
      } else if (drag.origin.kind === 'hand') {
        const { handId, index } = drag.origin;
        this.table.dispatch({ type: 'stackToHand', stackId: drag.stackId, handId, index });
      }
    } else if (target.kind === 'hand') {
      this.table.dispatch({
        type: 'stackToHand',
        stackId: drag.stackId,
        handId: this.commands.handId,
        index: target.index,
      });
    } else if (target.kind === 'stack' && state.stacks[target.stackId]) {
      this.table.dispatch({ type: 'mergeStacks', sourceId: drag.stackId, targetId: target.stackId });
      this.setSelected(target.stackId);
    } else if (target.kind === 'zone') {
      this.table.dispatch({ type: 'moveStack', stackId: drag.stackId, x: target.zone.x, z: target.zone.z });
    } else {
      this.table.dispatch({ type: 'moveStack', stackId: drag.stackId, x: round(drag.x), z: round(drag.z) });
    }
    this.cards.setLift(null);
    this.refreshHighlights();
  }

  private cancelPress(): void {
    const press = this.press;
    if (!press) return;
    window.clearTimeout(press.longPressTimer);
    this.press = null;
    if (press.drag) this.endDrag(press.drag, true);
    else this.cards.setLift(null);
    this.emit();
  }

  // --- keyboard -----------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (this.press) this.cancelPress();
      else this.setSelected(null);
      e.preventDefault();
      return;
    }
    const stackId = this.focusStackId;
    if (!stackId) return;
    const carrying = Boolean(this.press?.drag);
    if (key === 'f') this.commands.flip(stackId);
    else if (key === 'q') this.commands.turn(stackId, -1);
    else if (key === 'e') this.commands.turn(stackId, 1);
    // Commands that pull cards out of a stack wait until nothing is being carried.
    else if (key === 's' && !carrying) this.commands.shuffle(stackId);
    else if (key === 'd' && !carrying) this.commands.draw(stackId, 1);
    else if (/^[1-9]$/.test(key) && !carrying) this.commands.draw(stackId, Number(key));
    else return;
    e.preventDefault();
  }

  // --- helpers ------------------------------------------------------------

  private dropTarget(drag: Drag, e: PointerEvent): Drag['target'] {
    if (this.hand?.hit(e.clientX, e.clientY)) return { kind: 'hand', index: this.hand.indexAt(e.clientX) };
    const stack = this.nearest(Object.values(this.table.state.stacks), drag);
    if (stack) return { kind: 'stack', stackId: stack.id };
    // A marked spot only catches cards while nothing lies on it; then the pile there takes over.
    const occupied = (zone: Zone) =>
      Object.values(this.table.state.stacks).some((s) => s.id !== drag.stackId && s.x === zone.x && s.z === zone.z);
    const zone = this.nearest(
      this.zones.filter((z) => !occupied(z)),
      drag,
    );
    return zone ? { kind: 'zone', zone } : { kind: 'table' };
  }

  /** The nearest thing whose middle area is under the carried stack's centre. */
  private nearest<T extends { x: number; z: number; turn: number; id: string }>(
    items: readonly T[],
    drag: Drag,
  ): T | null {
    let best: T | null = null;
    let bestDistance = Infinity;
    for (const item of items) {
      if (item.id === drag.stackId) continue;
      const [hw, hh] = halfSize(item.turn);
      const dx = Math.abs(drag.x - item.x);
      const dz = Math.abs(drag.z - item.z);
      if (dx > hw * SNAP_REACH || dz > hh * SNAP_REACH) continue;
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    return best;
  }

  private pick(e: PointerEvent): ReturnType<CardLayer['pick']> {
    this.setRay(e);
    return this.cards.pick(this.raycaster);
  }

  /** The point on the felt under the pointer. */
  private tablePoint(e: PointerEvent): THREE.Vector3 | null {
    this.setRay(e);
    return this.raycaster.ray.intersectPlane(this.plane, this.scratchPoint);
  }

  private setRay(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private setHovered(stackId: string | null): void {
    if (stackId === this.hoveredId) return;
    this.hoveredId = stackId;
    this.refreshHighlights();
    this.emit();
  }

  private setSelected(stackId: string | null): void {
    if (stackId === this.selectedId) return;
    this.selectedId = stackId;
    this.refreshHighlights();
    this.emit();
  }

  private refreshHighlights(): void {
    const drag = this.press?.drag;
    this.canvas.style.cursor = drag ? 'grabbing' : this.hoveredId ? 'grab' : '';
    const target = drag?.target;
    if (target?.kind === 'zone') this.highlights.show('drop', target.zone, 0);
    else this.showFrame('drop', target?.kind === 'stack' ? target.stackId : null);
    this.showFrame('selected', drag ? null : this.selectedId);
    this.showFrame('hover', drag || this.hoveredId === this.selectedId ? null : this.hoveredId);
  }

  private showFrame(kind: HighlightKind, stackId: string | null): void {
    const stack = stackId ? this.table.state.stacks[stackId] : undefined;
    this.highlights.show(kind, stack, stack ? this.cards.topY(stack.id) : 0);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Keeps positions tidy (to a tenth of a millimetre) so saved and shared states stay small. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target as HTMLElement)?.isContentEditable
  );
}
