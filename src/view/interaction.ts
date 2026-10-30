import * as THREE from 'three';
import type { TableCommands } from '../model/commands';
import { TABLE_DEPTH, TABLE_WIDTH } from '../model/dimensions';
import type { Zone } from '../model/layout';
import { footprintsOverlap, halfSize } from '../model/plans';
import type { IdGenerator, StackState, Table } from '../model/table';
import type { CardLayer } from './cardLayer';
import type { FrameSpot, Highlights } from './highlights';

/** How far (in screen pixels) a press must travel before it counts as a drag rather than a click. */
const DRAG_THRESHOLD = { mouse: 5, touch: 10 } as const;
/**
 * On touch, holding still this long grabs the whole stack (or, on empty
 * table, starts a selection box). Mouse users have Shift and a plain drag for
 * those, so a slow start with the mouse never grabs a whole deck by surprise.
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

/** The camera controls, which a touch selection box switches off so the finger does not move the view. */
export interface CameraLock {
  enabled: boolean;
}

export interface InteractionListener {
  /** The stack under the mouse, the selection, or whether a drag is going on changed. */
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
  /** Ctrl or Cmd was held: a click adds the stack to the selection or takes it out. */
  toggle: boolean;
  /** A touch held still long enough: a release without moving adds the stack to the selection or takes it out. */
  longPressed: boolean;
  longPressTimer: number | undefined;
  drag: Drag | null;
}

/** A press on empty table: a click clears the selection, a drag draws a selection box. */
interface EmptyPress {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  /** Ctrl, Cmd or Shift was held: the box adds to the selection instead of replacing it. */
  additive: boolean;
  longPressTimer: number | undefined;
  box: { base: string[] } | null;
}

type Origin =
  | { kind: 'split'; fromStackId: string }
  | { kind: 'whole' }
  | { kind: 'hand'; handId: string; index: number };

/** Another selected stack carried along with the one under the pointer, at a fixed offset from it. */
interface Follower {
  stackId: string;
  dx: number;
  dz: number;
  x: number;
  z: number;
}

interface Drag {
  /** The stack under the pointer. */
  stackId: string;
  /** Where the carried cards came from. */
  origin: Origin;
  followers: Follower[];
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
 *   Ctrl / Cmd + click, or on touch a hold and release, adds a stack to the
 *   selection; a drag on empty table (on touch: hold, then drag) draws a box
 *   around the stacks to select. Dragging any selected stack carries them all.
 * - Keys work on the stack under the mouse, or else the selection:
 *   F flip, Q / E turn, S shuffle, D draw one, 1-9 draw that many, G gather,
 *   L spread, Esc cancel; Ctrl + A selects all, Ctrl + Z undoes.
 *
 * Other presses on empty table, and the right and middle mouse buttons, are
 * left to the camera controls.
 */
export class CardInteraction {
  private press: Press | null = null;
  /** Pointers the camera controls own, such as a one-finger pan on empty table. */
  private readonly cameraPointers = new Set<number>();
  private emptyPress: EmptyPress | null = null;
  private lastTap: { stackId: string; time: number } | null = null;
  private hoveredId: string | null = null;
  /** Selected stacks, oldest first: the last one is the main one, used where only one stack makes sense. */
  private selectionIds: string[] = [];
  private hand: HandDock | null = null;
  private cameraLock: CameraLock | null = null;
  private readonly boxElement: HTMLElement;
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

    this.boxElement = document.createElement('div');
    this.boxElement.className = 'select-box';
    this.boxElement.hidden = true;
    document.body.append(this.boxElement);

    this.unsubscribeTable = table.subscribe((state, change) => {
      // After an undo, a redo or a new game, ids may name different stacks, so start the selection afresh.
      const kept =
        change.type === 'restore' || change.type === 'load' ? [] : this.selectionIds.filter((id) => state.stacks[id]);
      if (kept.length !== this.selectionIds.length) this.selectionIds = kept;
      if (this.hoveredId && !state.stacks[this.hoveredId]) this.hoveredId = null;
      this.refreshHighlights();
      this.emit();
    });
  }

