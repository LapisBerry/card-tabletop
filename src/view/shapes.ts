import * as THREE from 'three';
import { CARD_CORNER_RADIUS, CARD_HEIGHT, CARD_WIDTH } from '../model/dimensions';

/** A rectangle with rounded corners, centred on the origin: half width, half height and corner radius. */
export function roundedRect(hw: number, hh: number, r: number): THREE.Shape {
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

/** A flat rounded frame lying on the table around a card's outline: `gap` outside its edge and `width` wide. */
export function cardFrameGeometry(gap: number, width: number): THREE.BufferGeometry {
  const outer = roundedRect(
    CARD_WIDTH / 2 + gap + width,
    CARD_HEIGHT / 2 + gap + width,
    CARD_CORNER_RADIUS + gap + width,
  );
  outer.holes.push(roundedRect(CARD_WIDTH / 2 + gap, CARD_HEIGHT / 2 + gap, CARD_CORNER_RADIUS + gap));
  const geometry = new THREE.ShapeGeometry(outer, 6);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
