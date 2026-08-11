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

function labelWidth(text: string): number {
  return Math.max(72, text.slice(0, 14).length * LABEL_CHAR + 34);
}

/** Floating name tag: a little cream pill in the club's colour. */
export function getLabelTexture(text: string, accent: string): Texture {
  const key = `label:${text}:${accent}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const label = text.slice(0, 14);
  const width = labelWidth(label);

  const { canvas, ctx } = makeCanvas(width, LABEL_HEIGHT);
  const inset = 4;
  const radius = (LABEL_HEIGHT - inset * 2) / 2;
  ctx.beginPath();
  ctx.roundRect(inset, inset, width - inset * 2, LABEL_HEIGHT - inset * 2, radius);
  ctx.fillStyle = "rgba(255,252,245,0.96)";
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = "#4a3524";
  ctx.font = '700 23px ui-rounded, "SF Pro Rounded", Nunito, system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, LABEL_HEIGHT / 2);

  const texture = finish(canvas);
  cache.set(key, texture);
  return texture;
}

export function labelAspect(text: string): number {
  return labelWidth(text.slice(0, 14)) / LABEL_HEIGHT;
}

export function disposeTextures() {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
