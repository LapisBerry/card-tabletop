import * as THREE from 'three';
import type { CardState, StackState, Table, TableState } from '../model/table';
import { CARD_MATERIAL, createCardGeometry } from './cardGeometry';
import type { CardTextures } from './cardTextures';
import { CARD_THICKNESS } from './dimensions';

/** Gap between stacked cards, so their faces never fight for the same pixels. */
const STACK_GAP = 0.004;
/** How quickly a card glides to a new place. Higher is snappier. */
const GLIDE_RATE = 16;

/**
 * Keeps one 3D mesh per card in step with the table state. Cards glide to
 * their new place instead of jumping, so later moves and shuffles read well.
 */
export class CardLayer {
  readonly group = new THREE.Group();
  private readonly views = new Map<string, CardView>();
  private readonly geometry = createCardGeometry();
  private readonly backMaterial: THREE.MeshStandardMaterial;
  private readonly edgeMaterial = new THREE.MeshStandardMaterial({ color: '#e7dcc0', roughness: 0.85 });
  private readonly unsubscribe: () => void;

  constructor(
    table: Table,
    private readonly textures: CardTextures,
  ) {
    this.group.name = 'cards';
    this.backMaterial = new THREE.MeshStandardMaterial({ map: textures.back, roughness: 0.6 });
    this.sync(table.state, true);
    this.unsubscribe = table.subscribe((state) => this.sync(state, false));
  }

  /** Moves every card a step toward where it belongs. Call once per frame. */
  update(deltaSeconds: number): void {
    const t = 1 - Math.exp(-GLIDE_RATE * deltaSeconds);
    for (const view of this.views.values()) view.glide(t);
  }

  /** The mesh of a card, for picking with the mouse. */
  meshOf(cardId: string): THREE.Mesh | undefined {
    return this.views.get(cardId)?.mesh;
  }

  dispose(): void {
    this.unsubscribe();
    for (const view of this.views.values()) view.dispose(this.textures);
    this.views.clear();
    this.geometry.dispose();
    this.backMaterial.dispose();
    this.edgeMaterial.dispose();
  }

  private sync(state: TableState, snap: boolean): void {
    const seen = new Set<string>();
    for (const stack of Object.values(state.stacks)) {
      stack.cardIds.forEach((cardId, index) => {
        const card = state.cards[cardId];
        if (!card) return;
        seen.add(cardId);
        let view = this.views.get(cardId);
        const isNew = !view;
        if (!view) {
          view = new CardView(card.id, this.geometry, this.backMaterial, this.edgeMaterial);
          this.views.set(cardId, view);
          this.group.add(view.mesh);
        }
        view.show(card, this.textures);
        view.setTarget(stack, index, snap || isNew);
      });
    }
    for (const [cardId, view] of this.views) {
      if (seen.has(cardId)) continue;
      this.group.remove(view.mesh);
      view.dispose(this.textures);
      this.views.delete(cardId);
    }
  }
}

class CardView {
  readonly mesh: THREE.Mesh;
  private readonly frontMaterial = new THREE.MeshStandardMaterial({ color: '#f1e6cc', roughness: 0.7 });
  private shownFaceId: string | null = null;
  private faceDown = false;
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetQuaternion = new THREE.Quaternion();

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

  setTarget(stack: StackState, index: number, snap: boolean): void {
    const y = CARD_THICKNESS / 2 + index * (CARD_THICKNESS + STACK_GAP) + 0.002;
    this.targetPosition.set(stack.x, y, stack.z);
    const euler = new THREE.Euler(0, (-stack.turn * Math.PI) / 2, this.faceDown ? Math.PI : 0, 'YZX');
    this.targetQuaternion.setFromEuler(euler);
    if (snap) this.glide(1);
  }

  glide(t: number): void {
    this.mesh.position.lerp(this.targetPosition, t);
    this.mesh.quaternion.slerp(this.targetQuaternion, t);
  }

  dispose(textures: CardTextures): void {
    if (this.shownFaceId) textures.releaseFront(this.shownFaceId);
    this.shownFaceId = null;
    this.frontMaterial.dispose();
  }
}
