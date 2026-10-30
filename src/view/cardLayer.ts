import * as THREE from 'three';
import { footprintsOverlap } from '../model/plans';
import type { Action, CardState, StackState, Table, TableState } from '../model/table';
import { CARD_MATERIAL, createCardGeometry } from './cardGeometry';
import type { CardTextures } from './cardTextures';
import { CARD_THICKNESS, CARD_WIDTH } from '../model/dimensions';

/** Gap between stacked cards, so their faces never fight for the same pixels. */
const STACK_GAP = 0.004;
/** Height of one card in a stack, gap included. */
export const CARD_PITCH = CARD_THICKNESS + STACK_GAP;
/** How quickly a card glides to a new place. Higher is snappier. */
const GLIDE_RATE = 16;
/** Cards in the hand of the pointer follow it faster, so dragging feels direct. */
const DRAG_GLIDE_RATE = 40;

/** Height of the top surface of a stack of `count` cards, above the felt. */
export function stackTopY(count: number): number {
  return count * CARD_PITCH;
}

/** A stack the pointer is carrying: drawn at this spot instead of where the table state has it. */
export interface Lift {
  stackId: string;
  x: number;
  z: number;
  /** Height of the bottom card above the felt. */
  y: number;
}

/**
 * Keeps one 3D mesh per card in step with the table state. Cards glide to
 * their new place instead of jumping, and lift into an arc when they flip so
 * they never sink through the table.
 */
export class CardLayer {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, CardView>();
  private readonly stackOfCard = new Map<string, string>();
  private readonly geometry = createCardGeometry();
  private readonly backMaterial: THREE.MeshStandardMaterial;
  private readonly edgeMaterial = new THREE.MeshStandardMaterial({ color: '#e7dcc0', roughness: 0.85 });
  private readonly unsubscribe: () => void;
  private state: TableState;
  private lift: Lift | null = null;
  /** How high each stack's bottom card rests: on the felt, or on top of stacks put down before it that it overlaps. */
  private readonly elevation = new Map<string, number>();

  constructor(
    table: Table,
    private readonly textures: CardTextures,
  ) {
    this.group.name = 'cards';
    this.backMaterial = new THREE.MeshStandardMaterial({ map: textures.back, roughness: 0.6 });
    this.state = table.state;
    this.sync(table.state, null);
    this.unsubscribe = table.subscribe((state, action) => this.sync(state, action));
  }

  /** Moves every card a step toward where it belongs. Call once per frame. */
  update(deltaSeconds: number): void {
    const t = 1 - Math.exp(-GLIDE_RATE * deltaSeconds);
    const tDrag = 1 - Math.exp(-DRAG_GLIDE_RATE * deltaSeconds);
    for (const [cardId, view] of this.views) {
      view.glide(this.lift && this.stackOfCard.get(cardId) === this.lift.stackId ? tDrag : t);
    }
  }

  /** Draws a stack at a carried position, or puts it back where the state has it with `null`. */
  setLift(lift: Lift | null): void {
    const previous = this.lift?.stackId;
    this.lift = lift;
    if (previous !== lift?.stackId) {
      // Cards resting on a stack that is picked up (or put back) settle to their new height.
      this.layout(false);
    } else if (lift) {
      this.placeStack(lift.stackId, false);
    }
  }

  /** Height of a stack's bottom card as drawn: on the felt, or on whatever it overlaps. */
  baseY(stackId: string): number {
    return this.elevation.get(stackId) ?? 0;
  }

  /** Height of the top of a stack as drawn: where a card dropped on it would rest. */
  topY(stackId: string): number {
    const stack = this.state.stacks[stackId];
    if (!stack) return 0;
    return (this.elevation.get(stackId) ?? 0) + stackTopY(stack.cardIds.length);
  }

  /** The card under a ray, topmost first, skipping the carried stack. */
  pick(raycaster: THREE.Raycaster): { cardId: string; stackId: string } | null {
    const hits = raycaster.intersectObjects(this.group.children, false);
    for (const hit of hits) {
      const cardId = hit.object.userData.cardId as string | undefined;
      const stackId = cardId ? this.stackOfCard.get(cardId) : undefined;
      if (!cardId || !stackId || stackId === this.lift?.stackId) continue;
      return { cardId, stackId };
    }
    return null;
  }

  dispose(): void {
    this.unsubscribe();
    for (const view of this.views.values()) view.dispose(this.textures);
    this.views.clear();
    this.geometry.dispose();
    this.backMaterial.dispose();
    this.edgeMaterial.dispose();
  }

  private sync(state: TableState, action: Action | null): void {
    const snap = action === null;
    this.state = state;
    this.stackOfCard.clear();
    if (this.lift && !state.stacks[this.lift.stackId]) this.lift = null;
    const seen = new Set<string>();
    const fresh: CardView[] = [];
    for (const stack of Object.values(state.stacks)) {
      for (const cardId of stack.cardIds) {
        const card = state.cards[cardId];
        if (!card) continue;
        seen.add(cardId);
        this.stackOfCard.set(cardId, stack.id);
        let view = this.views.get(cardId);
        if (!view) {
          view = new CardView(card.id, this.geometry, this.backMaterial, this.edgeMaterial);
          this.views.set(cardId, view);
          this.group.add(view.mesh);
          fresh.push(view);
        }
        view.show(card, this.textures);
      }
    }
    for (const [cardId, view] of this.views) {
      if (seen.has(cardId)) continue;
      this.group.remove(view.mesh);
      view.dispose(this.textures);
      this.views.delete(cardId);
    }
    this.layout(snap);
    // Cards that just arrived (dealt in, or played from a hand) appear in place rather than flying in from the origin.
    for (const view of fresh) view.snap();
    if (action?.type === 'shuffleStack') this.riffle(action.stackId);
  }