  /** Connects the on-screen hand, so cards can be dropped into it. */
  setHandDock(hand: HandDock): void {
    this.hand = hand;
  }

  /** Connects the camera controls, so a touch selection box can hold the view still. */
  setCameraLock(lock: CameraLock): void {
    this.cameraLock = lock;
  }

  get hovered(): string | null {
    return this.hoveredId;
  }

  /** The main selected stack: the one picked last. */
  get selected(): string | null {
    return this.selectionIds[this.selectionIds.length - 1] ?? null;
  }

  /** Every selected stack, oldest first. */
  get selection(): readonly string[] {
    return this.selectionIds;
  }

  get dragging(): boolean {
    return Boolean(this.press?.drag);
  }

  /** Calls `listener` when the hovered stack, the selection, the drag state, or the table changes. */
  subscribe(listener: InteractionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The stacks that keys work on: the carried ones during a drag; else the one
   * under the mouse, or the whole selection if that one is part of it; else the selection.
   */
  get keyTargets(): string[] {
    const drag = this.press?.drag;
    if (drag) return this.carriedIds(drag);
    const hovered = this.hoveredId;
    if (hovered && !this.selectionIds.includes(hovered)) return [hovered];
    return [...this.selectionIds];
  }

  /** Selects one stack, or clears the selection with `null`. */
  select(stackId: string | null): void {
    this.setSelection(stackId ? [stackId] : []);
  }

  /** Selects exactly these stacks. */
  setSelection(stackIds: readonly string[]): void {
    const state = this.table.state;
    const next = [...new Set(stackIds)].filter((id) => state.stacks[id]);
    if (next.length === this.selectionIds.length && next.every((id, i) => id === this.selectionIds[i])) return;
    this.selectionIds = next;
    this.refreshHighlights();
    this.emit();
  }

  selectAll(): void {
    this.setSelection(Object.keys(this.table.state.stacks));
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
    const [x, z] = clampToTable(point?.x ?? 0, point?.z ?? 0, 0);
    const stackId = this.ids.make('stack');
    this.table.checkpoint();
    this.table.dispatch({ type: 'playToTable', handId, cardId, faceUp: true, newStackId: stackId, x, z, turn: 0 });
    const press: Press = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      stackId,
      startX: e.clientX,
      startY: e.clientY,
      grabOffset: new THREE.Vector2(0, 0),
      wholeStack: true,
      toggle: false,
      longPressed: false,
      longPressTimer: undefined,
      drag: { stackId, origin: { kind: 'hand', handId, index }, followers: [], x, z, target: { kind: 'table' } },
    };
    this.press = press;
    this.setHovered(null);
    this.select(stackId);
    this.moveDrag(press, e);
    this.emit();
  }

  dispose(): void {
    this.cancelPress();
    this.abort.abort();
    this.unsubscribeTable();
    this.boxElement.remove();
  }

