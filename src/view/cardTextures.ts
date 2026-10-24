import * as THREE from 'three';
import type { CardFace } from '../model/cardSet';
import { drawCardBack, drawCardFront } from './cardArt';

/**
 * Makes card textures on demand and frees them when no card shows them.
 *
 * Only face-up cards need their front picture, so a deck of face-down cards
 * costs one shared back texture instead of one texture per card.
 */
export class CardTextures {
  private readonly fronts = new Map<string, { texture: THREE.Texture; users: number }>();
  readonly back: THREE.Texture;

  constructor(
    private readonly faces: ReadonlyMap<string, CardFace>,
    backLabel: string,
    private readonly anisotropy: number,
  ) {
    this.back = this.toTexture(drawCardBack(backLabel));
  }

  /** Gets the front texture for a face. Call `releaseFront` once it is no longer shown. */
  acquireFront(faceId: string): THREE.Texture {
    let entry = this.fronts.get(faceId);
    if (!entry) {
      const face = this.faces.get(faceId);
      if (!face) throw new Error(`Unknown card face ${faceId}.`);
      entry = { texture: this.toTexture(drawCardFront(face)), users: 0 };
      this.fronts.set(faceId, entry);
    }
    entry.users++;
    return entry.texture;
  }

  releaseFront(faceId: string): void {
    const entry = this.fronts.get(faceId);
    if (!entry) return;
    entry.users--;
    if (entry.users <= 0) {
      entry.texture.dispose();
      this.fronts.delete(faceId);
    }
  }

  get liveFrontCount(): number {
    return this.fronts.size;
  }

  private toTexture(canvas: HTMLCanvasElement): THREE.Texture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.anisotropy;
    return texture;
  }
}
