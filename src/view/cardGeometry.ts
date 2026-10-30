import * as THREE from 'three';
import { CARD_CORNER_RADIUS, CARD_HEIGHT, CARD_THICKNESS, CARD_WIDTH } from '../model/dimensions';
import { roundedRect } from './shapes';

/** Material slots of the card geometry. */
export const CARD_MATERIAL = { back: 0, front: 1, edge: 2 } as const;

/**
 * A thin card with rounded corners, lying flat and centred on the origin.
 * The front faces up (+y) and the back faces down. The top edge of the
 * printed front points to -z, away from the first seat.
 */
export function createCardGeometry(): THREE.BufferGeometry {
  const w = CARD_WIDTH;
  const h = CARD_HEIGHT;
  const r = CARD_CORNER_RADIUS;
  const shape = roundedRect(w / 2, h / 2, r);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: CARD_THICKNESS, bevelEnabled: false, curveSegments: 4 });

  // ExtrudeGeometry puts both lids in group 0 (bottom half, then top half) and
  // the sides in group 1. Split the lids so the back and front get their own
  // materials, and map each lid's UVs onto the whole card picture.
  const [lids, sides] = geometry.groups;
  if (!lids || !sides) throw new Error('Unexpected card geometry layout.');
  const half = lids.count / 2;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = lids.start; i < lids.start + lids.count; i++) {
    const u = (position.getX(i) + w / 2) / w;
    const v = (position.getY(i) + h / 2) / h;
    const isBack = i < lids.start + half;
    // The back is seen from below, so mirror it to read correctly once the card is flipped over.
    uv.setXY(i, isBack ? 1 - u : u, v);
  }
  uv.needsUpdate = true;
  geometry.clearGroups();
  geometry.addGroup(lids.start, half, CARD_MATERIAL.back);
  geometry.addGroup(lids.start + half, half, CARD_MATERIAL.front);
  geometry.addGroup(sides.start, sides.count, CARD_MATERIAL.edge);

  // Extruded along +z; stand that axis up as +y and centre the thickness.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -CARD_THICKNESS / 2, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