  // --- pointer handling -------------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    if (e.target !== this.canvas) return;
    // A pointer that comes down again was lifted somewhere we did not hear about.
    this.cameraPointers.delete(e.pointerId);
    if (this.press || this.emptyPress?.box) {
      // Another finger while carrying a card or drawing a box: keep it away from the camera too.
      e.stopPropagation();
      return;
    }
    const primary = e.pointerType === 'mouse' ? e.button === 0 : true;
    const hit = primary && this.cameraPointers.size === 0 ? this.pick(e) : null;
    if (!hit) {
      this.cameraPointers.add(e.pointerId);
      // A second finger turns a one-finger press into a camera gesture.
      if (primary && this.cameraPointers.size === 1) this.startEmptyPress(e);
      else this.endEmptyPress(true);
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
      toggle: e.ctrlKey || e.metaKey,
      longPressed: false,
      longPressTimer: undefined,
      drag: null,
    };
    if (e.pointerType !== 'mouse') {
      press.longPressTimer = window.setTimeout(() => this.onLongPress(press), LONG_PRESS_MS);
    }
    this.press = press;
  }

  private onLongPress(press: Press): void {
    if (this.press !== press || press.drag) return;
    press.wholeStack = true;
    press.longPressed = true;
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
        if (this.distance(e, press.startX, press.startY) < this.threshold(press.pointerType)) return;
        this.startDrag(press, e.shiftKey);
      }
      this.moveDrag(press, e);
      return;
    }
    const empty = this.emptyPress;
    if (empty && e.pointerId === empty.pointerId) {
      this.moveEmptyPress(empty, e);
      return;
    }
    if (!press && e.pointerType === 'mouse' && this.cameraPointers.size === 0) {
      this.setHovered(e.target === this.canvas ? (this.pick(e)?.stackId ?? null) : null);
    }
  }

  private onPointerUp(e: PointerEvent, cancelled: boolean): void {
    this.cameraPointers.delete(e.pointerId);
    const empty = this.emptyPress;
    if (empty?.pointerId === e.pointerId) {
      const click = !empty.box && this.distance(e, empty.startX, empty.startY) < DRAG_THRESHOLD.touch;
      this.endEmptyPress(cancelled);
      if (click && !cancelled && !empty.additive) this.select(null);
    }
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    window.clearTimeout(press.longPressTimer);
    this.press = null;
    if (press.drag) {
      this.endDrag(press.drag, cancelled);
    } else {
      this.cards.setLift(null);
      if (!cancelled) this.onTap(press);
    }
    this.emit();
  }

  private onTap(press: Press): void {
    const { stackId } = press;
    if (press.toggle || press.longPressed) {
      this.lastTap = null;
      const has = this.selectionIds.includes(stackId);
      this.setSelection(has ? this.selectionIds.filter((id) => id !== stackId) : [...this.selectionIds, stackId]);
      return;
    }
    const now = performance.now();
    if (this.lastTap && this.lastTap.stackId === stackId && now - this.lastTap.time < DOUBLE_TAP_MS) {
      this.lastTap = null;
      this.commands.flip(stackId);
    } else {
      this.lastTap = { stackId, time: now };
    }
    this.select(stackId);
  }

  private startDrag(press: Press, shiftKey: boolean): void {
    window.clearTimeout(press.longPressTimer);
    const state = this.table.state;
    const stack = state.stacks[press.stackId];
    if (!stack) return;
    this.table.checkpoint();
    const inGroup = this.selectionIds.length > 1 && this.selectionIds.includes(stack.id);
    const whole = inGroup || press.wholeStack || shiftKey || stack.cardIds.length === 1;
    let drag: Drag;
    if (whole) {
      const followers = inGroup
        ? this.selectionIds.flatMap((id): Follower[] => {
            const other = state.stacks[id];
            if (!other || id === stack.id) return [];
            return [{ stackId: id, dx: other.x - stack.x, dz: other.z - stack.z, x: other.x, z: other.z }];
          })
        : [];
      drag = {
        stackId: stack.id,
        origin: { kind: 'whole' },
        followers,
        x: stack.x,
        z: stack.z,
        target: { kind: 'table' },
      };
    } else {
      const newStackId = this.ids.make('stack');
      this.table.dispatch({ type: 'splitStack', stackId: stack.id, count: 1, newStackId, x: stack.x, z: stack.z });
      drag = {
        stackId: newStackId,
        origin: { kind: 'split', fromStackId: stack.id },
        followers: [],
        x: stack.x,
        z: stack.z,
        target: { kind: 'table' },
      };
    }
    press.drag = drag;
    this.lastTap = null;
    this.setHovered(null);
    if (!inGroup) this.select(drag.stackId);
    this.refreshHighlights();
  }

  private moveDrag(press: Press, e: PointerEvent): void {
    const drag = press.drag;
    if (!drag) return;
    const state = this.table.state;
    const stack = state.stacks[drag.stackId];
    // The spot on the felt under the pointer is where the cards will land; they float just above it.
    const point = this.tablePoint(e);
    if (!stack) return;
    if (point) {
      [drag.x, drag.z] = clampToTable(point.x - press.grabOffset.x, point.z - press.grabOffset.y, stack.turn);
      for (const follower of drag.followers) {
        const turn = state.stacks[follower.stackId]?.turn ?? 0;
        [follower.x, follower.z] = clampToTable(drag.x + follower.dx, drag.z + follower.dz, turn);
      }
    }
    drag.target = this.dropTarget(drag, e);
    this.hand?.showDrop(drag.target.kind === 'hand' ? drag.target.index : null);
    const carried = this.carriedIds(drag);
    const targetTop = drag.target.kind === 'stack' ? this.cards.topY(drag.target.stackId) : 0;
    const leaderFloor = Math.max(targetTop, this.floorUnder(drag.stackId, drag.x, drag.z, carried));
    this.cards.setLifts([
      { stackId: drag.stackId, x: drag.x, z: drag.z, y: leaderFloor + CARRY_HEIGHT },
      ...drag.followers.map((f) => ({
        stackId: f.stackId,
        x: f.x,
        z: f.z,
        y: this.floorUnder(f.stackId, f.x, f.z, carried) + CARRY_HEIGHT,
      })),
    ]);
    this.refreshHighlights();
  }

  private endDrag(drag: Drag, cancelled: boolean): void {
    this.hand?.showDrop(null);
    const state = this.table.state;
    if (!state.stacks[drag.stackId]) {
      this.cards.setLifts([]);
      return;
    }
    const target = drag.target;
    // Carried stacks are put down in the order they lay, so the ones on top stay on top.
    const carried = new Set(this.carriedIds(drag));
    const inOrder = Object.keys(state.stacks).filter((id) => carried.has(id));
    if (cancelled) {
      // Put everything back as it was before the drag began.
      this.table.cancelStep();
      if (drag.origin.kind === 'split') this.select(drag.origin.fromStackId);
    } else if (target.kind === 'hand') {
      let index = target.index;
      for (const stackId of inOrder) {
        const n = this.table.state.stacks[stackId]?.cardIds.length ?? 0;
        this.table.dispatch({ type: 'stackToHand', stackId, handId: this.commands.handId, index });
        index += n;
      }
    } else if (target.kind === 'stack' && state.stacks[target.stackId]) {
      for (const sourceId of inOrder) this.table.dispatch({ type: 'mergeStacks', sourceId, targetId: target.stackId });
      this.select(target.stackId);
    } else {
      // A marked spot pulls the stack under the pointer onto it; any others keep their places around it.
      const [x, z] = target.kind === 'zone' ? [target.zone.x, target.zone.z] : [round(drag.x), round(drag.z)];
      const places = new Map<string, [number, number]>([[drag.stackId, [x, z]]]);
      for (const f of drag.followers) {
        const [fx, fz] = clampToTable(x + f.dx, z + f.dz, state.stacks[f.stackId]?.turn ?? 0);
        places.set(f.stackId, [round(fx), round(fz)]);
      }
      for (const stackId of inOrder) {
        const [px, pz] = places.get(stackId) ?? [x, z];
        this.table.dispatch({ type: 'moveStack', stackId, x: px, z: pz });
      }
    }
    this.cards.setLifts([]);
    this.refreshHighlights();
  }

  private cancelPress(): void {
    this.endEmptyPress(true);
    const press = this.press;
    if (!press) return;
    window.clearTimeout(press.longPressTimer);
    this.press = null;
    if (press.drag) this.endDrag(press.drag, true);
    else this.cards.setLift(null);
    this.emit();
  }

  // --- selection box --------------------------------------------------------

  private startEmptyPress(e: PointerEvent): void {
    const empty: EmptyPress = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      additive: e.ctrlKey || e.metaKey || e.shiftKey,
      longPressTimer: undefined,
      box: null,
    };
    if (e.pointerType !== 'mouse') {
      // On touch a finger on the felt moves the view; holding it still first draws a box instead.
      empty.longPressTimer = window.setTimeout(() => {
        if (this.emptyPress !== empty || this.cameraPointers.size > 1) return;
        if (this.cameraLock) this.cameraLock.enabled = false;
        empty.additive = true;
        this.startBox(empty);
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS);
    }
    this.emptyPress = empty;
  }

  private moveEmptyPress(empty: EmptyPress, e: PointerEvent): void {
    if (!empty.box) {
      if (this.distance(e, empty.startX, empty.startY) < this.threshold(empty.pointerType)) return;
      window.clearTimeout(empty.longPressTimer);
      // A touch that moves before the hold is a pan, which belongs to the camera.
      if (empty.pointerType !== 'mouse') {
        this.emptyPress = null;
        return;
      }
      this.startBox(empty);
    }
    this.updateBox(empty, e.clientX, e.clientY);
  }

  private startBox(empty: EmptyPress): void {
    empty.box = { base: empty.additive ? [...this.selectionIds] : [] };
    this.setHovered(null);
    this.updateBox(empty, empty.startX, empty.startY);
    this.boxElement.hidden = false;
  }

  /** Draws the box from where the press began to the pointer, and selects the stacks whose centres are inside it. */
  private updateBox(empty: EmptyPress, clientX: number, clientY: number): void {
    const box = empty.box;
    if (!box) return;
    const left = Math.min(empty.startX, clientX);
    const top = Math.min(empty.startY, clientY);
    const right = Math.max(empty.startX, clientX);
    const bottom = Math.max(empty.startY, clientY);
    Object.assign(this.boxElement.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });
    const rect = this.canvas.getBoundingClientRect();
    const inside = Object.values(this.table.state.stacks)
      .filter((stack) => {
        const p = this.scratchPoint.set(stack.x, this.cards.topY(stack.id), stack.z).project(this.camera);
        const x = rect.left + ((p.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - p.y) / 2) * rect.height;
        return x >= left && x <= right && y >= top && y <= bottom;
      })
      .map((stack) => stack.id);
    this.setSelection([...box.base, ...inside]);
  }

  private endEmptyPress(cancelled: boolean): void {
    const empty = this.emptyPress;
    if (!empty) return;
    window.clearTimeout(empty.longPressTimer);
    this.emptyPress = null;
    if (!empty.box) return;
    this.boxElement.hidden = true;
    if (this.cameraLock) this.cameraLock.enabled = true;
    if (cancelled) this.setSelection(empty.box.base);
  }

  // --- keyboard -----------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    if (isTyping(e.target)) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (this.press || this.emptyPress?.box) return;
      if (key === 'a') this.selectAll();
      else if (key === 'z' && !e.shiftKey) this.commands.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') this.commands.redo();
      else return;
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === 'escape') {
      if (this.press || this.emptyPress) this.cancelPress();
      else this.select(null);
      e.preventDefault();
      return;
    }
    const targets = this.keyTargets;
    if (targets.length === 0) return;
    if (this.press?.drag) {
      // While carrying, flips and turns are part of the same move, and Undo takes them back with it.
      if (key === 'f') {
        for (const stackId of targets) this.table.dispatch({ type: 'flipStack', stackId });
      } else if (key === 'q' || key === 'e') {
        const by = key === 'q' ? -1 : 1;
        for (const stackId of targets) this.table.dispatch({ type: 'turnStack', stackId, by });
      } else {
        return;
      }
      e.preventDefault();
      return;
    }
    if (key === 'f') this.commands.flip(targets);
    else if (key === 'q') this.commands.turn(targets, -1);
    else if (key === 'e') this.commands.turn(targets, 1);
    else if (key === 's') this.commands.shuffle(targets);
    else if (key === 'd' && !e.shiftKey) this.commands.draw(targets, 1);
    else if (/^[1-9]$/.test(key)) this.commands.draw(targets, Number(key));
    else if (key === 'g') this.commands.gather(targets);
    else if (key === 'l' && targets.length === 1 && targets[0]) this.commands.spread(targets[0]);
    else return;
    e.preventDefault();
  }

  // --- helpers ------------------------------------------------------------

  private carriedIds(drag: Drag): string[] {
    return [drag.stackId, ...drag.followers.map((f) => f.stackId)];
  }

  private dropTarget(drag: Drag, e: PointerEvent): Drag['target'] {
    if (this.hand?.hit(e.clientX, e.clientY)) return { kind: 'hand', index: this.hand.indexAt(e.clientX) };
    const carried = new Set(this.carriedIds(drag));
    const resting = Object.values(this.table.state.stacks).filter((s) => !carried.has(s.id));
    const stack = this.nearest(resting, drag);
    if (stack) return { kind: 'stack', stackId: stack.id };
    // A marked spot only catches cards while nothing lies on it; then the pile there takes over.
    const occupied = (zone: Zone) => resting.some((s) => s.x === zone.x && s.z === zone.z);
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

  /** The top of the highest resting stack that a carried stack would overlap at x, z. */
  private floorUnder(stackId: string, x: number, z: number, carried: readonly string[]): number {
    const stack = this.table.state.stacks[stackId];
    if (!stack) return 0;
    const moved: StackState = { ...stack, x, z };
    let floor = 0;
    for (const other of Object.values(this.table.state.stacks)) {
      if (carried.includes(other.id) || !footprintsOverlap(moved, other)) continue;
      floor = Math.max(floor, this.cards.topY(other.id));
    }
    return floor;
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

  private distance(e: PointerEvent, x: number, y: number): number {
    return Math.hypot(e.clientX - x, e.clientY - y);
  }

  private threshold(pointerType: string): number {
    return pointerType === 'mouse' ? DRAG_THRESHOLD.mouse : DRAG_THRESHOLD.touch;
  }

  private setHovered(stackId: string | null): void {
    if (stackId === this.hoveredId) return;
    this.hoveredId = stackId;
    this.refreshHighlights();
    this.emit();
  }

  private refreshHighlights(): void {
    const drag = this.press?.drag;
    this.canvas.style.cursor = drag ? 'grabbing' : this.hoveredId ? 'grab' : '';
    const target = drag?.target;
    if (target?.kind === 'zone') this.highlights.show('drop', target.zone, 0);
    else this.highlights.show('drop', ...this.frameOf(target?.kind === 'stack' ? target.stackId : null));
    this.highlights.showSelected(drag ? [] : this.selectionIds.flatMap((id) => this.spot(id)));
    const hover = drag || (this.hoveredId && this.selectionIds.includes(this.hoveredId)) ? null : this.hoveredId;
    this.highlights.show('hover', ...this.frameOf(hover));
  }

  private frameOf(stackId: string | null): [StackState | null, number] {
    const stack = stackId ? (this.table.state.stacks[stackId] ?? null) : null;
    return [stack, stack ? this.cards.topY(stack.id) : 0];
  }

  private spot(stackId: string): FrameSpot[] {
    const stack = this.table.state.stacks[stackId];
    return stack ? [{ x: stack.x, z: stack.z, turn: stack.turn, y: this.cards.topY(stackId) }] : [];
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Keeps a stack's centre far enough in that the whole card stays on the table. */
function clampToTable(x: number, z: number, turn: number): [number, number] {
  const [hw, hh] = halfSize(turn);
  return [
    THREE.MathUtils.clamp(x, -TABLE_WIDTH / 2 + hw, TABLE_WIDTH / 2 - hw),
    THREE.MathUtils.clamp(z, -TABLE_DEPTH / 2 + hh, TABLE_DEPTH / 2 - hh),
  ];
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
