import { CanvasTexture, NearestFilter, SRGBColorSpace, type Texture } from "three";

/**
 * Text is drawn tiny and then magnified with nearest-neighbour filtering, which
 * is what gives it the chunky in-game look without shipping a bitmap font.
 */
const cache = new Map<string, Texture>();

const LABEL_CHAR = 9;
const LABEL_HEIGHT = 22;

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement): Texture {
  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Jersey number, painted on the back of the torso block. */
export function getNumberTexture(value: string, background: string, foreground: string): Texture {
  const key = `num:${value}:${background}:${foreground}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(16, 16);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = foreground;
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value.slice(0, 2), 8, 9);

  const texture = finish(canvas);
  cache.set(key, texture);
  return texture;
}

/** Floating name tag. */
export function getLabelTexture(text: string, accent: string): Texture {
  const key = `label:${text}:${accent}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const label = text.toUpperCase().slice(0, 14);
  const width = Math.max(32, label.length * LABEL_CHAR + 10);

  const { canvas, ctx } = makeCanvas(width, LABEL_HEIGHT);
  ctx.fillStyle = "rgba(10,12,17,0.92)";
  ctx.fillRect(0, 0, width, LABEL_HEIGHT);
  ctx.fillStyle = accent;
  ctx.fillRect(0, LABEL_HEIGHT - 3, width, 3);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, LABEL_HEIGHT / 2 - 1);

  const texture = finish(canvas);
  cache.set(key, texture);
  return texture;
}

export function labelAspect(text: string): number {
  const label = text.toUpperCase().slice(0, 14);
  return Math.max(32, label.length * LABEL_CHAR + 10) / LABEL_HEIGHT;
}

export function disposeTextures() {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
