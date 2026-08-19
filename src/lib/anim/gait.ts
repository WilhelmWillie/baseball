/**
 * Gaits, and how fast to play them.
 * =================================
 *
 * The old locomotion was one `run` clip and one `walk` clip, each advanced at a
 * fixed cadence - `poseT += dt * 1.9` - no matter how fast the figure was
 * actually crossing the grass. A runner accelerating out of the box, cruising,
 * and pulling up at the bag all cycled their legs at exactly the same rate, so
 * the feet slid over the ground for most of every play. That slide is the whole
 * problem this module exists to remove.
 *
 * The fix is the one every locomotion system converges on: the animation is
 * driven by the distance travelled rather than by the clock. A gait's clip has
 * a *stride* - how far the body advances in one full cycle - and if the clip is
 * played at `speed / stride` cycles per second, the planted foot travels
 * backwards relative to the hips at exactly the speed the hips are travelling
 * forwards, and it stops moving relative to the ground. No slip, at any speed,
 * for free.
 *
 * Stride is not a number anyone should be typing in by hand, because it is a
 * property of the pose: swing the hip further and the stride gets longer. So
 * the pose extremes live here in {@link SWING}, {@link STRIDE} derives the
 * stride from them with the same forward kinematics the renderer uses, and
 * `Player.tsx` builds the actual limb angles from the same table. The two
 * cannot drift.
 *
 * On top of that sits the gait *ladder*: three clips authored at three speeds,
 * with the fastest one that suits the current speed selected, and its playback
 * rate interpolated across the band rather than snapping between clips. Playing
 * one clip across the whole range is what makes a walk look like a moonwalk and
 * a jog look like a cartoon scramble.
 */

/** Feet per second in one mile per hour. */
const FT_PER_S_PER_MPH = 5280 / 3600;

/**
 * Model units to feet. These figures are cartoon scale - deliberately far
 * larger than life, see `Player.tsx` - which matters here because it decides
 * what "12 mph" is allowed to mean. A fourteen-foot alien covering ground at
 * the speed a person sprints is *strolling* by its own proportions, and would
 * pick a walk clip if the thresholds were read against the world. So every
 * speed is divided back down into body scale before it is judged, and the
 * thresholds below mean what they would mean for a person.
 */
export const FIGURE_SCALE = 2.35;

/** The leg chain, in model units: hip to knee, knee to sole, ankle to toe. */
export const THIGH = 1.32;
export const SHIN = 1.16;
export const TOE_AHEAD = 0.1;

/** Hip joint to sole with the leg straight. */
export const LEG_REACH = THIGH + SHIN;

export type Gait = "sprint" | "run" | "walk";

/** Fastest first: {@link gaitFor} takes the first band the speed clears. */
export const GAITS: Gait[] = ["sprint", "run", "walk"];

/**
 * One gait, as the handful of extremes a stride passes through.
 *
 * A cycle is two steps, and each leg spends `stance` of it on the ground and
 * the rest swinging through. The ground half is the half that matters for
 * slip, and it is described by where the foot lands (`plant*`) and where it
 * leaves (`push*`); everything the leg does in the air is decoration on top of
 * a straight line between those two.
 *
 * The angles are small on purpose. It is tempting to author a sprint as a
 * enormous scissor of the hips, but a leg raked sixty degrees behind you has
 * lost a third of its vertical reach, and the hips would have to sink a foot
 * to keep the boot on the dirt. Real stride length comes from the *airborne*
 * phase - which is what `stance` under a half buys - and from the knee drive,
 * not from splitting the hips.
 */
export interface Swing {
  /** Fraction of one cycle this foot is on the ground. Under 0.5 means flight. */
  stance: number;
  /** Hip and knee at the front of the stance: the foot has just landed. */
  plantHip: number;
  plantKnee: number;
  /** Hip and knee at the back of it: the foot is about to leave. */
  pushHip: number;
  pushKnee: number;
  /** Extra knee flex at mid-stance - the leg yielding under the weight. */
  give: number;
  /** Extra hip flexion at the top of the recovery: the knee driving up front. */
  drive: number;
  /** Extra knee fold in the air, heel toward the backside. */
  fold: number;
  /** Torso pitch. A sprint is run leaning at the ground. */
  lean: number;
  /** Shoulder swing amplitude, and how hard the elbows are held. */
  arm: number;
  elbow: number;
  spread: number;
  /** How far the hips rise through the airborne phase. */
  bob: number;
}

