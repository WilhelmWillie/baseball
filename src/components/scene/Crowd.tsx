"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import { FAN_HEIGHT, buildCrowd, type CrowdPalette, type Fan } from "@/lib/field/park";
import type { Director } from "@/lib/anim/director";

/**
 * The people in the seats.
 *
 * They used to be a single coloured box each, drawn in with the rest of the
 * park, and at a real person's size against a park built in real feet they came
 * out about three pixels tall: a bowl of confetti rather than a crowd. These are
 * drawn at the players' cartoon scale instead - a fan in the front row and a
 * fielder standing in front of them are the same species - and they have faces,
 * and they move.
 *
 * Four instanced meshes - a body, a head, a cap of hair and a pair of eyes.
 * Everything about a given fan - the seat, the facing, the size, the shirt, the
 * skin, where in the idle cycle they start - is baked once in `buildCrowd`; all
 * this file does per frame is breathe.
 */

/** Proportions of one fan, as fractions of `FAN_HEIGHT`. */
const BODY_H = 0.66;
const BODY_W = 0.44;
const BODY_D = 0.4;
const HEAD_D = 0.35;

/**
 * How far a fan drifts up and down, in feet at scale 1, and how many cycles a
 * second. Slow and small: a seated crowd shifts, it does not bounce. The head
 * runs at a slightly different rate from the body so the two never lock into
 * one rigid bob.
 */
const BOB = 0.16;
const BOB_RATE = 0.42;
const HEAD_BOB = 0.1;
const HEAD_RATE = 0.61;
const SWAY = 0.12;
const SWAY_RATE = 0.23;

/**
 * Reacting to the play. When the director stirs the stands (see
 * `crowdReaction` there) a fan's excitement ramps up fast and eases back over a
 * couple of seconds: a happy one comes up out of the seat and hops, a
 * disappointed one sinks down and shakes its head. Every bit of it is still a
 * nudge to the translation - the same three matrix slots the idle bob writes,
 * no rotation rebuilt - so a whole bowl on its feet costs no more than a
 * breathing one. The excitement is signed and read per allegiance, which is how
 * the home majority and the visiting corner move in opposite directions to the
 * same play.
 */
/** How high a fan rises out of the seat at full excitement, in feet at scale 1. */
const STAND_LIFT = FAN_HEIGHT * 0.3;
/** Height and rate of the hop once they are on their feet. */
const JUMP_AMP = FAN_HEIGHT * 0.16;
const JUMP_RATE = 1.9;
/** How far a dejected fan sinks into the seat, and how much lower the head hangs. */
const SLUMP = FAN_HEIGHT * 0.11;
const HEAD_HANG = 0.5;
/** A dejected head shakes side to side - "no, no" - this far and this fast. */
const HEAD_SHAKE = FAN_HEIGHT * 0.06;
const SHAKE_RATE = 2.2;
/** A happy fan wobbles side to side on the way up - this far and this fast. */
const WOBBLE = FAN_HEIGHT * 0.05;
const WOBBLE_RATE = 3.4;
/**
 * How red a fan's face runs at full frustration, and how quickly it gets
 * there. `ANGER_MIX` is a multiplier on `sad` rather than a cap, so a fan
 * reaches full red well before the most extreme reactions peak - a flush,
 * not a slow fade.
 */
const ANGER_COLOR = new Color(0.75, 0.07, 0.06);
const ANGER_MIX = 1.6;
/**
 * How much deeper the idle bob runs at full excitement, and how much a slump
 * quiets it. Only the amplitude is scaled, never the rate: the bob's phase is
 * `t * rate`, so a rate that moved would jump the whole crowd. The lift of the
 * seat and the hop, both added on top, are what actually read as jumping.
 */
