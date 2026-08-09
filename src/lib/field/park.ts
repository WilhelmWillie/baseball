import {
  BASE_POSITIONS,
  DUGOUT_SPOTS,
  HALF_DIAG,
  INFIELD_ARC_RADIUS,
  MOUND_DEPTH,
  MOUND_RADIUS,
  RUBBER_DEPTH,
  WALL_HEIGHT,
  WARNING_TRACK,
  distanceToBasePaths,
  distanceToMound,
  fieldRadius,
  isFairTerritory,
  isInfieldGrass,
  sprayAngle,
  wallDistance,
} from "./geometry";

/**
 * The whole park is one big pile of blocks. Everything below produces entries
 * in a single list which the renderer draws with one InstancedMesh, so the
 * stadium costs a single draw call no matter how much detail we pile on.
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

const TILE = 6;
const FIELD_LIMIT = 470;

const COLORS = {
  grassLight: "#4f9740",
  grassDark: "#427f36",
  foulGrass: "#3d7331",
  dirt: "#a9743f",
  moundDirt: "#b3814b",
  track: "#8a5a2f",
  chalk: "#f2f2ea",
  base: "#fbfbf5",
  wall: "#24583a",
  wallCap: "#e8c341",
  pole: "#f4d13d",
  concrete: "#9a9da1",
  concreteDark: "#85888c",
  seat: "#31628f",
  tower: "#6b6e72",
  lamp: "#fff6c9",
  dugoutWall: "#5a5e63",
  dugoutRoof: "#474b50",
};

const CROWD_COLORS = [
  "#d8d8d8",
  "#e2b07a",
  "#c1503f",
  "#3f6fb5",
  "#e0c452",
  "#4f9f6a",
  "#8b5fb0",
  "#2d2f33",
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

function surfaceTiles(blocks: Block[]) {
  for (let lateral = -FIELD_LIMIT; lateral <= FIELD_LIMIT; lateral += TILE) {
    for (let depth = -FIELD_LIMIT; depth <= FIELD_LIMIT; depth += TILE) {
      const theta = sprayAngle(lateral, depth);
      const r = Math.hypot(lateral, depth);
      const limit = fieldRadius(theta);
      if (r > limit + 12) continue;
      if (r > limit) {
        blocks.push({
          p: [lateral, -0.5, -depth],
          s: [TILE, 1, TILE],
          c: shade(COLORS.concreteDark, (noise(lateral, depth, 5) - 0.5) * 0.08),
        });
        continue;
      }

      const fair = isFairTerritory(lateral, depth);
      const mound = distanceToMound(lateral, depth);
      const paths = distanceToBasePaths(lateral, depth);

      let color: string;
      let lift = 0;

      if (mound < MOUND_RADIUS) {
        color = COLORS.moundDirt;
        lift = mound < MOUND_RADIUS * 0.55 ? 0.85 : 0.45;
      } else if (r < 13) {
        color = COLORS.dirt;
      } else if (paths < 4.5) {
        color = COLORS.dirt;
      } else if (fair && mound < INFIELD_ARC_RADIUS && !isInfieldGrass(lateral, depth)) {
        color = COLORS.dirt;
      } else if (r > limit - WARNING_TRACK) {
        color = COLORS.track;
      } else if (!fair) {
        color = COLORS.foulGrass;
      } else {
        // Mowed bands, like a real outfield.
        color = Math.floor(depth / 34) % 2 === 0 ? COLORS.grassLight : COLORS.grassDark;
      }

      const jitter = (noise(lateral, depth) - 0.5) * 0.1;
      blocks.push({
        p: [lateral, lift - 0.5, -depth],
        s: [TILE, 1, TILE],
        c: shade(color, jitter),
      });
    }
  }
}

function chalkAndBases(blocks: Block[]) {
  // Foul lines out to the poles.
  for (const side of [-1, 1]) {
    const angle = (side * Math.PI) / 4;
    const length = wallDistance(angle);
    for (let d = 4; d < length; d += 4) {
      blocks.push({
        p: [Math.sin(angle) * d, 0.06, -Math.cos(angle) * d],
        s: [1.1, 0.14, 4],
        c: COLORS.chalk,
        r: -angle,
      });
    }
  }

  // Batter's boxes and the catcher's box.
  for (const side of [-1, 1]) {
    const cx = side * 3.9;
    for (const [dx, dz, sx, sz] of [
      [0, 3, 4.2, 0.5],
      [0, -3, 4.2, 0.5],
      [-2.1, 0, 0.5, 6],
      [2.1, 0, 0.5, 6],
    ]) {
      blocks.push({
        p: [cx + dx, 0.06, -(2.2 + dz)],
        s: [sx, 0.14, sz],
        c: COLORS.chalk,
      });
    }
  }

  // Bags.
  for (const base of ["first", "second", "third"] as const) {
    const p = BASE_POSITIONS[base];
    blocks.push({ p: [p.x, 0.3, p.z], s: [2.4, 0.6, 2.4], c: COLORS.base, r: Math.PI / 4 });
  }
  blocks.push({ p: [0, 0.24, 0], s: [2.2, 0.48, 2.2], c: COLORS.base });
  blocks.push({
    p: [0, 1.05, -RUBBER_DEPTH],
    s: [2.6, 0.3, 0.7],
    c: COLORS.base,
  });
}

function outfieldWall(blocks: Block[]) {
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const theta = -Math.PI / 4 + (i / steps) * (Math.PI / 2);
    const r = wallDistance(theta);
    const width = ((Math.PI / 2) * r) / steps + 1.2;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;
    blocks.push({
      p: [x, WALL_HEIGHT / 2, z],
      s: [width, WALL_HEIGHT, 2],
      c: shade(COLORS.wall, (noise(x, z, 2) - 0.5) * 0.12),
      r: -theta,
    });
    blocks.push({
      p: [x, WALL_HEIGHT + 0.3, z],
      s: [width, 0.6, 2.4],
      c: COLORS.wallCap,
      r: -theta,
    });
  }

  // Foul poles.
  for (const side of [-1, 1]) {
    const theta = (side * Math.PI) / 4;
    const r = wallDistance(theta);
    blocks.push({
      p: [Math.sin(theta) * r, 24, -Math.cos(theta) * r],
      s: [1.6, 48, 1.6],
      c: COLORS.pole,
      r: -theta,
    });
  }
}

function stands(blocks: Block[]) {
  const slices = 150;
  const rows = 9;
  for (let i = 0; i < slices; i++) {
    const theta = (i / slices) * Math.PI * 2 - Math.PI;
    const base = fieldRadius(theta);
    for (let row = 0; row < rows; row++) {
      const r = base + 10 + row * 7.5;
      const height = 4 + row * 2.9;
      const width = ((Math.PI * 2 * r) / slices) * 1.06;
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;

      blocks.push({
        p: [x, height / 2, z],
        s: [width, height, 7.5],
        c: row % 2 === 0 ? COLORS.concrete : COLORS.concreteDark,
        r: -theta,
      });
      blocks.push({
        p: [x, height + 0.4, z],
        s: [width, 0.8, 7.5],
        c: COLORS.seat,
        r: -theta,
      });

      // Crowd.
      const n = noise(x, z, row);
      if (n > 0.34) {
        const seats = 2 + Math.floor(n * 3);
        for (let s = 0; s < seats; s++) {
          const offset = (s / seats - 0.5) * width * 0.8;
          const c = CROWD_COLORS[Math.floor(noise(x + s * 3.1, z, row + s) * CROWD_COLORS.length)];
          blocks.push({
            p: [
              x + Math.cos(theta) * offset,
              height + 1.9,
              z + Math.sin(theta) * offset,
            ],
            s: [1.7, 2.2, 1.7],
            c,
            r: -theta,
          });
        }
      }
    }
  }
}

function lightTowers(blocks: Block[]) {
  // Deliberately none near dead center - a tower there sits right in the
  // broadcast camera's sight line.
  for (const deg of [-72, -38, 38, 72]) {
    const theta = (deg * Math.PI) / 180;
    const r = fieldRadius(theta) + 86;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;
    const tangentX = Math.cos(theta);
    const tangentZ = Math.sin(theta);
    blocks.push({ p: [x, 48, z], s: [4, 96, 4], c: COLORS.tower, r: -theta });
    blocks.push({ p: [x, 100, z], s: [28, 9, 4], c: COLORS.tower, r: -theta });
    for (let i = -2; i <= 2; i++) {
      blocks.push({
        p: [x + tangentX * i * 5.4, 100, z + tangentZ * i * 5.4],
        s: [4, 6, 1.6],
        c: COLORS.lamp,
        r: -theta,
      });
    }
  }
}

/**
 * Dugouts sit just outside each foul line, matching where the bench players
 * stand. They are open-topped so the bench stays visible from above.
 */
