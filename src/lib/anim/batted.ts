import { Vector3 } from "three";
import {
  FIELDING_SPOTS,
  INFIELD_ARC_RADIUS,
  clampToField,
  fp,
  nearestFielder,
  sprayAngle,
  toField,
  type PositionKey,
} from "@/lib/field/geometry";
import type { BattedBall } from "@/lib/game/types";

/**
 * Batted-ball flight
 * ==================
 *
 * Every ball in play used to be the same shape: one parabola from the bat to
 * the spot MLB reported, a pair of hops, and whoever was standing nearest
 * picked it up. A line drive, a chopper through the hole and a ball in the gap
 * all read identically - arc up, come down at a fielder's feet, get collected -
 * which is the one thing a batted ball must never do, because the *shape* of it
 * is how a viewer knows what happened before the call goes up.
 *
 * What separates them is where the ball stops being in the air. A fly ball is a
 * hang-time story: three seconds up, and the only question is whether somebody
 * gets under it. A line drive is over in a blink and lands hard and shallow. A
 * ground ball is barely airborne at all - it is on the dirt inside forty feet,
 * and everything after that is a skidding, decaying bounce. So a batted ball
 * here is two phases rather than one: a **carry** from the bat to first touch,
 * and a **run-out** from there to wherever it is gathered. Each trajectory gets
 * its own share of the two, and the launch angle the feed gives us sets the
 * height of the arc rather than a constant per trajectory.
 *
 * The second half of the problem is that a hit has to *beat* somebody. MLB's
 * coordinate is where the ball was fielded, so carrying the ball all the way to
 * it in the air drops every single softly into a fielder's lap. A ground-ball
 * hit now touches down in the infield and skips past the infielder who dives at
 * it, and whoever ends up with the ball has to run it down rather than standing
 * where it was always going to land.
 */

const DEG = Math.PI / 180;

/** Where the ball sits when it is lying on the grass, and glove height. */
export const BALL_RADIUS = 0.45;
export const GLOVE_HEIGHT = 5.4;

/**
 * How fast a defender closes on a ball, in feet per second, and the beat they
 * lose reading it off the bat. Quicker than a real sprint, like everything else
 * out here, but slow enough that a ball in the gap visibly costs more than one
 * hit right at somebody.
 */
const CHASE_SPEED = 34;
const CHASE_REACT = 0.25;
/** The longest the run-out will stretch to let a defender catch up to it. */
const CHASE_PATIENCE = 1.9;

/**
 * Past this far out the ball belongs to an outfielder, whoever happens to be
 * nearest. `nearestFielder` hands a single through the hole back to the
 * shortstop it just went past, because the outfielders play a hundred feet
 * deeper than anything but a well-struck ball ever reaches.
 */
const OUTFIELD_HANDOFF = INFIELD_ARC_RADIUS + 55;

type Trajectory = NonNullable<BattedBall["trajectory"]>;

interface Profile {
  /** Feet per second the ball covers on its way to first touch. */
  speed: number;
  /** Where the top of the arc sits, 0..1 through the carry. */
  peak: number;
  /** Share of the fielded distance the ball covers in the air. */
  carry: number;
  /** Bounds on that carry, in feet. */
  carryRange: [min: number, max: number];
  /** Exaggeration applied to the ballistic apex - see {@link apexOf}. */
  loft: number;
  /** Bounds on the apex, in feet. */
  apex: [min: number, max: number];
  /** Bounds on the time from the bat to first touch, in seconds. */
  hang: [min: number, max: number];
  /** How high the first bounce carries when the ball is struck softly. */
  hop: number;
  /** Extra ground the ball steals past the reported spot, as a share of it. */
  skip: number;
}

/**
 * The per-trajectory character of a batted ball.
 *
 * `carry` is the load-bearing number. A fly ball is reported where it came
 * down, so it carries the whole way; a ground ball is reported where it was
 * *fielded*, tens of feet past where it first met the dirt, so it carries a
 * third of the distance and skids the rest. A line drive sits between the two:
 * hit flat, down early, and still going when it gets there.
 */