const EXCITED_BOB = 2.4;
const SLUMP_CALM = 0.5;
/** Seconds to reach full tilt. */
const REACT_ATTACK = 0.18;
/** Decay time-constant of an untiered (resting) reaction's ease back. */
const REACT_DECAY = 1.5;
/**
 * How far apart in time the bowl's reaction is spread by phase. Without it a
 * few thousand people would come up out of their seats on the very same frame -
 * a wave machine, not a crowd. A third of a second of spread is a ripple.
 */
const REACT_SPREAD = 0.35;
/** Neutral fans lean home, but quietly. */
const NEUTRAL_GAIN = 0.5;

/** Eyes. Dark enough to read at six pixels, not so dark they look like holes. */
const EYE = "#2b2426";

/** How far round the skull the crown of hair goes, and the gap left for a face. */
const CAP_THETA = Math.PI * 0.42;
const FACE_OPEN = 0.85;

/**
 * The live reaction the crowd is playing out, latched off the director. `home`
 * and `away` are the signed excitement the director handed us; `start` is the
 * clock reading the current reaction began at, and `id` is the last reaction we
 * saw, so a new stir of the stands restarts the envelope rather than blending
 * into the tail of the old one. `sustain`/`decay` are how long this particular
 * reaction holds at full excitement and how slowly it eases back - a routine
 * play and a walk-off share the same rise, not the same length.
 */
interface Reaction {
  id: number;
  home: number;
  away: number;
  start: number;
  sustain: number;
  decay: number;
}

/**
 * A reaction's strength over time for one fan: up fast, held at full for
 * `sustain` seconds, then an ease back to nothing over `decay`. `d` is
 * seconds since this fan's own (phase-staggered) start; before it begins or
 * once it has died away this is 0 and the fan is back to plain idle, so
 * nothing here disturbs the resting bowl.
 */
function reactEnvelope(d: number, sustain: number, decay: number): number {
  if (d <= 0) return 0;
  const rise = d < REACT_ATTACK ? d / REACT_ATTACK : 1;
  const held = d - REACT_ATTACK - sustain;
  const fall = held <= 0 ? 1 : Math.exp(-held / decay);
  return rise * fall;
}

/**
 * A hair mesh and the fans it covers. Hair is the one part that comes in two
 * shapes, so it is the one part drawn over a subset: `who[k]` is the fan sitting
 * in slot `k` of this mesh.
 */
interface Hair {
  mesh: InstancedMesh;
  who: Int32Array;
}

interface Parts {
  bodies: InstancedMesh;
  heads: InstancedMesh;
  cropped: Hair;
  long: Hair;
  eyes: InstancedMesh;
  /** Clock at which the next idle step is due. */
  nextAt: number;
}

/**
 * Idle steps a second. Four matrix buffers for a bowl full of people is a few
 * hundred kilobytes going up to the card every frame, and none of it needs to:
 * the bob below is under half a hertz and a couple of inches deep, so it is
 * perfectly smooth at a third of the display's rate and costs a third as much.
 */
const STEP_RATE = 24;

interface Rest {
  body: Float32Array;
  head: Float32Array;
  /** How far the hair cap sits above the centre of its head. */
  hairLift: Float32Array;
  /** Each fan's own skin colour, so a flush of anger has something to fade back to. */
  skinColor: Float32Array;
}

/**
 * One frame of idle. Everything a fan is - where the seat is, which way it
 * faces, how big they are - was written into the instance matrix once and is
 * never touched again; all this does is move the translation, which is elements
 * 12, 13 and 14 of each sixteen. That is the whole reason a crowd this size
 * costs nothing: a few thousand sines and float writes, not a few thousand
 * matrix rebuilds.
 */