function dugouts(blocks: Block[]) {
  for (const side of [-1, 1]) {
    const theta = (side * Math.PI) / 4;
    const center = DUGOUT_SPOTS[side < 0 ? "home" : "away"];
    const cx = center.x;
    const cz = center.z;
    // Outward normal, pointing away from fair territory.
    const nx = Math.sin(theta);
    const nz = -Math.cos(theta);

    // Low rail between the dugout and the field.
    blocks.push({
      p: [cx - nx * 12, 1.4, cz - nz * 12],
      s: [46, 2.8, 1.6],
      c: COLORS.dugoutWall,
      r: -theta,
    });
    // Back wall, kept low so the bench stays visible from above.
    blocks.push({
      p: [cx + nx * 12, 2.4, cz + nz * 12],
      s: [46, 4.8, 1.6],
      c: COLORS.dugoutRoof,
      r: -theta,
    });
    // Bench slab.
    blocks.push({
      p: [cx + nx * 8, 0.7, cz + nz * 8],
      s: [44, 1.4, 4],
      c: COLORS.dugoutWall,
      r: -theta,
    });
  }
}

let cached: Block[] | null = null;

export function buildPark(): Block[] {
  if (cached) return cached;
  const blocks: Block[] = [];
  surfaceTiles(blocks);
  chalkAndBases(blocks);
  outfieldWall(blocks);
  stands(blocks);
  lightTowers(blocks);
  dugouts(blocks);
  cached = blocks;
  return blocks;
}

export const PARK_CONSTANTS = { TILE, HALF_DIAG, MOUND_DEPTH };
