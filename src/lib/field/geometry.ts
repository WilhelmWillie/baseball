import { Vector3 } from "three";

/**
 * Field space
 * ===========
 * All field math is expressed in FEET using two intuitive axes:
 *
 *   lateral -> positive toward RIGHT field (the catcher's right)
 *   depth   -> positive toward CENTER field
 *
 * `fp()` converts that into three.js world space, where the scene is laid out
 * so that a camera sitting behind home plate looks down -Z (three.js' default
 * forward). That keeps "first base appears on the right" true for the
 * broadcast camera, which is the orientation every other camera derives from.
 */
export function fp(lateral: number, depth: number, height = 0): Vector3 {
  return new Vector3(lateral, height, -depth);
}

/** Inverse of {@link fp} - world space back into field space. */
export function toField(v: Vector3): { lateral: number; depth: number } {
  return { lateral: v.x, depth: -v.z };
}

export const BASE_DIST = 90;
/** Half the diagonal of the diamond: home -> first is 90ft at 45 degrees. */
export const HALF_DIAG = BASE_DIST / Math.SQRT2; // 63.6396...

export const RUBBER_DEPTH = 60.5;
export const MOUND_DEPTH = 59;
export const MOUND_RADIUS = 9;
export const MOUND_HEIGHT = 10 / 12;

export const HOME_PLATE = fp(0, 0);
export const FIRST_BASE = fp(HALF_DIAG, HALF_DIAG);
export const SECOND_BASE = fp(0, 2 * HALF_DIAG);
export const THIRD_BASE = fp(-HALF_DIAG, HALF_DIAG);
export const PITCHERS_RUBBER = fp(0, RUBBER_DEPTH, MOUND_HEIGHT);

export type BaseId = "home" | "first" | "second" | "third";

export const BASE_POSITIONS: Record<BaseId, Vector3> = {
  home: HOME_PLATE,
  first: FIRST_BASE,
  second: SECOND_BASE,
  third: THIRD_BASE,
};

/** The order a runner travels. */
export const BASE_ORDER: BaseId[] = ["home", "first", "second", "third"];

export function baseIndex(base: BaseId): number {
  return BASE_ORDER.indexOf(base);
}

/**
 * Where a runner stands when waiting on a base - a step off the bag toward the
 * next one, so the model doesn't z-fight with the base itself.
 */
export function standingSpot(base: BaseId): Vector3 {
  const here = BASE_POSITIONS[base];
  const nextIdx = (baseIndex(base) + 1) % 4;
  const next = BASE_POSITIONS[BASE_ORDER[nextIdx]];
  return here.clone().lerp(next, 0.06);
}

/**
 * Outfield wall distance for a given spray angle.
 * theta is in radians: 0 = straightaway center, negative = left field,
 * positive = right field. +/- PI/4 are the foul poles.
 */
const WALL_PROFILE: Array<[deg: number, feet: number]> = [
  [-45, 331],
  [-30, 371],
  [-15, 398],
  [0, 404],
  [15, 396],
  [30, 368],
  [45, 327],
];

export function wallDistance(theta: number): number {
  const deg = Math.max(-45, Math.min(45, (theta * 180) / Math.PI));
  for (let i = 0; i < WALL_PROFILE.length - 1; i++) {
    const [d0, f0] = WALL_PROFILE[i];
    const [d1, f1] = WALL_PROFILE[i + 1];
    if (deg >= d0 && deg <= d1) {
      const t = (deg - d0) / (d1 - d0);
      return f0 + (f1 - f0) * t;
    }
  }
  return 400;
}

export const WALL_HEIGHT = 9;
export const WARNING_TRACK = 16;

/**
 * Radius of the playable surface at a given angle, including foul ground.
 * Beyond the foul poles the surface tapers in toward the backstop.
 */
export function fieldRadius(theta: number): number {
  const abs = Math.abs(theta);
  const quarter = Math.PI / 4;
  if (abs <= quarter) return wallDistance(theta);
  const t = (abs - quarter) / (Math.PI - quarter); // 0 at the pole, 1 behind the plate
  const backstop = 62;
  const atPole = wallDistance(quarter);
  return backstop + (atPole - backstop) * Math.pow(1 - t, 4);
}

/** Spray angle of a point in field space (0 = center, +/- PI/4 = the poles). */
export function sprayAngle(lateral: number, depth: number): number {
  return Math.atan2(lateral, depth);
}