function breathe(parts: Parts, fans: Fan[], rest: Rest, t: number, react: Reaction) {
  if (t < parts.nextAt) return;
  parts.nextAt = t + 1 / STEP_RATE;
  const bodyM = parts.bodies.instanceMatrix.array as Float32Array;
  const headM = parts.heads.instanceMatrix.array as Float32Array;
  const eyeM = parts.eyes.instanceMatrix.array as Float32Array;
  const headC = parts.heads.instanceColor!.array as Float32Array;
  // The whole crowd shares one reaction; a fan's own excitement is that signal
  // read for their allegiance, shaped by the envelope and their phase. When the
  // stands are quiet `react.home` is 0 and every fan falls through to pure idle.
  const stirred = react.home !== 0;
  for (let i = 0; i < fans.length; i++) {
    const fan = fans[i];
    const turn = fan.phase * Math.PI * 2;
    const s = fan.scale;

    // Signed excitement for this fan: the visitors feel a play the opposite way
    // from the home stands, and the neutrals lean home but softly.
    let e = 0;
    if (stirred) {
      const signal =
        fan.allegiance === "away"
          ? react.away
          : fan.allegiance === "neutral"
            ? react.home * NEUTRAL_GAIN
            : react.home;
      e =
        reactEnvelope(t - react.start - fan.phase * REACT_SPREAD, react.sustain, react.decay) *
        signal;
    }
    const happy = e > 0 ? e : 0;
    const sad = e < 0 ? -e : 0;

    // Idle bob, deeper when elated and calmer when dejected - amplitude only.
    const bobAmp = BOB * (1 + happy * EXCITED_BOB) * (1 - sad * SLUMP_CALM) * s;
    const bob = Math.sin(t * BOB_RATE * Math.PI * 2 + turn) * bobAmp;
    const sway = Math.sin(t * SWAY_RATE * Math.PI * 2 + turn * 1.7) * SWAY * s;
    const nod = Math.sin(t * HEAD_RATE * Math.PI * 2 + turn * 2.3) * HEAD_BOB * s;

    // Up out of the seat and hopping when happy, sunk into it when not. The hop
    // carries `turn` so the bowl is not one synchronised pogo.
    const lift = happy * STAND_LIFT * s;
    const hop = Math.abs(Math.sin(t * JUMP_RATE * Math.PI * 2 + turn)) * happy * JUMP_AMP * s;
    const slump = sad * SLUMP * s;
    const rise = lift + hop - slump;
    // A happy fan wobbles side to side coming up out of the seat - a distinct
    // motion from the idle sway, so "excited" reads differently from "settled".
    const wobble = Math.sin(t * WOBBLE_RATE * Math.PI * 2 + turn * 1.9) * happy * WOBBLE * s;
    // A dejected head shakes side to side and hangs a little below the body.
    const shake = Math.sin(t * SHAKE_RATE * Math.PI * 2 + turn * 1.3) * sad * HEAD_SHAKE * s;
    const hang = sad * SLUMP * HEAD_HANG * s;

    const m = i * 16;
    const r = i * 3;
    const headX = rest.head[r] + sway * 1.3 + shake + wobble;
    const headY = rest.head[r + 1] + bob + nod + rise - hang;
    bodyM[m + 12] = rest.body[r] + sway + wobble;
    bodyM[m + 13] = rest.body[r + 1] + bob + rise;
    headM[m + 12] = headX;
    headM[m + 13] = headY;
    // The eyes share the head's transform exactly: same seat, same facing, same
    // scale, so they are baked into the head's local frame and simply ride it.
    eyeM[m + 12] = headX;
    eyeM[m + 13] = headY;

    // A fuming fan's face flushes red, fading back to its own skin tone as
    // the envelope eases off - the same signal that drives the slump, read
    // as colour instead of motion.
    const anger = Math.min(1, sad * ANGER_MIX);
    headC[r] = rest.skinColor[r] + (ANGER_COLOR.r - rest.skinColor[r]) * anger;
    headC[r + 1] = rest.skinColor[r + 1] + (ANGER_COLOR.g - rest.skinColor[r + 1]) * anger;
    headC[r + 2] = rest.skinColor[r + 2] + (ANGER_COLOR.b - rest.skinColor[r + 2]) * anger;
  }
  // Hair comes in two shapes and so lives in two meshes over two subsets of the
  // crowd. Rather than branch inside the loop above, each one reads the head
  // position back out of the buffer that loop just wrote.
  for (const hair of [parts.cropped, parts.long]) {
    const hairM = hair.mesh.instanceMatrix.array as Float32Array;
    for (let k = 0; k < hair.who.length; k++) {
      const i = hair.who[k];
      hairM[k * 16 + 12] = headM[i * 16 + 12];
      hairM[k * 16 + 13] = headM[i * 16 + 13] + rest.hairLift[i];
    }
    hair.mesh.instanceMatrix.needsUpdate = true;
  }
  parts.bodies.instanceMatrix.needsUpdate = true;
  parts.heads.instanceMatrix.needsUpdate = true;
  parts.heads.instanceColor!.needsUpdate = true;
  parts.eyes.instanceMatrix.needsUpdate = true;
}

