import {
  WALL_HEIGHT,
  fieldRadius,
  wallDistance,
} from "./geometry";

/**
 * Everything vertical in the park - wall, seating bowl, crowd, light towers,
 * scoreboard - as a flat list of boxes drawn in a single InstancedMesh.
 *
 * The playing surface itself is not here: it is built from shaped geometry in
 * `surfaces.ts` so the ground reads as a field rather than a grid of cubes.
 */
export interface Block {
  /** Center position in world space. */
  p: [number, number, number];
  /** Full size on each axis. */
  s: [number, number, number];
  /** Hex color. */
  c: string;
  /** Rotation about Y, radians. */
  r?: number;
}

export const COLORS = {
  grass: "#4b8f3d",
  grassStripe: "#3f7b33",
  foulGrass: "#3b7030",
  dirt: "#a9743f",
  moundDirt: "#b07c45",
  track: "#8d5c31",
  chalk: "#f4f4ee",
  base: "#fbfbf5",
  wall: "#1f5136",
  wallPad: "#1a4530",
  wallCap: "#e8c341",
  pole: "#f4d13d",
  concrete: "#9aa0a6",
  concreteDark: "#848a90",
  seat: "#2f5f8f",
  seatAlt: "#27527d",
  tower: "#70757a",
  lamp: "#fff6c9",
  scoreboard: "#22262b",
  scoreboardFace: "#11161c",
};

const CROWD_COLORS = [
  "#dcdcdc",
  "#e2b07a",
  "#c1503f",
  "#3f6fb5",
  "#e0c452",
  "#4f9f6a",
  "#8b5fb0",
  "#33363b",
  "#e07a3f",
  "#b7bcc2",
];

