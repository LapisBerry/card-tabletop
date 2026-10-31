import * as THREE from 'three';
import { cardFrameGeometry } from './shapes';

export type HighlightKind = 'hover' | 'selected' | 'drop';

const STYLE: Record<HighlightKind, { color: string; opacity: number; gap: number; width: number }> = {
  hover: { color: '#fff3d6', opacity: 0.55, gap: 0.12, width: 0.22 },
  selected: { color: '#f0c060', opacity: 0.95, gap: 0.12, width: 0.38 },
  drop: { color: '#7fe0a8', opacity: 0.95, gap: 0.2, width: 0.45 },
};

/** Where to draw a frame: a stack's spot and turn, and the height of its top. */
export interface FrameSpot {
  x: number;
  z: number;
  turn: number;
  y: number;
}

/**
 * Glowing frames drawn around stacks: one for the stack under the pointer, one
 * for where carried cards will drop, and one for each selected stack.
 */
export class Highlights {
  readonly group = new THREE.Group();
  private readonly hover: THREE.Mesh;
  private readonly drop: THREE.Mesh;
  private readonly selectedGeometry: THREE.BufferGeometry;
  private readonly selectedMaterial: THREE.Material;
  /** Frames for selected stacks, made as needed and hidden when not in use. */
  private readonly selectedFrames: THREE.Mesh[] = [];

  constructor() {
    this.group.name = 'highlights';
    this.hover = this.make('hover');
    this.drop = this.make('drop');
    this.selectedGeometry = cardFrameGeometry(STYLE.selected.gap, STYLE.selected.width);
    this.selectedMaterial = material('selected');
  }

  /** Puts the hover or drop frame around a stack at height `y` (its top), or hides it with `null`. */
  show(kind: 'hover' | 'drop', stack: { x: number; z: number; turn: number } | null | undefined, y = 0): void {
    place(kind === 'hover' ? this.hover : this.drop, stack ? { ...stack, y } : null);
  }

  /** Frames every selected stack; stacks left out lose their frame. */
  showSelected(spots: readonly FrameSpot[]): void {
    while (this.selectedFrames.length < spots.length) {
      const mesh = new THREE.Mesh(this.selectedGeometry, this.selectedMaterial);
      mesh.name = 'highlight-selected';
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.selectedFrames.push(mesh);
    }
    this.selectedFrames.forEach((frame, i) => place(frame, spots[i] ?? null));
  }

  private make(kind: HighlightKind): THREE.Mesh {
    const style = STYLE[kind];
    const mesh = new THREE.Mesh(cardFrameGeometry(style.gap, style.width), material(kind));
    mesh.name = `highlight-${kind}`;
    mesh.visible = false;
    mesh.renderOrder = 10;
    this.group.add(mesh);
    return mesh;
  }
}

function material(kind: HighlightKind): THREE.Material {
  return new THREE.MeshBasicMaterial({
    color: STYLE[kind].color,
    transparent: true,
    opacity: STYLE[kind].opacity,
    depthWrite: false,
    toneMapped: false,
  });
}

function place(frame: THREE.Mesh, spot: FrameSpot | null): void {
  frame.visible = Boolean(spot);
  if (!spot) return;
  frame.position.set(spot.x, spot.y + 0.01, spot.z);
  frame.rotation.set(0, (-spot.turn * Math.PI) / 2, 0);
}
