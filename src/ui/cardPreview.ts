import type { CardFace } from '../model/cardSet';
import { drawCardFront } from '../view/cardArt';

/** A large picture of one card at the side of the screen, so its text can be read without zooming. */
export class CardPreview {
  private shownFaceId: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly faces: ReadonlyMap<string, CardFace>,
  ) {}

  /** Shows a card face, or hides the preview with `null`. `side` keeps it away from the pointer. */
  show(faceId: string | null, side: 'left' | 'right' = 'right'): void {
    this.root.classList.toggle('left', side === 'left');
    if (faceId === this.shownFaceId) return;
    this.shownFaceId = faceId;
    const face = faceId ? this.faces.get(faceId) : undefined;
    if (!face) {
      this.root.hidden = true;
      return;
    }
    const art = drawCardFront(face);
    this.canvas.width = art.width;
    this.canvas.height = art.height;
    this.canvas.getContext('2d')?.drawImage(art, 0, 0);
    this.canvas.setAttribute('aria-label', `${face.name}. ${face.text}`);
    this.root.hidden = false;
  }
}
