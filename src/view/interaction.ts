import * as THREE from 'three';
import type { IdGenerator, StackState, Table } from '../model/table';
import { stackTopY, type CardLayer } from './cardLayer';
import { CARD_HEIGHT, CARD_WIDTH, TABLE_DEPTH, TABLE_WIDTH } from './dimensions';
import type { Highlights } from './highlights';

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
/** A dropped card joins a stack when its centre lands within this share of the stack's half size. */
const SNAP_REACH = 0.75;

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

interface Drag {
  stackId: string;
  /** Where the carried cards came from, to put them back if the drag is cancelled. */
  origin: { kind: 'split'; fromStackId: string } | { kind: 'whole' };
  x: number;
  z: number;
  dropTargetId: string | null;
}

/**
 * Turns mouse, touch and keyboard input into table actions.
 *
 * - Drag a card to pick up the top card of its stack and drop it anywhere.
 *   Shift + drag, or on touch a short hold before dragging, carries the whole stack.
 * - Dropping onto another stack puts the cards on top of it.
 * - Click or tap selects a stack; double-click or double-tap flips it.
 * - F flips, Q and E turn the stack under the mouse (or the selected one), Escape cancels.
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
    });
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

  /** Calls `listener` when the hovered or selected stack, or the drag state, changes. */
  subscribe(listener: InteractionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The stack that keyboard keys and the action buttons work on. */
  get focusStackId(): string | null {
    return this.press?.drag?.stackId ?? this.hoveredId ?? this.selectedId;
  }

  flip(stackId = this.focusStackId): void {
    if (stackId && this.table.state.stacks[stackId]) this.table.dispatch({ type: 'flipStack', stackId });
  }

  turn(by: number, stackId = this.focusStackId): void {
    if (stackId && this.table.state.stacks[stackId]) this.table.dispatch({ type: 'turnStack', stackId, by });
  }

  select(stackId: string | null): void {
    this.setSelected(stackId && this.table.state.stacks[stackId] ? stackId : null);
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
    this.cards.setLift({ stackId: stack.id, x: stack.x, z: stack.z, y: 0.6 });
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
      this.flip(stackId);
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
      drag = { stackId: stack.id, origin: { kind: 'whole' }, x: stack.x, z: stack.z, dropTargetId: null };
    } else {
      const newStackId = this.ids.make('stack');
      this.table.dispatch({ type: 'splitStack', stackId: stack.id, count: 1, newStackId, x: stack.x, z: stack.z });
      drag = {
        stackId: newStackId,
        origin: { kind: 'split', fromStackId: stack.id },
        x: stack.x,
        z: stack.z,
        dropTargetId: null,
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
    if (!stack || !point) return;
    const [hw, hh] = halfSize(stack.turn);
    drag.x = THREE.MathUtils.clamp(point.x - press.grabOffset.x, -TABLE_WIDTH / 2 + hw, TABLE_WIDTH / 2 - hw);
    drag.z = THREE.MathUtils.clamp(point.z - press.grabOffset.y, -TABLE_DEPTH / 2 + hh, TABLE_DEPTH / 2 - hh);
    const target = this.dropTarget(drag);
    drag.dropTargetId = target?.id ?? null;
    const floor = target ? stackTopY(target.cardIds.length) : 0;
    this.cards.setLift({ stackId: drag.stackId, x: drag.x, z: drag.z, y: floor + CARRY_HEIGHT });
    this.refreshHighlights();
  }

  private endDrag(drag: Drag, cancelled: boolean): void {
    const state = this.table.state;
    if (!state.stacks[drag.stackId]) {
      this.cards.setLift(null);
      return;
    }
    if (cancelled) {
      // Put the cards back where they came from.
      if (drag.origin.kind === 'split' && state.stacks[drag.origin.fromStackId]) {
        this.table.dispatch({ type: 'mergeStacks', sourceId: drag.stackId, targetId: drag.origin.fromStackId });
        this.setSelected(drag.origin.fromStackId);
      }
    } else if (drag.dropTargetId && state.stacks[drag.dropTargetId]) {
      this.table.dispatch({ type: 'mergeStacks', sourceId: drag.stackId, targetId: drag.dropTargetId });
      this.setSelected(drag.dropTargetId);
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
    switch (e.key.toLowerCase()) {
      case 'f':
        this.flip();
        break;
      case 'q':
        this.turn(-1);
        break;
      case 'e':
        this.turn(1);
        break;
      case 'escape':
        if (this.press) this.cancelPress();
        else this.setSelected(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // --- helpers ------------------------------------------------------------

  /** The stack a carried stack would land on: the nearest one whose middle area is under its centre. */
  private dropTarget(drag: Drag): StackState | null {
    let best: StackState | null = null;
    let bestDistance = Infinity;
    for (const stack of Object.values(this.table.state.stacks)) {
      if (stack.id === drag.stackId) continue;
      const [hw, hh] = halfSize(stack.turn);
      const dx = Math.abs(drag.x - stack.x);
      const dz = Math.abs(drag.z - stack.z);
      if (dx > hw * SNAP_REACH || dz > hh * SNAP_REACH) continue;
      const distance = Math.hypot(dx, dz);
      if (distance < bestDistance) {
        best = stack;
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
    this.canvas.style.cursor = stackId ? 'grab' : '';
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
    const stacks = this.table.state.stacks;
    const drag = this.press?.drag;
    if (drag) this.canvas.style.cursor = 'grabbing';
    else this.canvas.style.cursor = this.hoveredId ? 'grab' : '';
    this.highlights.show('drop', drag?.dropTargetId ? stacks[drag.dropTargetId] : null);
    this.highlights.show('selected', !drag && this.selectedId ? stacks[this.selectedId] : null);
    const hover = !drag && this.hoveredId && this.hoveredId !== this.selectedId ? stacks[this.hoveredId] : null;
    this.highlights.show('hover', hover);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Half the width and depth a stack covers on the table, given its quarter turns. */
function halfSize(turn: number): [number, number] {
  return turn % 2 === 0 ? [CARD_WIDTH / 2, CARD_HEIGHT / 2] : [CARD_HEIGHT / 2, CARD_WIDTH / 2];
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