/**
 * A pair of eyes as one geometry, so they cost one instanced mesh between them
 * rather than one each.
 *
 * They sit on the front of the head, which is the +Z face: the seat's yaw is
 * `-theta` for a seat at spray angle theta, and a rotation of that about Y sends
 * local +Z to (-sin theta, 0, cos theta) - exactly the direction from the seat
 * back toward the middle of the field. Everyone is therefore looking at the
 * game without anything having to aim them.
 */
function eyePair(headRadius: number): BufferGeometry {
  const eye = new SphereGeometry(headRadius * 0.21, 6, 5);
  eye.scale(0.9, 1.15, 0.5);
  const left = eye.clone().translate(-headRadius * 0.36, -headRadius * 0.02, headRadius * 0.92);
  const right = eye.translate(headRadius * 0.36, -headRadius * 0.02, headRadius * 0.92);
  return joinGeometries([left, right]);
}

/**
 * Hair cropped close: the top of a sphere a little larger than the skull, sat
 * over it. It has to stop well above the eyes - taken any further round it stops
 * reading as hair and starts reading as a motorcycle helmet. The same dome does
 * duty as a club cap when it is painted in the home colours.
 */
function croppedHair(headRadius: number): BufferGeometry {
  const cap = new SphereGeometry(headRadius * 1.05, 7, 3, 0, Math.PI * 2, 0, CAP_THETA);
  cap.scale(1, 0.95, 1);
  return cap;
}

/**
 * Hair down past the ears. The same crown as above, plus a second sphere band
 * carrying on from where it stops - stretched taller so it falls to the
 * shoulders, and with a window left open at the front so it frames the face
 * rather than covering it.
 *
 * At six pixels of head there is no room for a face to do this, and a body is a
 * capsule, so the hairline is the whole of the difference.
 */
function longHair(headRadius: number): BufferGeometry {
  const r = headRadius * 1.05;
  const cap = new SphereGeometry(r, 9, 3, 0, Math.PI * 2, 0, CAP_THETA);
  cap.scale(1, 0.95, 1);
  // The face sits on +Z, which is phi = PI/2 in three's sphere; the fall covers
  // everything except a window either side of it.
  const fall = new SphereGeometry(
    r,
    10,
    4,
    Math.PI / 2 + FACE_OPEN,
    Math.PI * 2 - FACE_OPEN * 2,
    CAP_THETA,
    Math.PI * 0.44,
  );
  // Stretch it down, then drop it back so its top rim still meets the crown's.
  const stretch = 1.5;
  fall.scale(1, stretch, 1);
  fall.translate(0, r * Math.cos(CAP_THETA) * (0.95 - stretch), 0);
  return joinGeometries([cap, fall]);
}

/**
 * Concatenate non-indexed geometries. three ships a utility for this in its
 * examples, but pulling that path in to weld a few spheres together is not
 * worth it.
 */
function joinGeometries(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((g) => g.toNonIndexed());
  const out = new BufferGeometry();
  for (const name of ["position", "normal"]) {
    const arrays = flat.map((g) => g.getAttribute(name).array as Float32Array);
    const merged = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let at = 0;
    for (const a of arrays) {
      merged.set(a, at);
      at += a.length;
    }
    out.setAttribute(name, new BufferAttribute(merged, 3));
  }
  for (const g of [...parts, ...flat]) g.dispose();
  return out;
}