export function isFairTerritory(lateral: number, depth: number): boolean {
  return depth > 0 && Math.abs(lateral) <= depth + 1e-6;
}

/** Inside the square of grass ringed by the base paths. */
export function isInfieldGrass(lateral: number, depth: number, inset = 6): boolean {
  return Math.abs(lateral) + Math.abs(depth - HALF_DIAG) <= HALF_DIAG - inset;
}

/** The arc of dirt the infielders play on. */
export const INFIELD_ARC_RADIUS = 95;

export function distanceToMound(lateral: number, depth: number): number {
  return Math.hypot(lateral, depth - MOUND_DEPTH);
}

/** Distance from a point to the nearest base path segment. */
export function distanceToBasePaths(lateral: number, depth: number): number {
  const pts: Array<[number, number]> = [
    [0, 0],
    [HALF_DIAG, HALF_DIAG],
    [0, 2 * HALF_DIAG],
    [-HALF_DIAG, HALF_DIAG],
  ];
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % 4];
    best = Math.min(best, distanceToSegment(lateral, depth, ax, az, bx, bz));
  }
  return best;
}

function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export type PositionKey =
  | "pitcher"
  | "catcher"
  | "first"
  | "second"
  | "third"
  | "shortstop"
  | "left"
  | "center"
  | "right";

export const POSITION_KEYS: PositionKey[] = [
  "pitcher",
  "catcher",
  "first",
  "second",
  "third",
  "shortstop",
  "left",
  "center",
  "right",
];

/** MLB scorekeeping position codes -> our defensive slots. */
export const POSITION_CODE_TO_KEY: Record<string, PositionKey> = {
  "1": "pitcher",
  "2": "catcher",
  "3": "first",
  "4": "second",
  "5": "third",
  "6": "shortstop",
  "7": "left",
  "8": "center",
  "9": "right",
};

export const POSITION_ABBREV: Record<PositionKey, string> = {
  pitcher: "P",
  catcher: "C",
  first: "1B",
  second: "2B",
  third: "3B",
  shortstop: "SS",
  left: "LF",
  center: "CF",
  right: "RF",
};

/** Standard, no-shift defensive alignment. */
export const FIELDING_SPOTS: Record<PositionKey, Vector3> = {
  pitcher: fp(0, RUBBER_DEPTH - 2, MOUND_HEIGHT),
  catcher: fp(0, -6.5),
  first: fp(52, 79),
  second: fp(38, 129),
  third: fp(-52, 81),
  shortstop: fp(-40, 128),
  left: fp(-132, 262),
  center: fp(0, 316),
  right: fp(132, 262),
};

/** Batter's box. A right-handed hitter stands on the third-base side. */
export function batterSpot(batSide: "R" | "L"): Vector3 {
  return fp(batSide === "R" ? -3.9 : 3.9, 2.2);
}

export function onDeckSpot(batSide: "R" | "L"): Vector3 {
  return fp(batSide === "R" ? -34 : 34, -14);
}

/**
 * Gameday hit coordinates come from a 2D field diagram. These constants are the
 * long-established mapping from that diagram back into feet.
 */
const HC_ORIGIN_X = 125.42;
const HC_ORIGIN_Y = 198.27;
const HC_SCALE = 2.29;

export function hitCoordinatesToField(coordX: number, coordY: number): {
  lateral: number;
  depth: number;
} {
  return {
    lateral: (coordX - HC_ORIGIN_X) * HC_SCALE,
    depth: (HC_ORIGIN_Y - coordY) * HC_SCALE,
  };
}

/** Clamp a landing spot so a bad coordinate can never put the ball off-world. */
export function clampToField(lateral: number, depth: number): { lateral: number; depth: number } {
  const theta = sprayAngle(lateral, depth);
  const r = Math.hypot(lateral, depth);
  const max = fieldRadius(theta) - 4;
  if (r <= max || r === 0) return { lateral, depth };
  const scale = max / r;
  return { lateral: lateral * scale, depth: depth * scale };
}

/** Which defender is closest to a spot - used to pick who fields the ball. */
export function nearestFielder(lateral: number, depth: number): PositionKey {
  let best: PositionKey = "center";
  let bestDist = Infinity;
  for (const key of POSITION_KEYS) {
    const spot = FIELDING_SPOTS[key];
    const d = Math.hypot(spot.x - lateral, -spot.z - depth);
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  return best;
}
