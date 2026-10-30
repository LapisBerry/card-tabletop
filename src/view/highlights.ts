import * as THREE from 'three';
import type { StackState } from '../model/table';
import { stackTopY } from './cardLayer';
import { CARD_CORNER_RADIUS, CARD_HEIGHT, CARD_WIDTH } from './dimensions';

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
        frameGeometry(style.gap, style.width),
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

  /** Puts a frame around a stack, or hides it with `null`. */
  show(kind: HighlightKind, stack: StackState | null | undefined): void {
    const frame = this.frames[kind];
    if (!stack) {
      frame.visible = false;
      return;
    }
    frame.visible = true;
    frame.position.set(stack.x, stackTopY(stack.cardIds.length) + 0.01, stack.z);
    frame.rotation.set(0, (-stack.turn * Math.PI) / 2, 0);
  }
}

/** A flat rounded frame lying on the table, `gap` outside the card edge and `width` wide. */
function frameGeometry(gap: number, width: number): THREE.BufferGeometry {
  const outer = roundedRect(
    CARD_WIDTH / 2 + gap + width,
    CARD_HEIGHT / 2 + gap + width,
    CARD_CORNER_RADIUS + gap + width,
  );
  const inner = roundedRect(CARD_WIDTH / 2 + gap, CARD_HEIGHT / 2 + gap, CARD_CORNER_RADIUS + gap);
  outer.holes.push(inner);
  const geometry = new THREE.ShapeGeometry(outer, 6);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function roundedRect(hw: number, hh: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return shape;
}
