/**
 * Draws card pictures on a 2D canvas: plain text fronts and a simple back.
 * The canvas has the card's proportions and is mapped onto the whole card.
 */
import type { CardFace, CardKind, Suit } from '../model/cardSet';
import { CARD_HEIGHT, CARD_WIDTH } from '../model/dimensions';

export const ART_WIDTH = 512;
export const ART_HEIGHT = Math.round((ART_WIDTH * CARD_HEIGHT) / CARD_WIDTH);

const SERIF = 'Georgia, "Times New Roman", "DejaVu Serif", serif';
const SANS = 'system-ui, "Segoe UI", Roboto, "DejaVu Sans", sans-serif';

const PAPER = '#f1e6cc';
const INK = '#2b2118';

/** Frame colours by card kind: brown for actions and blue for equipment, as in Bang!. */
const KIND_STYLE: Record<CardKind, { frame: string; label: string }> = {
  action: { frame: '#8a5a2b', label: 'ACTION' },
  equipment: { frame: '#2f5d8a', label: 'EQUIPMENT' },
  character: { frame: '#5b4a2e', label: 'CHARACTER' },
  role: { frame: '#7a1f1f', label: 'ROLE' },
};

const SUIT_GLYPH: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RED_SUITS: ReadonlySet<Suit> = new Set(['hearts', 'diamonds']);

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = ART_WIDTH;
  canvas.height = ART_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw on a canvas.');
  return { canvas, ctx };
}

export function drawCardFront(face: CardFace): HTMLCanvasElement {
  const { canvas, ctx } = newCanvas();
  const W = ART_WIDTH;
  const H = ART_HEIGHT;
  const style = KIND_STYLE[face.kind];

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Frame
  ctx.strokeStyle = style.frame;
  ctx.lineWidth = 14;
  roundRect(ctx, 22, 22, W - 44, H - 44, 22);
  ctx.stroke();
  ctx.lineWidth = 2;
  roundRect(ctx, 38, 38, W - 76, H - 76, 14);
  ctx.stroke();

  // Title
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, face.name.toUpperCase(), W / 2, 92, W - 120, 54, `bold {size}px ${SERIF}`);

  // Kind label
  ctx.fillStyle = style.frame;
  ctx.font = `600 20px ${SANS}`;
  drawSpaced(ctx, style.label, W / 2, 140, 4);

  // Picture panel: a big initial, standing in for card art.
  const panelTop = 166;
  const panelHeight = 226;
  ctx.fillStyle = shade(PAPER, -0.07);
  roundRect(ctx, 64, panelTop, W - 128, panelHeight, 12);
  ctx.fill();
  ctx.strokeStyle = shade(PAPER, -0.25);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = style.frame;
  ctx.beginPath();
  ctx.arc(W / 2, panelTop + panelHeight / 2, 76, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.font = `bold 96px ${SERIF}`;
  ctx.fillText(face.name.charAt(0).toUpperCase(), W / 2, panelTop + panelHeight / 2 + 6);

  // Rules text
  if (face.text) {
    ctx.fillStyle = INK;
    wrapText(ctx, face.text, W / 2, 404, W - 140, 168, `{size}px ${SERIF}`, 30, 18);
  }

  // Rank and suit, bottom left
  if (face.rank && face.suit) {
    const color = RED_SUITS.has(face.suit) ? '#b3261e' : INK;
    const x = 88;
    const y = H - 86;
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold 26px ${SERIF}`;
    ctx.fillText(face.rank, x, y - 11);
    ctx.font = `26px ${SANS}`;
    ctx.fillText(SUIT_GLYPH[face.suit], x, y + 15);
  }

  return canvas;
}

export function drawCardBack(label: string): HTMLCanvasElement {
  const { canvas, ctx } = newCanvas();
  const W = ART_WIDTH;
  const H = ART_HEIGHT;
  const base = '#6e1b1b';
  const gold = '#d8b26a';

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Diamond lattice inside a gold frame
  ctx.save();
  roundRect(ctx, 40, 40, W - 80, H - 80, 16);
  ctx.clip();
  ctx.strokeStyle = 'rgba(216, 178, 106, 0.22)';
  ctx.lineWidth = 2;
  const step = 34;
  for (let d = -H; d < W + H; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + H, H);
    ctx.moveTo(d, H);
    ctx.lineTo(d + H, 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = gold;
  ctx.lineWidth = 6;
  roundRect(ctx, 28, 28, W - 56, H - 56, 22);
  ctx.stroke();
  ctx.lineWidth = 2;
  roundRect(ctx, 40, 40, W - 80, H - 80, 16);
  ctx.stroke();

  // Centre badge
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.fillStyle = base;
  ctx.strokeStyle = gold;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 170, 96, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 156, 82, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = gold;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, label.toUpperCase(), 0, 2, 250, 46, `bold {size}px ${SERIF}`);
  ctx.restore();

  return canvas;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws one line of text, shrinking the font until it fits `maxWidth`. `font` has a {size} placeholder. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  font: string,
): void {
  let s = size;
  do {
    ctx.font = font.replace('{size}', String(s));
    s -= 2;
  } while (ctx.measureText(text).width > maxWidth && s > 10);
  ctx.fillText(text, x, y);
}

/** Draws text with extra letter spacing, centred on x. */
function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let cursor = x - total / 2;
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, cursor, y);
    cursor += (widths[i] ?? 0) + spacing;
  });
  ctx.textAlign = align;
}

/**
 * Word-wraps text centred on x inside a box `maxWidth` wide and `maxHeight`
 * tall that starts at `top`, shrinking the font from `size` down to `minSize`
 * until it fits.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  maxWidth: number,
  maxHeight: number,
  font: string,
  size: number,
  minSize: number,
): void {
  let s = size;
  let lines: string[] = [];
  for (; s >= minSize; s -= 2) {
    ctx.font = font.replace('{size}', String(s));
    lines = breakLines(ctx, text, maxWidth);
    if (lines.length * s * 1.25 <= maxHeight) break;
  }
  s = Math.max(s, minSize);
  const lineHeight = s * 1.25;
  const blockTop = top + (maxHeight - lines.length * lineHeight) / 2 + lineHeight / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, blockTop + i * lineHeight));
}

function breakLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const attempt = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(attempt).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => Math.round(Math.min(255, Math.max(0, c + 255 * amount)));
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