export function Crowd({ palette, director }: { palette: CrowdPalette; director: Director }) {
  const fans = useMemo(() => buildCrowd(palette), [palette]);

  // Which seats belong to which allegiance, so a fresh reaction can sample a
  // handful of them for a small burst without scanning the whole bowl every
  // time. Neutrals sit out the fireworks - their lean is too soft to read as
  // a mood of their own.
  const sides = useMemo(() => {
    const home: number[] = [];
    const away: number[] = [];
    for (let i = 0; i < fans.length; i++) {
      if (fans[i].allegiance === "home") home.push(i);
      else if (fans[i].allegiance === "away") away.push(i);
    }
    return { home, away };
  }, [fans]);

  // The reaction the stands are currently playing out. Latched from the
  // director each frame the way `<Actors>` latches the roster version - a new
  // `crowdReactionId` restarts the envelope from the current clock.
  const reaction = useRef<Reaction>({
    id: 0,
    home: 0,
    away: 0,
    start: 0,
    sustain: 0,
    decay: REACT_DECAY,
  });

  const parts = useMemo<Parts>(() => {
    const radius = FAN_HEIGHT * HEAD_D * 0.5;
    // A capsule rather than a chamfered box. At the old size the difference was
    // a pixel of highlight; at this one the flat front and the four vertical
    // corners of a box are the whole silhouette, and a stand of them reads as
    // stacked luggage. Squashed front to back so a torso is wider than it is
    // deep, the way one is.
    const bodyRadius = (FAN_HEIGHT * BODY_W) / 2;
    const bodyGeometry = new CapsuleGeometry(
      bodyRadius,
      Math.max(0.01, FAN_HEIGHT * BODY_H - bodyRadius * 2),
      3,
      12,
    );
    bodyGeometry.scale(1, 1, BODY_D / BODY_W);
    // A sphere is the wrong shape for a head and the right shape for a cheap
    // one: seven segments around is enough to read as round at the size these
    // are ever seen, and there are a thousand-odd of them.
    const headGeometry = new SphereGeometry(radius, 7, 5);
    headGeometry.scale(1, 1.06, 0.94);
    const everyone = fans.map((_, i) => i);
    return {
      bodies: makeMesh(bodyGeometry, fans, everyone, (fan) => fan.shirt),
      heads: makeMesh(headGeometry, fans, everyone, (fan) => fan.skin),
      cropped: makeHair(croppedHair(radius), fans, false),
      long: makeHair(longHair(radius), fans, true),
      // Unlit, so a fan in the shade of the upper deck still has eyes.
      eyes: makeMesh(eyePair(radius), fans, everyone, () => EYE, true),
      nextAt: 0,
    };
  }, [fans]);

  useEffect(() => {
    return () => {
      for (const mesh of [
        parts.bodies,
        parts.heads,
        parts.cropped.mesh,
        parts.long.mesh,
        parts.eyes,
      ]) {
        mesh.geometry.dispose();
        (mesh.material as MeshLambertMaterial).dispose();
        mesh.dispose();
      }
    };
  }, [parts]);

  // Rest heights, so the per-frame pass is a couple of adds rather than a
  // matrix rebuild. Everything a fan is - position, facing, scale - is already
  // in the instance matrix; idle motion only ever nudges the translation.
  const rest = useMemo<Rest>(() => {
    const body = new Float32Array(fans.length * 3);
    const head = new Float32Array(fans.length * 3);
    const hairLift = new Float32Array(fans.length);
    const skinColor = new Float32Array(fans.length * 3);
    const tmpColor = new Color();
    for (let i = 0; i < fans.length; i++) {
      const fan = fans[i];
      const s = fan.scale;
      body[i * 3] = fan.p[0];
      body[i * 3 + 1] = fan.p[1] + FAN_HEIGHT * BODY_H * 0.5 * s;
      body[i * 3 + 2] = fan.p[2];
      head[i * 3] = fan.p[0];
      head[i * 3 + 1] = fan.p[1] + FAN_HEIGHT * (BODY_H + HEAD_D * 0.44) * s;
      head[i * 3 + 2] = fan.p[2];
      hairLift[i] = FAN_HEIGHT * HEAD_D * 0.06 * s;
      tmpColor.set(fan.skin);
      skinColor[i * 3] = tmpColor.r;
      skinColor[i * 3 + 1] = tmpColor.g;
      skinColor[i * 3 + 2] = tmpColor.b;
    }
    return { body, head, hairLift, skinColor };
  }, [fans]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const r = reaction.current;
    // Pick up a fresh stir of the stands and start its envelope from now.
    if (director.crowdReactionId !== r.id && director.crowdReaction) {
      r.id = director.crowdReactionId;
      r.home = director.crowdReaction.home;
      r.away = director.crowdReaction.away;
      r.start = t;
      r.sustain = director.crowdReaction.sustain;
      r.decay = director.crowdReaction.decay;
      spawnSideFx(director, fans, sides.home, palette.home, r.home);
      spawnSideFx(director, fans, sides.away, palette.away, r.away);
    }
    breathe(parts, fans, rest, t, r);
  });

  return (
    <>
      <primitive object={parts.bodies} />
      <primitive object={parts.heads} />
      <primitive object={parts.cropped.mesh} />
      <primitive object={parts.long.mesh} />
      <primitive object={parts.eyes} />
    </>
  );
}