const PROFILES: Record<Trajectory, Profile> = {
  ground_ball: {
    speed: 96,
    peak: 0.5,
    carry: 0.3,
    carryRange: [12, 78],
    loft: 1,
    apex: [0.8, 5],
    hang: [0.4, 1.1],
    hop: 7,
    skip: 0,
  },
  bunt: {
    speed: 42,
    peak: 0.5,
    carry: 0.5,
    carryRange: [6, 30],
    loft: 1,
    apex: [0.6, 4],
    hang: [0.4, 1.1],
    hop: 5,
    skip: 0,
  },
  line_drive: {
    speed: 128,
    peak: 0.42,
    carry: 0.78,
    carryRange: [45, 320],
    loft: 1,
    apex: [5, 20],
    hang: [0.75, 2.4],
    hop: 11,
    skip: 0.08,
  },
  fly_ball: {
    speed: 90,
    peak: 0.5,
    carry: 1,
    carryRange: [60, 430],
    loft: 1.5,
    apex: [26, 95],
    hang: [1.9, 3.7],
    hop: 5,
    skip: 0.04,
  },
  popup: {
    speed: 52,
    peak: 0.5,
    carry: 1,
    carryRange: [20, 260],
    loft: 2.4,
    apex: [55, 105],
    hang: [2.6, 4.1],
    hop: 4,
    skip: 0.02,
  },
  unknown: {
    speed: 104,
    peak: 0.48,
    carry: 0.82,
    carryRange: [30, 430],
    loft: 1.4,
    apex: [6, 70],
    hang: [0.9, 3],
    hop: 8,
    skip: 0.05,
  },
};

/** A ball hit out of the park is its own thing: it never comes down in play. */
const HOME_RUN: Profile = {
  speed: 105,
  peak: 0.46,
  carry: 1,
  carryRange: [200, 520],
  loft: 2.2,
  apex: [70, 128],
  hang: [3.4, 4.6],
  hop: 0,
  skip: 0,
};

/** Height the ball is still carrying as it crosses the wall. */
const WALL_CLEARANCE = 24;

const INFIELD_KEYS: PositionKey[] = ["pitcher", "first", "second", "third", "shortstop"];

/** How close a low ball has to pass for an infielder to lay out at it. */
const DIVE_REACH = 26;
/** How far short of the ball the dive comes up. */
const DIVE_MISS = 4.5;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * A hump that leaves the ground at 0, tops out at `peak` and returns to 0.
 *
 * The peak position is what a parabola cannot give you and what the whole
 * vocabulary rests on. `4u(1-u)` always tops out halfway, so a line drive
 * climbed for as long as it fell - the lazy, symmetric shape of a fly ball. A
 * quarter-sine up and a quarter-cosine down puts the top wherever it belongs:
 * early for a ball hit flat, which then runs out on a long shallow tail that
 * steepens as it sinks, and dead centre for one hit into the sky.
 */
function arcShape(u: number, peak: number): number {
  if (u <= 0 || u >= 1) return 0;
  return u < peak
    ? Math.sin((u / peak) * (Math.PI / 2))
    : Math.cos(((u - peak) / (1 - peak)) * (Math.PI / 2));
}

/**
 * How hard the ball was struck, 0..1. Drives the flatness of the bounce, how
 * far the ball skids, the dust it throws and the knock on the lens.
 */
export function heatOf(ball: BattedBall): number {
  if (typeof ball.launchSpeed === "number") {
    return clamp01((ball.launchSpeed - 70) / 42);
  }
  return clamp01(Math.hypot(ball.lateral, ball.depth) / 330);
}

/**
 * Apex of the carry, in feet.
 *
 * A projectile that travels `d` feet leaving at `angle` tops out at
 * `d * tan(angle) / 4`, which is the shape the launch angle is actually
 * describing. It is then multiplied up, because this park trades physical
 * scale for readability from a camera eighty feet in the air - and by *less*
 * for a line drive than for a fly ball, since being flat is the whole point of
 * one and being enormous is the whole point of the other.
 */
