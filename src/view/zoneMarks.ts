import * as THREE from 'three';
import { CARD_HEIGHT } from '../model/dimensions';
import type { Zone } from '../model/layout';
import { cardFrameGeometry } from './shapes';

/** Faint printed outlines on the felt, with a label, marking where the draw and discard piles go. */
export function createZoneMarks(zones: readonly Zone[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'zones';
  const outline = cardFrameGeometry(0.35, 0.12);
  const material = new THREE.MeshBasicMaterial({
    color: '#f3ead8',
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  for (const zone of zones) {
    const mark = new THREE.Group();
    mark.position.set(zone.x, 0.003, zone.z);
    mark.rotation.y = (-zone.turn * Math.PI) / 2;
    mark.add(new THREE.Mesh(outline, material));
    const label = labelMesh(zone.label);
    // Printed just beyond the card's bottom edge, reading from the first seat.
    label.position.set(0, 0, CARD_HEIGHT / 2 + 1.1);
    mark.add(label);
    group.add(mark);
  }
  return group;
}

function labelMesh(text: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(243, 234, 216, 0.55)';
    ctx.font = '600 28px system-ui, "Segoe UI", Roboto, "DejaVu Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Wide letter spacing, drawn by hand because canvas letterSpacing is not everywhere yet.
    const letters = [...text];
    const spacing = 6;
    const widths = letters.map((ch) => ctx.measureText(ch).width);
    let x = canvas.width / 2 - (widths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1)) / 2;
    ctx.textAlign = 'left';
    letters.forEach((ch, i) => {
      ctx.fillText(ch, x, canvas.height / 2);
      x += (widths[i] ?? 0) + spacing;
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 1.5),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