/** Deterministic noise so the park looks identical on every render. */
function noise(x: number, z: number, salt = 0): number {
  const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 3.719) * 43758.5453;
  return v - Math.floor(v);
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * (1 + amount));
  const g = clamp(((n >> 8) & 255) * (1 + amount));
  const b = clamp((n & 255) * (1 + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Yaw for a block sitting at spray angle `theta`. Field depth maps to -Z, so
 * negating theta puts the block's width along the arc and its depth along the
 * radius.
 */
function yawAt(theta: number): number {
  return -theta;
}

function outfieldWall(blocks: Block[]) {
  const steps = 150;
  for (let i = 0; i <= steps; i++) {
    const theta = -Math.PI / 4 + (i / steps) * (Math.PI / 2);
    const r = wallDistance(theta);
    const width = ((Math.PI / 2) * r) / steps + 0.8;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;

    blocks.push({
      p: [x, WALL_HEIGHT / 2, z],
      s: [width, WALL_HEIGHT, 2.2],
      c: shade(COLORS.wall, (noise(x, z, 2) - 0.5) * 0.06),
      r: yawAt(theta),
    });
    // Padding seam and the yellow line along the top.
    blocks.push({
      p: [x, WALL_HEIGHT * 0.52, z - Math.cos(theta) * 0.1],
      s: [width, 0.35, 2.5],
      c: COLORS.wallPad,
      r: yawAt(theta),
    });
    blocks.push({
      p: [x, WALL_HEIGHT + 0.28, z],
      s: [width, 0.55, 2.6],
      c: COLORS.wallCap,
      r: yawAt(theta),
    });
  }

  for (const side of [-1, 1]) {
    const theta = (side * Math.PI) / 4;
    const r = wallDistance(theta);
    blocks.push({
      p: [Math.sin(theta) * r, 26, -Math.cos(theta) * r],
      s: [1.4, 52, 1.4],
      c: COLORS.pole,
      r: yawAt(theta),
    });
  }
}

/** A raked seating bowl: many shallow steps rather than a few tall blocks. */
function stands(blocks: Block[]) {
  const slices = 210;
  const rows = 16;
  for (let i = 0; i < slices; i++) {
    const theta = (i / slices) * Math.PI * 2 - Math.PI;
    const base = fieldRadius(theta);
    const yaw = yawAt(theta);
    const tangentX = Math.cos(theta);
    const tangentZ = Math.sin(theta);

    for (let row = 0; row < rows; row++) {
      const r = base + 7 + row * 5.2;
      const height = 3.4 + row * 2.05;
      const width = ((Math.PI * 2 * r) / slices) * 1.08;
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;

      blocks.push({
        p: [x, height / 2, z],
        s: [width, height, 5.2],
        c: shade(row % 2 === 0 ? COLORS.concrete : COLORS.concreteDark, (noise(x, z, row) - 0.5) * 0.05),
        r: yaw,
      });
      blocks.push({
        p: [x, height + 0.35, z],
        s: [width, 0.7, 5.2],
        c: row % 3 === 0 ? COLORS.seatAlt : COLORS.seat,
        r: yaw,
      });

      const n = noise(x, z, row);
      if (n > 0.3) {
        const seats = 2 + Math.floor(n * 3);
        for (let s = 0; s < seats; s++) {
          const offset = (s / seats - 0.5) * width * 0.85;
          const c = CROWD_COLORS[Math.floor(noise(x + s * 3.1, z, row + s) * CROWD_COLORS.length)];
          blocks.push({
            p: [x + tangentX * offset, height + 1.5, z + tangentZ * offset],
            s: [1.35, 1.8, 1.35],
            c,
            r: yaw,
          });
        }
      }
    }

    // Facade above the top row, to close off the sky line.
    const rTop = base + 7 + rows * 5.2;
    const widthTop = ((Math.PI * 2 * rTop) / slices) * 1.08;
    blocks.push({
      p: [Math.sin(theta) * rTop, 20, -Math.cos(theta) * rTop],
      s: [widthTop, 40, 3],
      c: shade(COLORS.concreteDark, (noise(theta * 40, 0, 9) - 0.5) * 0.06),
      r: yaw,
    });
  }
}

function lightTowers(blocks: Block[]) {
  // None near dead center: a tower there sits in the broadcast sight line.
  for (const deg of [-74, -40, 40, 74]) {
    const theta = (deg * Math.PI) / 180;
    const r = fieldRadius(theta) + 96;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;
    const yaw = yawAt(theta);
    const tangentX = Math.cos(theta);
    const tangentZ = Math.sin(theta);

    blocks.push({ p: [x, 56, z], s: [3.4, 112, 3.4], c: COLORS.tower, r: yaw });
    blocks.push({ p: [x, 114, z], s: [30, 8, 3], c: COLORS.tower, r: yaw });
    for (let i = -3; i <= 3; i++) {
      blocks.push({
        p: [x + tangentX * i * 4.4, 114, z + tangentZ * i * 4.4],
        s: [3.4, 5.4, 1.4],
        c: COLORS.lamp,
        r: yaw,
      });
    }
  }
}

const SKYLINE_COLORS = ["#93a1b5", "#8593a9", "#9fadbf", "#7b8aa0", "#a8b3c2"];
/** Daylight glass, not lit windows - this is an afternoon game. */
const WINDOW_GLASS = "#c2d3e6";

/**
 * A city beyond the park. Buildings sit on a wide arc well outside the bowl,
 * with the far ring paler than the near one so the depth reads as haze rather
 * than as a flat wall of boxes.
 */
function skyline(blocks: Block[]) {
  const rings = [
    { radius: 880, count: 42, minHeight: 60, maxHeight: 165, haze: 0.08 },
    { radius: 1120, count: 34, minHeight: 55, maxHeight: 205, haze: 0.24 },
    { radius: 1420, count: 26, minHeight: 45, maxHeight: 150, haze: 0.4 },
  ];

  for (const [ringIndex, ring] of rings.entries()) {
    for (let i = 0; i < ring.count; i++) {
      // Skip the wedge directly behind home plate - nothing looks at it.
      const theta = -Math.PI * 0.78 + (i / (ring.count - 1)) * Math.PI * 1.56;
      const jitter = noise(i * 3.7, ringIndex * 11, 21);
      const r = ring.radius + (jitter - 0.5) * 90;
      const height =
        ring.minHeight + noise(i * 5.1, ringIndex * 7, 22) * (ring.maxHeight - ring.minHeight);
      const width = 46 + noise(i * 2.3, ringIndex * 5, 23) * 62;
      const depth = 44 + noise(i * 6.9, ringIndex * 3, 24) * 44;
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;
      const yaw = yawAt(theta) + (jitter - 0.5) * 0.3;

      const base = SKYLINE_COLORS[Math.floor(jitter * SKYLINE_COLORS.length)];
      // Distant buildings wash out toward the sky.
      const body = shade(base, ring.haze * 0.9 + (noise(x, z, 25) - 0.5) * 0.08);

      blocks.push({ p: [x, height / 2, z], s: [width, height, depth], c: body, r: yaw });

      // Setback tier and a mast on the taller ones.
      if (height > 140) {
        blocks.push({
          p: [x, height + 18, z],
          s: [width * 0.55, 36, depth * 0.55],
          c: shade(body, 0.05),
          r: yaw,
        });
        blocks.push({ p: [x, height + 48, z], s: [3, 24, 3], c: shade(body, -0.18), r: yaw });
      }

      // Bands of glass on the nearest ring only - any more and the skyline
      // starts competing with the game for attention.
      if (ringIndex === 0) {
        const rows = Math.max(2, Math.floor(height / 34));
        for (let cy = 0; cy < rows; cy++) {
          if (noise(i * 9.1, cy * 2.7, ringIndex) < 0.45) continue;
          blocks.push({
            p: [x, 22 + (cy / (rows - 1 || 1)) * (height - 40), z],
            s: [width * 0.82, 7, depth + 1.5],
            c: shade(WINDOW_GLASS, -ring.haze * 0.5),
            r: yaw,
          });
        }
      }
    }
  }
}

let cached: Block[] | null = null;

export function buildPark(): Block[] {
  if (cached) return cached;
  const blocks: Block[] = [];
  outfieldWall(blocks);
  stands(blocks);
  lightTowers(blocks);
  skyline(blocks);
  cached = blocks;
  return blocks;
}