export const SWING: Record<Gait, Swing> = {
  sprint: {
    stance: 0.26,
    plantHip: -0.64,
    plantKnee: 0.18,
    pushHip: 0.54,
    pushKnee: 0.1,
    give: 0.46,
    drive: 1.05,
    fold: 1.85,
    lean: 0.36,
    arm: 1.0,
    elbow: -1.45,
    spread: 0.2,
    bob: 0.3,
  },
  run: {
    stance: 0.28,
    plantHip: -0.58,
    plantKnee: 0.16,
    pushHip: 0.5,
    pushKnee: 0.12,
    give: 0.38,
    drive: 0.8,
    fold: 1.3,
    lean: 0.24,
    arm: 0.72,
    elbow: -1.2,
    spread: 0.18,
    bob: 0.19,
  },
  walk: {
    // Over a half, so there is a beat of double support rather than a flight
    // phase: the difference between walking and running, in one number.
    stance: 0.58,
    plantHip: -0.6,
    plantKnee: 0.1,
    pushHip: 0.5,
    pushKnee: 0.06,
    give: 0.16,
    drive: 0.34,
    fold: 0.62,
    lean: 0.09,
    arm: 0.32,
    elbow: -0.42,
    spread: 0.12,
    bob: 0.03,
  },
};

/**
 * How far ahead of the hip joint a sole sits at these joint angles, in model
 * units. The mirror of `legDrop` in `Player.tsx`, which measures the same
 * chain downwards; between them they place the foot.
 */
function footAhead(hip: number, knee: number): number {
  const shin = hip + knee;
  return -THIGH * Math.sin(hip) - SHIN * Math.sin(shin) + TOE_AHEAD * Math.cos(shin);
}

/**
 * Feet the body advances in one full cycle of each gait.
 *
 * While a foot is planted it is nailed to the ground, so it travels backwards
 * relative to the hips by however far the hips travel forwards. That distance
 * is `footAhead(plant) - footAhead(push)`, and it is covered in `stance` of a
 * cycle - so the whole cycle covers it divided by `stance`.
 */
export const STRIDE: Record<Gait, number> = GAITS.reduce(
  (out, gait) => {
    const s = SWING[gait];
    const travel = footAhead(s.plantHip, s.plantKnee) - footAhead(s.pushHip, s.pushKnee);
    out[gait] = (travel * FIGURE_SCALE) / s.stance;
    return out;
  },
  {} as Record<Gait, number>,
);

/**
 * Each gait's band, in body-scale mph.
 *
 * `top` is the speed the clip is authored for: it plays at rate 1 there, and
 * proportionally slower below it, which is exactly the rule that keeps the
 * feet planted. The bottom of a band is the top of the next one down, so the
 * ladder is sprint above 10, run from 6 to 10, and a walk under that.
 *
 * The rate clamps are guards rather than shaping: a dropped frame or a figure
 * being dragged somewhere by something that is not a gait should not spin the
 * legs up to a blur. Inside a band the rate is free, and a runner awarded first
 * base does cross it at better than walking pace - he keeps the walk clip, by
 * `cap` below, and simply strides it out.
 */
const BAND: Record<Gait, { top: number; minRate: number; maxRate: number }> = {
  sprint: { top: 12, minRate: 0.7, maxRate: 1.7 },
  run: { top: 10, minRate: 0.5, maxRate: 1.7 },
  walk: { top: 6, minRate: 0.18, maxRate: 2.6 },
};

/** Speed at or above which each gait is chosen, in body-scale mph. */
const FLOOR: Record<Gait, number> = { sprint: 10, run: 6, walk: 0 };

/**
 * How far past a threshold a figure has to get before it changes gait. Without
 * it a runner cruising right on 10 mph flickers between the sprint and the run
 * clip every other frame.
 */
const HYSTERESIS = 0.4;