/**
 * Sample a handful of one allegiance's seats and pop a small burst over each
 * - a sparkle for a happy signal, a puff of red smoke for a sour one. Fired
 * once, when the reaction lands, not every frame: this is a few fans standing
 * out from the bowl, not a stadium-wide effect competing with the confetti.
 */
function spawnSideFx(
  director: Director,
  fans: Fan[],
  pool: number[],
  colors: [string, string],
  signal: number,
) {
  if (pool.length === 0 || signal === 0) return;
  const count = Math.min(pool.length, Math.max(2, Math.round(Math.abs(signal) * 8)));
  for (let n = 0; n < count; n++) {
    const fan = fans[pool[Math.floor(Math.random() * pool.length)]];
    const origin = new Vector3(fan.p[0], fan.p[1] + FAN_HEIGHT * 1.1 * fan.scale, fan.p[2]);
    if (signal > 0) director.fx.crowdCheer(origin, colors);
    else director.fx.crowdFume(origin);
  }
}

/** One hair mesh over the half of the crowd wearing it. */
function makeHair(geometry: BufferGeometry, fans: Fan[], long: boolean): Hair {
  const who: number[] = [];
  for (let i = 0; i < fans.length; i++) if (fans[i].longHair === long) who.push(i);
  return {
    mesh: makeMesh(geometry, fans, who, (fan) => fan.hair),
    who: Int32Array.from(who),
  };
}

function makeMesh(
  geometry: BufferGeometry,
  fans: Fan[],
  who: number[],
  pick: (fan: Fan) => string,
  unlit = false,
): InstancedMesh {
  const mesh = new InstancedMesh(
    geometry,
    unlit
      ? new MeshBasicMaterial({ toneMapped: false })
      : new MeshLambertMaterial({ flatShading: true }),
    who.length,
  );
  const dummy = new Object3D();
  const color = new Color();
  for (let k = 0; k < who.length; k++) {
    const fan = fans[who[k]];
    dummy.position.set(fan.p[0], fan.p[1], fan.p[2]);
    dummy.rotation.set(0, fan.yaw, 0);
    dummy.scale.setScalar(fan.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
    mesh.setColorAt(k, color.set(pick(fan)));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // The bowl is always around the camera somewhere and the bounding sphere of
  // an animated instanced mesh is a lie anyway.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
