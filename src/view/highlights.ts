import * as THREE from 'three';
import { cardFrameGeometry } from './shapes';

export type HighlightKind = 'hover' | 'selected' | 'drop';

const STYLE: Record<HighlightKind, { color: string; opacity: number; gap: number; width: number }> = {
  hover: { color: '#fff3d6', opacity: 0.55, gap: 0.12, width: 0.22 },
  selected: { color: '#f0c060', opacity: 0.95, gap: 0.12, width: 0.38 },
  drop: { color: '#7fe0a8', opacity: 0.95, gap: 0.2, width: 0.45 },
};

/** Glowing frames drawn around a stack: one for hover, one for the selection, one for where a card will drop. */
export class Highlights {
  readonly group = new THREE.Group();
  private readonly frames: Record<HighlightKind, THREE.Mesh>;

  constructor() {
    this.group.name = 'highlights';
    const make = (kind: HighlightKind) => {
      const style = STYLE[kind];
      const mesh = new THREE.Mesh(
        cardFrameGeometry(style.gap, style.width),
        new THREE.MeshBasicMaterial({
          color: style.color,
          transparent: true,
          opacity: style.opacity,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mesh.name = `highlight-${kind}`;
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      return mesh;
    };
    this.frames = { hover: make('hover'), selected: make('selected'), drop: make('drop') };
  }

  /** Puts a frame around a stack at height `y` (its top), or hides it with `null`. */
  show(kind: HighlightKind, stack: { x: number; z: number; turn: number } | null | undefined, y = 0): void {
    const frame = this.frames[kind];
    if (!stack) {
      frame.visible = false;
      return;
    }
    frame.visible = true;
    frame.position.set(stack.x, y + 0.01, stack.z);
    frame.rotation.set(0, (-stack.turn * Math.PI) / 2, 0);
  }
}