export interface Step {
  gait: Gait;
  /** Playback rate. 1 = the speed the clip was authored at. */
  rate: number;
  /** Cycles per second to advance the clip by. */
  cadence: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Pick the gait for a speed and work out how fast to play it.
 *
 * `speed` is in feet per second of world travel - measure it off the actor's
 * own position between frames rather than trusting whatever curve moved it,
 * because the curve is not the only thing that moves an actor. `cap` is the
 * fastest gait the moment allows: a batter awarded first base is not going to
 * break into a sprint however briskly the animation carries him down the line.
 * `current` is the gait already playing, which only buys a little hysteresis
 * at the thresholds.
 */
export function gaitFor(speed: number, cap: Gait = "sprint", current?: string | null): Step {
  const mph = speed / FIGURE_SCALE / FT_PER_S_PER_MPH;
  const from = GAITS.indexOf(cap);
  let gait: Gait = "walk";
  for (let i = from < 0 ? 0 : from; i < GAITS.length; i++) {
    const candidate = GAITS[i];
    const floor = FLOOR[candidate];
    if (mph >= (current === candidate ? floor - HYSTERESIS : floor)) {
      gait = candidate;
      break;
    }
  }
  const band = BAND[gait];
  const rate = clamp(mph / band.top, band.minRate, band.maxRate);
  // The cadence that keeps the foot still, expressed through the rate so the
  // two can never disagree: at rate 1 the clip covers `top` mph worth of grass.
  const nominal = (band.top * FIGURE_SCALE * FT_PER_S_PER_MPH) / STRIDE[gait];
  return { gait, rate, cadence: rate * nominal };
}

export interface LegPose {
  /** Hip flexion. Negative swings the thigh forwards. */
  hip: number;
  /** Knee flexion, which folds the shin back and up behind. */
  knee: number;
  /** 0 on the ground, peaking at 1 at the top of the recovery. */
  lift: number;
  /** How much of the body's weight this leg is carrying, 0..1. */
  support: number;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Ramp width on either end of a stance, so weight transfers rather than snaps. */
const HANDOVER = 0.07;

/**
 * The hip angle that puts the sole `target` units ahead of the hip, with the
 * knee already fixed at `knee`.
 *
 * This inversion is the difference between a gait that nearly stops slipping
 * and one that actually does. Lerping the hip *angle* from the front of the
 * stride to the back moves the foot on a cosine, not a straight line, so the
 * planted foot still creeps forwards and backwards under the figure - about a
 * quarter of the ground speed, measured, which is plenty to see. Lerping the
 * foot *position* and solving back for the angle leaves nothing to see.
 *
 * With the knee fixed, `footAhead` collapses to `P sin h + Q cos h`, which is
 * one sine wave with an amplitude and a phase, so the inverse is a closed form
 * rather than a search.
 */
function hipForFoot(target: number, knee: number): number {
  const p = -(THIGH + SHIN * Math.cos(knee) + TOE_AHEAD * Math.sin(knee));
  const q = TOE_AHEAD * Math.cos(knee) - SHIN * Math.sin(knee);
  const r = Math.hypot(p, q);
  const phase = Math.atan2(q, p);
  // The branch that lands in front of the hip rather than folded behind it.
  let hip = Math.PI - Math.asin(clamp(target / r, -1, 1)) - phase;
  while (hip > Math.PI) hip -= Math.PI * 2;
  while (hip < -Math.PI) hip += Math.PI * 2;
  return hip;
}

/**
 * Where one leg is at phase `p` of the cycle.
 *
 * The planted half sweeps the foot in a *straight line* at a constant rate
 * from the front of the stride to the back of it. That is the part that has to
 * be linear: the ground moves under the figure at one speed, so a foot that
 * moves at a different speed at every instant slips even when the cadence is
 * exactly right. The airborne half can be anything, and is eased, with the
 * knee driving up front and the heel folding up behind.
 */
export function legAt(swing: Swing, p: number): LegPose {
  const u = ((p % 1) + 1) % 1;
  const { stance } = swing;
  if (u < stance) {
    const reach = u / stance;
    const knee =
      swing.plantKnee +
      (swing.pushKnee - swing.plantKnee) * reach +
      swing.give * Math.sin(reach * Math.PI);
    const front = footAhead(swing.plantHip, swing.plantKnee);
    const back = footAhead(swing.pushHip, swing.pushKnee);
    const ramp = Math.min(HANDOVER, stance / 2);
    return {
      hip: hipForFoot(front + (back - front) * reach, knee),
      knee,
      lift: 0,
      // Weight rolls on at the heel and off at the toe.
      support: Math.min(1, Math.min(u, stance - u) / ramp),
    };
  }
  const a = (u - stance) / (1 - stance);
  const through = easeInOut(a);
  const lift = Math.sin(a * Math.PI);
  return {
    hip: swing.pushHip + (swing.plantHip - swing.pushHip) * through - swing.drive * lift,
    knee: swing.pushKnee + (swing.plantKnee - swing.pushKnee) * through + swing.fold * lift ** 0.85,
    lift,
    support: 0,
  };
}

/**
 * A runner's pace over one leg of the basepaths: dig out, cruise, pull up.
 * Returns the fraction of the distance covered at normalised time `u`.
 *
 * This replaces the ease-in-out the tracks used to run on, which was smooth but
 * had the runner at *twice* the average speed halfway down the line and at a
 * standstill at both ends. Against a gait ladder that reads as a man who walks
 * out of the box, sprints, and walks into the bag - three clips in ninety feet.
 * A trapezoid holds one speed for most of the leg, which is both what a runner
 * actually does and what lets one gait carry the whole thing.
 */
const OPENING = 0.3;
const CLOSING = 0.12;

export function pace(u: number, accel = 0.18, decel = 0.24): number {
  const t = clamp(u, 0, 1);
  // Peak speed, set so the whole leg still measures one unit of distance.
  const v = 1 / (1 - (accel * (1 - OPENING)) / 2 - (decel * (1 - CLOSING)) / 2);
  const ramped = v * (OPENING * accel + ((1 - OPENING) * accel) / 2);
  if (t < accel) {
    return v * (OPENING * t + ((1 - OPENING) * t * t) / (2 * accel));
  }
  const cruiseEnd = 1 - decel;
  if (t < cruiseEnd) return ramped + v * (t - accel);
  const d = (t - cruiseEnd) / decel;
  return ramped + v * (cruiseEnd - accel) + v * decel * (d - ((1 - CLOSING) * d * d) / 2);
}
