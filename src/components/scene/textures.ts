import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  type Texture,
} from "three";

/**
 * Small canvas textures for jersey numbers and floating name tags. They are
 * drawn at a comfortable resolution and filtered smoothly, so they stay legible
 * rather than reading as pixel art.
 */
const cache = new Map<string, Texture>();

const LABEL_CHAR = 17;
const LABEL_HEIGHT = 44;

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement): Texture {
  const texture = new CanvasTexture(canvas);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Jersey number, painted on the back of the torso block. */
export function getNumberTexture(value: string, background: string, foreground: string): Texture {
  const key = `num:${value}:${background}:${foreground}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 64;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = foreground;
  ctx.font = "bold 40px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value.slice(0, 2), size / 2, size / 2 + 2);

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
  const width = Math.max(64, label.length * LABEL_CHAR + 22);

  const { canvas, ctx } = makeCanvas(width, LABEL_HEIGHT);
  ctx.fillStyle = "rgba(10,12,17,0.9)";
  ctx.fillRect(0, 0, width, LABEL_HEIGHT);
  ctx.fillStyle = accent;
  ctx.fillRect(0, LABEL_HEIGHT - 5, width, 5);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 24px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, LABEL_HEIGHT / 2 - 1);

  const texture = finish(canvas);
  cache.set(key, texture);
  return texture;
}

export function labelAspect(text: string): number {
  const label = text.toUpperCase().slice(0, 14);
  return Math.max(64, label.length * LABEL_CHAR + 22) / LABEL_HEIGHT;
}

export function disposeTextures() {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
