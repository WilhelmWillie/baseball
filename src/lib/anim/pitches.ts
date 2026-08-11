import { Vector3 } from "three";

/**
 * How a given pitch moves on its way to the plate.
 *
 * The feed tells us where a pitch was released and where it crossed the plate,
 * but nothing about the path between - so every pitch used to travel the same
 * gentle arc and a curveball was indistinguishable from a fastball. What it
 * does tell us is the pitch's *name* and its speed, and that is enough to put
 * the right shape on it.
 *
 * The two numbers below are accelerations, in units of g, felt by the ball on
 * top of its forward motion:
 *
 * - `drop` is how hard it falls. Gravity alone is 1; a four-seamer's backspin
 *   fights it down to a fraction of that, which is why it looks like it rides,
 *   and a curveball's topspin pushes past it.
 * - `run` is the sideways push, positive toward the pitcher's arm side. A
 *   right-hander's sinker runs in on a right-handed hitter; their slider goes
 *   the other way.
 *
 * Treating them as accelerations rather than as fixed offsets is what makes the
 * speed matter for free: displacement goes as the square of the flight time, so
 * the same numbers give a 79 mph curve several times the break of a 97 mph
 * fastball without anything extra.
 */
export interface PitchShape {
  drop: number;
  run: number;
  /** Erratic pitches wander instead of breaking one way. */
  wobble?: number;
  /** Typical velocity, used when the feed does not report one. */
  speed: number;
}

const SHAPES: Array<[RegExp, PitchShape]> = [
  [/knuckle\s*curve|knuckle-curve/, { drop: 1.85, run: -0.35, speed: 82 }],
  [/knuckle/, { drop: 1.0, run: 0, wobble: 1.5, speed: 77 }],
  [/sweeper|slurve/, { drop: 1.15, run: -1.7, speed: 82 }],
  [/curve|deuce/, { drop: 1.95, run: -0.6, speed: 79 }],
  [/slider|cutter|cut fastball/, { drop: 1.1, run: -0.95, speed: 87 }],
  [/split|forkball/, { drop: 1.65, run: 0.3, speed: 87 }],
  [/change|circle/, { drop: 1.3, run: 1.0, speed: 85 }],
  [/screwball/, { drop: 1.15, run: 1.5, speed: 84 }],
  [/eephus|slow curve/, { drop: 2.4, run: 0, speed: 58 }],
  [/sinker|two-seam|2-seam/, { drop: 0.9, run: 1.25, speed: 93 }],
  [/four-seam|4-seam|fastball|heater/, { drop: 0.35, run: 0.25, speed: 95 }],
];

/** Anything unrecognised gets an honest, unremarkable pitch. */
const DEFAULT_SHAPE: PitchShape = { drop: 0.95, run: 0.35, speed: 90 };

export function shapeOf(pitchType: string | undefined): PitchShape {
  if (!pitchType) return DEFAULT_SHAPE;
  const name = pitchType.toLowerCase();
  for (const [pattern, shape] of SHAPES) {
    if (pattern.test(name)) return shape;
  }
  return DEFAULT_SHAPE;
}

/**
 * Reference flight, used to keep the break in sensible units. A pitch that
 * takes this long at one g of drop bows this far off the straight line - so
 * `BOW` is the one dial to turn if the break reads too tame or too cartoonish.
 */
const REFERENCE_TIME = 0.46;
/**
 * Tuned against the batter, not against real feet: the strike zone is about
 * 4.7 world units tall on these figures, so a curveball bowing five units off
 * the straight line arcs through roughly a zone's height on its way in, which
 * is what makes it read as a curveball from the broadcast camera.
 */
const BOW = 1.8;

export interface PitchArc {
  /** Seconds from the ball leaving the hand to it crossing the plate. */
  flightTime: number;
  /** Quadratic control point: the path bows toward this. */
  control: Vector3;
  wobble: number;
}

/**
 * Works out the flight for one pitch.
 *
 * The endpoints are fixed - release and the plate location both come from the
 * feed - so the pitch's identity has to live in the path between them, as how
 * far and which way it bows off the straight line. A quadratic through a
 * control point offset from the midpoint does that, and since a Bezier only
 * travels half way to its control point, the offset is twice the bow we want.
 */
export function pitchArc(
  release: Vector3,
  plate: Vector3,
  pitchType: string | undefined,
  speed: number | undefined,
  hand: "R" | "L",
): PitchArc {
  const shape = shapeOf(pitchType);
  const mph = speed && speed > 40 ? speed : shape.speed;
  // Scaled off the reference so the presentation stays as slow as it is now for
  // a typical fastball, while slower pitches genuinely hang longer.
  const flightTime = clamp((95 / mph) * REFERENCE_TIME, 0.38, 0.78);
  const scale = (flightTime / REFERENCE_TIME) ** 2;

  // Arm side is the side of the rubber the ball is thrown from: negative
  // lateral for a right-hander, matching where `releasePoint` puts their hand.
  const armSide = hand === "R" ? -1 : 1;

  const control = release.clone().lerp(plate, 0.5);
  // A falling pitch bows *above* the straight line, because the line is a chord
  // across a path that is still climbing when it leaves the hand. More drop
  // means more bow, which is why a curve loops and a four-seamer looks flat.
  control.y += shape.drop * BOW * scale * 2;
  control.x += shape.run * armSide * BOW * scale * 2;

  return { flightTime, control, wobble: (shape.wobble ?? 0) * scale };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