  /** Works out every stack's resting height, then sends each card toward its place. */
  private layout(snap: boolean): void {
    this.elevation.clear();
    const placed: StackState[] = [];
    for (const stack of Object.values(this.state.stacks)) {
      let base = 0;
      if (stack.id !== this.lift?.stackId) {
        for (const below of placed) {
          if (footprintsOverlap(below, stack)) {
            base = Math.max(base, (this.elevation.get(below.id) ?? 0) + stackTopY(below.cardIds.length));
          }
        }
        placed.push(stack);
      }
      this.elevation.set(stack.id, base);
      this.placeStack(stack.id, snap);
    }
  }

  /** Knocks a shuffled stack's cards a little out of line; they glide back into a neat pile. */
  private riffle(stackId: string): void {
    const stack = this.state.stacks[stackId];
    stack?.cardIds.forEach((cardId, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      this.views.get(cardId)?.nudge(side * (1.5 + Math.random() * 2.5), (Math.random() - 0.5) * 2);
    });
  }

  private placeStack(stackId: string, snap: boolean): void {
    const stack = this.state.stacks[stackId];
    if (!stack) return;
    stack.cardIds.forEach((cardId, index) => {
      const view = this.views.get(cardId);
      if (view) this.placeCard(view, stack, index, snap);
    });
  }

  private placeCard(view: CardView, stack: StackState, index: number, snap: boolean): void {
    const lifted = this.lift?.stackId === stack.id ? this.lift : null;
    const x = lifted ? lifted.x : stack.x;
    const z = lifted ? lifted.z : stack.z;
    const base = lifted ? lifted.y : (this.elevation.get(stack.id) ?? 0);
    view.setTarget(x, base + CARD_THICKNESS / 2 + index * CARD_PITCH + 0.002, z, stack.turn, snap);
  }
}

const UP = new THREE.Vector3(0, 1, 0);

class CardView {
  readonly mesh: THREE.Mesh;
  private readonly frontMaterial = new THREE.MeshStandardMaterial({ color: '#f1e6cc', roughness: 0.7 });
  private shownFaceId: string | null = null;
  private faceDown = false;
  /** Where the card sits on its glide path, before the flip arc is added. */
  private readonly base = new THREE.Vector3();
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetQuaternion = new THREE.Quaternion();
  private readonly scratchUp = new THREE.Vector3();
  private readonly scratchTargetUp = new THREE.Vector3();

  constructor(
    cardId: string,
    geometry: THREE.BufferGeometry,
    backMaterial: THREE.Material,
    edgeMaterial: THREE.Material,
  ) {
    const materials: THREE.Material[] = [];
    materials[CARD_MATERIAL.back] = backMaterial;
    materials[CARD_MATERIAL.front] = this.frontMaterial;
    materials[CARD_MATERIAL.edge] = edgeMaterial;
    this.mesh = new THREE.Mesh(geometry, materials);
    this.mesh.name = cardId;
    this.mesh.userData.cardId = cardId;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /** Loads the front picture while the card is face up, and frees it while face down. */
  show(card: CardState, textures: CardTextures): void {
    // A face-down card lies on its front, so the front faces the table.
    this.faceDown = !card.faceUp;
    const wanted = card.faceUp ? card.faceId : null;
    if (wanted === this.shownFaceId) return;
    if (this.shownFaceId) textures.releaseFront(this.shownFaceId);
    this.frontMaterial.map = wanted ? textures.acquireFront(wanted) : null;
    this.frontMaterial.needsUpdate = true;
    this.shownFaceId = wanted;
  }

  setTarget(x: number, y: number, z: number, turn: number, snap: boolean): void {
    this.targetPosition.set(x, y, z);
    const euler = new THREE.Euler(0, (-turn * Math.PI) / 2, this.faceDown ? Math.PI : 0, 'YZX');
    this.targetQuaternion.setFromEuler(euler);
    if (snap) this.snap();
  }

  /** Jumps straight to the target, with no glide. */
  snap(): void {
    this.base.copy(this.targetPosition);
    this.mesh.quaternion.copy(this.targetQuaternion);
    this.mesh.position.copy(this.base);
  }

  /** Pushes the card sideways from where it is; it glides back on its own. */
  nudge(dx: number, dz: number): void {
    this.base.x += dx;
    this.base.z += dz;
  }

  glide(t: number): void {
    this.base.lerp(this.targetPosition, t);
    this.mesh.quaternion.slerp(this.targetQuaternion, t);
    // Mid-flip the card stands on its long edge, so raise it by half its width
    // times how far it is tipped. A plain turn on the table does not tip it.
    const up = this.scratchUp.copy(UP).applyQuaternion(this.mesh.quaternion);
    const targetUp = this.scratchTargetUp.copy(UP).applyQuaternion(this.targetQuaternion);
    const tipped = Math.sin(up.angleTo(targetUp));
    this.mesh.position.copy(this.base);
    this.mesh.position.y += (CARD_WIDTH / 2) * tipped;
  }

  dispose(textures: CardTextures): void {
    if (this.shownFaceId) textures.releaseFront(this.shownFaceId);
    this.shownFaceId = null;
    this.frontMaterial.dispose();
  }
}