function apexOf(profile: Profile, carryDistance: number, launchAngle?: number): number {
  const [lo, hi] = profile.apex;
  if (typeof launchAngle === "number" && launchAngle > 1) {
    const ballistic = (carryDistance * Math.tan(Math.min(launchAngle, 72) * DEG)) / 4;
    return clamp(ballistic * profile.loft, lo, hi);
  }
  // No launch angle in the feed: fall back to distance, which at least tells
  // the difference between a nubber and a ball to the track.
  return lo + (hi - lo) * clamp01(carryDistance / 320);
}

/** One leg of the run-out: a hop, or the roll that finishes it. */
interface Segment {
  /** Seconds from contact at which this leg begins. */
  start: number;
  duration: number;
  /** Feet along the run-out at which it begins, and how far it covers. */
  from: number;
  length: number;
  /** Top of the hop; 0 once the ball is rolling. */
  height: number;
}

/** Energy kept across a bounce, and the bite the grass takes each time. */
const RESTITUTION = 0.4;
const FRICTION = 0.66;
const HOPS = 3;

/**
 * Three decaying hops and a roll, fitted to the ground and the time available.
 *
 * The hops are laid out ballistically and then normalised rather than
 * simulated: a hop of height `h` is in the air for `sqrt(h)` and covers ground
 * at whatever speed the grass has left it with, so the first one is long and
 * fast and each one after is shorter, lower and slower. The roll on the end
 * covers little ground and takes its time doing it, which is what stops a ball
 * in the gap from arriving as if it were still being hit.
 */
function runOut(
  remaining: number,
  rollTime: number,
  extra: number,
  firstHop: number,
  carryTime: number,
): Segment[] {
  const raw: Array<{ length: number; time: number; height: number }> = [];
  let height = Math.max(firstHop, 0.4);
  let speed = 1;
  for (let i = 0; i < HOPS; i++) {
    const time = Math.sqrt(height);
    raw.push({ time, length: time * speed, height });
    height *= RESTITUTION;
    speed *= FRICTION;
  }
  raw.push({ time: 2.2, length: speed * 1.9, height: 0 });

  const totalLength = raw.reduce((sum, r) => sum + r.length, 0) || 1;
  const totalTime = raw.reduce((sum, r) => sum + r.time, 0) || 1;

  const segments: Segment[] = [];
  let start = carryTime;
  let from = 0;
  for (const r of raw) {
    const length = (r.length / totalLength) * remaining;
    // Any wait for a defender is spent trickling, never bouncing: the hops
    // happen at the speed they happen at, and the roll on the end is what
    // stretches. A ball held in slow motion mid-bounce reads as a bug.
    const duration = (r.time / totalTime) * rollTime + (r.height > 0 ? 0 : extra);
    segments.push({ start, duration, from, length, height: r.height });
    start += duration;
    from += length;
  }
  return segments;
}

/**
 * The outfielder standing behind a given spray angle. Anything that reaches the
 * grass belongs to one of them: `nearestFielder` would hand a single through
 * the hole back to the shortstop it just went past, because the outfielders
 * play two hundred feet deeper than the ball ever gets.
 */
function outfielderFor(theta: number): PositionKey {
  if (theta < -0.234) return "left";
  if (theta > 0.234) return "right";
  return "center";
}

export interface BeatenFielder {
  key: PositionKey;
  /** Where they come up short, a stride off the ball's line. */
  spot: Vector3;
  /** When the ball goes by, in seconds from contact. */
  at: number;
}

export interface BattedPlan {
  /** Seconds from contact to first touch - the catch, or the dirt. */
  carryTime: number;
  /** Seconds from contact until a defender has the ball in hand. */
  gatherTime: number;
  /** Where the ball first comes down. */
  landing: Vector3;
  /** Where it finishes, after the hops and the roll. */
  rest: Vector3;
  /** True when it never reached the grass. */
  caught: boolean;
  /** Who ends up with it. */
  fielder: PositionKey;
  /** Seconds from contact at which the ball strikes the dirt. */
  bounces: number[];
  /** Top of the carry, in feet. */
  apex: number;
  /** How hard it was struck, 0..1. */
  heat: number;
  /** An infielder the ball goes past, who lays out at it and misses. */
  beaten: BeatenFielder | null;
  /**
   * Ball position at `t` seconds after contact. The returned vector is reused
   * between calls - copy it, do not hold it.
   */
  at(t: number): Vector3;
}

export interface BattedOptions {
  /** Where the bat met the ball. */
  contact: Vector3;
  /** The defence caught it on the fly. */
  caught: boolean;
  /** The batter got a hit out of it, so the ball has to beat somebody. */
  hit: boolean;
}

/**
 * Work out everything about one batted ball: how long it is up, where it lands,
 * how it behaves once it is down, who runs it down and who it beats getting
 * there.
 */
export function planBattedBall(ball: BattedBall, opts: BattedOptions): BattedPlan {
  const profile = ball.isHomeRun ? HOME_RUN : PROFILES[ball.trajectory ?? "unknown"];
  const heat = heatOf(ball);
  const { contact, caught } = opts;

  // The reported spot, and how far out it is. `ball.distance` can be MLB's
  // tracked carry, which is not always the distance to the coordinate we are
  // animating to, so the geometry comes from the coordinate itself.
  const reach = Math.max(6, Math.hypot(ball.lateral, ball.depth));

  const carryDistance = caught
    ? reach
    : clamp(reach * profile.carry, Math.min(profile.carryRange[0], reach), Math.min(profile.carryRange[1], reach));
  const carryFraction = carryDistance / reach;
  const landing = fp(ball.lateral * carryFraction, ball.depth * carryFraction);

  const apex = apexOf(profile, carryDistance, ball.launchAngle);
  const carryTime = clamp(carryDistance / profile.speed, profile.hang[0], profile.hang[1]);

  // Where it finishes. A ball that is caught, or gone, stops where it arrives;
  // everything else keeps going - through the rest of the distance it did not
  // carry, plus whatever it steals past the reported spot on the bounce.
  let rest = landing.clone();
  if (!caught && !ball.isHomeRun) {
    // Whatever it did not carry, plus what it steals past the reported spot on
    // the bounce. The reported spot is where the ball was *fielded*, so for a
    // ground ball that is already the end of the roll and there is nothing to
    // add; a ball hit in the air is reported where it came down and is still
    // going when it gets there.
    const restDistance = reach * (1 + profile.skip * (0.5 + heat));
    const spot = clampToField(
      (ball.lateral / reach) * restDistance,
      (ball.depth / reach) * restDistance,
    );
    rest = fp(spot.lateral, spot.depth);
  }

  // Who gets it. An outfielder charging in from two hundred and sixty feet is
  // the whole difference between a single that beat the defence and a ball hit
  // straight at somebody.
  const restField = toField(rest);
  const fielder =
    Math.hypot(restField.lateral, restField.depth) > OUTFIELD_HANDOFF
      ? outfielderFor(sprayAngle(restField.lateral, restField.depth))
      : caught
        ? ball.fielder
        : nearestFielder(restField.lateral, restField.depth);

  const remaining = rest.distanceTo(landing);
  // Bouncing and rolling out. A ball hit with something on it skids low and
  // fast; a soft one hops up and dies in the grass. A ball nobody is near yet
  // keeps trickling until they get there, rather than lying in the outfield
  // waiting to be collected.
  const natural = remaining > 0.5 ? clamp(remaining / (52 + 58 * heat), 0.35, 2.3) : 0;
  const chase = CHASE_REACT + FIELDING_SPOTS[fielder].distanceTo(rest) / CHASE_SPEED;
  const rollTime =
    natural > 0 ? clamp(chase - carryTime, natural, natural + CHASE_PATIENCE) : 0;
  const segments =
    rollTime > 0
      ? runOut(remaining, natural, rollTime - natural, profile.hop * (1 - 0.55 * heat), carryTime)
      : [];

  const settleTime = carryTime + rollTime;
  // A ball caught on the fly is had the moment it is caught; anything else
  // waits on whoever is running it down, but not forever.
  const gatherTime =
    caught || ball.isHomeRun
      ? carryTime
      : Math.max(settleTime, Math.min(chase, settleTime + 0.5));

  const endHeight = ball.isHomeRun ? WALL_CLEARANCE : caught ? GLOVE_HEIGHT : BALL_RADIUS;
  const scratch = new Vector3();

  const positionAt = (t: number, out: Vector3): Vector3 => {
    if (t <= 0) return out.copy(contact);
    if (t < carryTime || segments.length === 0) {
      const u = clamp01(t / carryTime);
      const height =
        contact.y + (endHeight - contact.y) * u + apex * arcShape(u, profile.peak);
      return out.set(
        contact.x + (landing.x - contact.x) * u,
        Math.max(endHeight, height),
        contact.z + (landing.z - contact.z) * u,
      );
    }
    const last = segments[segments.length - 1];
    if (t >= last.start + last.duration) return out.copy(rest).setY(BALL_RADIUS);

    let segment = last;
    for (const candidate of segments) {
      if (t < candidate.start + candidate.duration) {
        segment = candidate;
        break;
      }
    }
    const s = clamp01((t - segment.start) / Math.max(0.001, segment.duration));
    // The hops run at a constant clip; the roll on the end eases to a stop.
    const along = segment.from + segment.length * (segment.height > 0 ? s : easeOut(s));
    const u = clamp01(along / Math.max(0.001, remaining));
    return out.set(
      landing.x + (rest.x - landing.x) * u,
      BALL_RADIUS + segment.height * Math.sin(Math.PI * s),
      landing.z + (rest.z - landing.z) * u,
    );
  };

  const bounces = segments.filter((s) => s.height > 0).map((s) => s.start);

  return {
    carryTime,
    gatherTime,
    landing,
    rest,
    caught,
    fielder,
    bounces,
    apex,
    heat,
    beaten: opts.hit ? beatenFielder(fielder, apex, gatherTime, positionAt) : null,
    at: (t: number) => positionAt(t, scratch),
  };
}

/**
 * The infielder a ball goes past.
 *
 * Only balls that stay low get one: nobody lays out at a fly ball. The path is
 * sampled rather than solved, which costs a few dozen vector operations once
 * per play and is exact about *when* the ball draws level with them - which is
 * the only thing the dive has to be right about.
 */
function beatenFielder(
  gatherer: PositionKey,
  apex: number,
  gatherTime: number,
  positionAt: (t: number, out: Vector3) => Vector3,
): BeatenFielder | null {
  if (apex > 14) return null;

  const probe = new Vector3();
  let best: { key: PositionKey; at: number; point: Vector3; distance: number } | null = null;

  for (const key of INFIELD_KEYS) {
    if (key === gatherer) continue;
    const spot = FIELDING_SPOTS[key];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * gatherTime;
      positionAt(t, probe);
      // Only the ball's line across the ground matters - one at the letters is
      // not a ball anybody is laying out at.
      if (probe.y > 7) continue;
      const distance = Math.hypot(probe.x - spot.x, probe.z - spot.z);
      if (distance > DIVE_REACH) continue;
      if (!best || distance < best.distance) {
        best = { key, at: t, point: probe.clone(), distance };
      }
    }
  }

  if (!best) return null;
  // He comes up a stride short, on the side he was coming from, so the ball
  // goes by the glove rather than through the figure.
  const spot = FIELDING_SPOTS[best.key];
  const off = spot.clone().sub(best.point).setY(0);
  if (off.lengthSq() > 0.01) off.normalize().multiplyScalar(DIVE_MISS);
  return { key: best.key, spot: best.point.clone().setY(0).add(off), at: best.at };
}
