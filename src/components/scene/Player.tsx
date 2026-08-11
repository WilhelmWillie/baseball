"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshPhongMaterial,
  PlaneGeometry,
  SphereGeometry,
  type Sprite,
  TorusGeometry,
  Vector3,
  type Material,
} from "three";
import type { Actor, Pose } from "@/lib/anim/director";
import type { Uniform } from "@/lib/mlb/teams";
import { panel, roundedBox } from "./geometry";
import { getLabelTexture, getNumberTexture, labelAspect } from "./textures";

/**
 * Two species share one skeleton, so the whole pose vocabulary drives both:
 * the home club are aliens, the visitors are robots. Team colors still carry
 * the uniform, which makes the species a second, redundant read on who is who.
 */
export type Species = "alien" | "robot";

/**
 * Cartoon scale. Deliberately far larger than life - these figures exist to
 * communicate the state of the game from a camera 80 feet up, not to be
 * anatomically sensible next to a 90-foot base path.
 */
const SCALE = 2.35;

/**
 * Hip height in model units. Chosen so the soles of the feet land on y = 0 in
 * the resting pose - the figures used to sink about a foot into the dirt.
 */
const HIP_HEIGHT = 2.92;

/**
 * The batting stance. Both arms take the same angles, and the hands close on
 * one point in front of the chest where the bat is hung - see `handAnchor`.
 *
 * `elbowIn` is what makes this stance possible at all. With only a shoulder
 * spread to work with, the only way to bring two hands together is to rotate
 * the whole arm inward, which buries the upper arm inside the ribcage and
 * leaves the forearms sprouting from the sternum. Letting the forearm swing in
 * at the elbow keeps the upper arms hanging outside the body where they belong.
 */
const BAT_STANCE = { arm: -0.75, elbow: -1.95, spread: 0.05, elbowIn: 1.3 };

/**
 * Bat attitude in torso space, as a direction from the hands to the barrel.
 * At rest it stands up and back over the rear shoulder, angled out far enough
 * to clear the helmet; through the swing it levels off and comes across the
 * body. The torso twist carries it the rest of the way through the zone.
 */
const BAT_REST_AXIS = new Vector3(-0.62, 0.76, -0.24).normalize();
const BAT_SWING_AXIS = new Vector3(-0.82, 0.02, 0.57).normalize();
const UP = new Vector3(0, 1, 0);
/** Scratch, so the frame loop allocates nothing. */
const BAT_AIM = new Vector3();

/**
 * The arm skeleton, shared by the model builder and by `handAnchor` so the two
 * can never disagree about where a hand ends up.
 */
const ARM = {
  shoulderY: 1.46,
  elbowY: -0.98,
  alien: { shoulderX: 0.98, handY: -1.06 },
  robot: { shoulderX: 1.06, handY: -1.14 },
};

/**
 * Where the two hands meet, in torso space, for a set of stance angles. The bat
 * is positioned from this rather than from a hand-derived constant, so it stays
 * in the hands if the stance is ever retuned - and it hangs off the torso
 * rather than off an arm, because a child of the arm inherits the whole chain
 * and ends up pointing into the batter's own back.
 */
function handAnchor(isAlien: boolean, stance: typeof BAT_STANCE): Vector3 {
  const rig = isAlien ? ARM.alien : ARM.robot;
  const torso = new Group();
  const mid = new Vector3();
  for (const side of [1, -1]) {
    const shoulder = new Group();
    shoulder.position.set(side * rig.shoulderX, ARM.shoulderY, 0);
    shoulder.rotation.set(stance.arm, 0, -side * stance.spread);
    torso.add(shoulder);
    const elbow = new Group();
    elbow.position.y = ARM.elbowY;
    elbow.rotation.set(stance.elbow, 0, -side * stance.elbowIn);
    shoulder.add(elbow);
    const hand = new Group();
    hand.position.set(0, rig.handY, 0.02);
    elbow.add(hand);
    torso.updateMatrixWorld(true);
    mid.addScaledVector(hand.getWorldPosition(new Vector3()), 0.5);
  }
  return mid;
}

const ALIEN_SKIN = ["#8ad694", "#79c9c2", "#a6d977", "#7bc7ad", "#b7d96b"];
const ROBOT_METAL = "#c3cad2";
const DARK_PART = "#31373f";
const EYE_GLOW = "#7ff0ff";
const GLOSS_BLACK = "#0d1014";
const BOOT = "#252930";

/** Shared geometry - every player reuses these buffers. */
const GEO = {
  box: new BoxGeometry(1, 1, 1),
  plane: new PlaneGeometry(1, 1),
  sphere: new SphereGeometry(0.5, 16, 12),
  lowSphere: new IcosahedronGeometry(0.5, 1),
  joint: new IcosahedronGeometry(0.5, 2),
  capsule: new CapsuleGeometry(0.32, 0.6, 4, 10),
  rod: new CylinderGeometry(0.5, 0.5, 1, 10),
  taper: new CylinderGeometry(0.42, 0.5, 1, 10),
  dome: new SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.85),
  ring: new TorusGeometry(0.5, 0.11, 8, 20),
  // A bat, in three pieces: knob, handle, and a barrel that flares out to the
  // far end. The old single taper had the fat end at the hands.
  batKnob: new CylinderGeometry(0.15, 0.13, 1, 10),
  batHandle: new CylinderGeometry(0.085, 0.075, 1, 10),
  batBarrel: new CylinderGeometry(0.2, 0.1, 1, 12),

  // Chamfered panels.
  pelvis: roundedBox(1.5, 0.62, 1.0, 0.18),
  chestSlim: roundedBox(1.68, 1.5, 0.94, 0.24),
  chestWide: roundedBox(1.92, 1.56, 1.06, 0.2),
  belt: roundedBox(1.8, 0.22, 1.02, 0.09),
  emblem: panel(0.52, 0.52, 0.1),
  pauldron: roundedBox(0.74, 0.5, 0.92, 0.18),
  limbBlock: roundedBox(0.52, 0.92, 0.52, 0.15),
  shinBlock: roundedBox(0.48, 0.88, 0.48, 0.13),
  thighBlock: roundedBox(0.62, 1.12, 0.62, 0.17),
  robotSkull: roundedBox(1.36, 1.22, 1.2, 0.24),
  visor: roundedBox(1.42, 0.46, 0.2, 0.09),
  eyeBand: roundedBox(1.06, 0.2, 0.08, 0.04),
  chestPanel: roundedBox(1.02, 0.74, 0.12, 0.06),
  foot: roundedBox(0.78, 0.32, 1.3, 0.12),
  crest: roundedBox(0.16, 0.36, 0.92, 0.07),
  brim: roundedBox(1.12, 0.13, 0.66, 0.06),
  earFlap: roundedBox(0.16, 0.46, 0.54, 0.07),
  vent: roundedBox(0.62, 0.08, 0.1, 0.03),
  finger: roundedBox(0.14, 0.44, 0.14, 0.06),
  toe: roundedBox(0.24, 0.2, 0.5, 0.08),

  // Batting helmet, in a normalised frame: a unit sphere at the origin stands
  // in for the head, and the caller scales the whole thing to fit.
  helmetBrim: roundedBox(1.72, 0.15, 0.92, 0.07),
  helmetBrimEdge: roundedBox(1.76, 0.09, 0.2, 0.04),
  helmetFlap: roundedBox(0.24, 0.86, 0.78, 0.11),
  helmetRidge: roundedBox(0.2, 0.16, 1.8, 0.07),
  helmetVent: roundedBox(0.13, 0.1, 0.34, 0.04),

  // Glove parts. A mitt is most of what a fielder is doing with their hands,
  // so it gets real fingers, a laced web and a padded heel instead of a
  // squashed sphere.
  glovePalm: roundedBox(1.32, 1.02, 0.56, 0.24),
  gloveBack: roundedBox(1.18, 0.86, 0.2, 0.09),
  gloveFinger: roundedBox(0.31, 1.02, 0.44, 0.14),
  gloveThumb: roundedBox(0.44, 0.9, 0.48, 0.18),
  gloveHeel: roundedBox(1.16, 0.44, 0.58, 0.2),
  gloveWeb: roundedBox(0.46, 0.78, 0.14, 0.06),
  lace: roundedBox(0.9, 0.09, 0.11, 0.04),
  laceShort: roundedBox(0.4, 0.08, 0.1, 0.035),
  wristStrap: roundedBox(1.06, 0.26, 0.62, 0.11),
};

function alienSkin(playerId: number): string {
  return ALIEN_SKIN[playerId % ALIEN_SKIN.length];
}

/** Gloves differ by position, and the difference is easy to read from a camera. */
type GloveKind = "fielder" | "mitt" | "first";

function gloveFor(positionKey?: string): GloveKind {
  if (positionKey === "catcher") return "mitt";
  if (positionKey === "first") return "first";
  return "fielder";
}

/** Everything the model builder needs to hang a part on a figure. */
type AddPart = (
  parent: Group,
  geometry: BufferGeometry,
  material: Material,
  position: [number, number, number],
  scale?: [number, number, number],
  rotation?: [number, number, number],
  shadow?: boolean,
) => Mesh;

/**
 * A batting helmet, built in a normalised frame whose **origin is the rim** -
 * the bottom edge of the shell - with a nominal head radius of 1 at that
 * plane. Positioning by the rim is what makes it fittable: the caller drops
 * the group at the height where the helmet should stop and the face begins,
 * and `height` stretches the shell to cover however much skull is above it.
 * An alien cranium needs far more of that than a robot's head does.
 */
function buildHelmet(
  addTo: AddPart,
  parent: Group,
  materials: { helmet: Material; trim: Material; dark: Material },
  opts: { flaps: 1 | 2; flapSide: number; height: number },
) {
  const { helmet, trim, dark } = materials;
  const h = opts.height;
  // The dome is a sphere cut a little past its equator, so its bottom edge
  // sits slightly below its centre. Lifting the centre by that much puts the
  // edge exactly on y = 0 - which is what lets the caller position the helmet
  // by its rim instead of guessing at its middle.
  const centre = 0.1305 * h;

  addTo(parent, GEO.dome, helmet, [0, centre, 0], [2.16, 2.05 * h, 2.1], undefined, true);
  // The back drops below the rim, as a real one does.
  addTo(parent, GEO.dome, helmet, [0, -0.34, -0.2], [2.0, 1.5 * h, 1.62]);
  // Rim picks the edge out against the head.
  addTo(parent, GEO.ring, trim, [0, 0, 0], [2.2, 2.14, 0.85], [Math.PI / 2, 0, 0]);

  // Raised centre ridge, vents either side, and a button on the crown.
  addTo(parent, GEO.helmetRidge, trim, [0, 1.02 * h, -0.04], [1, 1, 0.8], [0.06, 0, 0]);
  addTo(parent, GEO.lowSphere, trim, [0, 1.14 * h, -0.04], [0.18, 0.18, 0.18]);
  for (const side of [-1, 1]) {
    for (const z of [0.34, 0, -0.34]) {
      addTo(parent, GEO.helmetVent, dark, [side * 0.42, 0.96 * h, z], [1, 1, 1], [0, 0, side * 0.12]);
    }
  }

  // Brim: on the rim line at the front, angled down over the brow. Matte
  // black underneath, the way a real one is to cut glare.
  addTo(parent, GEO.helmetBrim, helmet, [0, 0.12, 0.86], [0.92, 1, 0.86], [-0.3, 0, 0], true);
  addTo(parent, GEO.helmetBrim, dark, [0, 0.04, 0.87], [0.86, 0.55, 0.8], [-0.3, 0, 0]);

  // Ear flaps hang below the rim. A hitter wears one, on the side turned
  // toward the pitcher; runners have usually swapped to a double.
  const sides = opts.flaps === 2 ? [-1, 1] : [opts.flapSide];
  for (const side of sides) {
    addTo(parent, GEO.helmetFlap, helmet, [side * 0.94, -0.3, 0.14], [1, 0.86, 0.86], [0, 0, side * 0.2], true);
  }
}

/**
 * Builds a glove into `parent`, in a frame where +Y runs from the wrist toward
 * the fingertips and +Z is the pocket. The caller flips it onto the arm.
 *
 * `thumbSide` is which way the thumb points: a right-handed thrower wears the
 * glove on the left hand with the thumb inboard, so it follows the arm.
 */
function buildGlove(
  addTo: (
    parent: Group,
    geometry: BufferGeometry,
    material: Material,
    position: [number, number, number],
    scale?: [number, number, number],
    rotation?: [number, number, number],
    shadow?: boolean,
  ) => Mesh,
  parent: Group,
  materials: { glove: Material; gloveDark: Material; lace: Material },
  kind: GloveKind,
  thumbSide: number,
) {
  const { glove, gloveDark, lace } = materials;
  // A first baseman's mitt is longer and narrower; a catcher's is round and
  // has no separated fingers at all.
  const long = kind === "first" ? 1.22 : 1;
  const wide = kind === "first" ? 0.86 : 1;

  // Heel and wrist, where the padding is thickest.
  addTo(parent, GEO.wristStrap, gloveDark, [0, -0.12, -0.02], [wide, 1, 1]);
  addTo(parent, GEO.gloveHeel, glove, [0, 0.24, 0.04], [wide, 1, 1], undefined, true);
  addTo(parent, GEO.glovePalm, glove, [0, 0.86 * long, 0.06], [wide, long, 1], undefined, true);
  // The back of the hand reads flatter than the pocket side.
  addTo(parent, GEO.gloveBack, gloveDark, [0, 0.86 * long, -0.24], [wide, long, 1]);

  if (kind === "mitt") {
    // A catcher's mitt: a padded ring around a deep pocket.
    addTo(parent, GEO.lowSphere, gloveDark, [0, 0.98, 0.1], [1.36, 1.36, 0.5]);
    addTo(parent, GEO.ring, glove, [0, 1.0, 0.12], [1.62, 1.62, 1.15], [0, 0, 0], true);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addTo(parent, GEO.laceShort, lace, [Math.sin(a) * 0.8, 1.0 + Math.cos(a) * 0.8, 0.24], [0.6, 1, 1], [0, 0, -a]);
    }
  } else {
    // Four fanned finger stalls, laced across the tips.
    for (let i = 0; i < 4; i++) {
      const x = (-1.5 + i) * 0.33 * wide;
      addTo(
        parent,
        GEO.gloveFinger,
        glove,
        [x, 1.78 * long, 0.02],
        [1, long, 1],
        [0.12, 0, -x * 0.34],
        true,
      );
    }
    addTo(parent, GEO.lace, lace, [0, 2.2 * long, 0.1], [wide, 1, 1], [0.1, 0, 0]);
    addTo(parent, GEO.lace, lace, [0, 1.44 * long, 0.16], [wide * 0.92, 1, 1]);
  }

  // Thumb, and the laced web that spans the gap to the first finger.
  addTo(
    parent,
    GEO.gloveThumb,
    glove,
    [thumbSide * 0.76 * wide, 1.02 * long, 0.06],
    [1, long, 1],
    [0.1, 0, thumbSide * 0.3],
    true,
  );
  const webX = thumbSide * 0.48 * wide;
  addTo(parent, GEO.gloveWeb, gloveDark, [webX, 1.62 * long, 0.12], [1, long, 1], [0, 0, thumbSide * 0.18]);
  for (const dy of [-0.22, 0, 0.22]) {
    addTo(
      parent,
      GEO.laceShort,
      lace,
      [webX, (1.62 + dy) * long, 0.2],
      [0.9, 1, 1],
      [0, 0, thumbSide * 0.18],
    );
  }
}

interface Limbs {
  hips: Group;
  torso: Group;
  head: Group;
  legL: Group;
  legR: Group;
  kneeL: Group;
  kneeR: Group;
  armL: Group;
  armR: Group;
  elbowL: Group;
  elbowR: Group;
  /** Antennae and other springy bits that lag behind the body. */
  danglers: Group[];
  /** Present only on the batter. */
  bat: Group | null;
}

interface PoseValues {
  crouch: number;
  lean: number;
  twist: number;
  legL: number;
  legR: number;
  kneeL: number;
  kneeR: number;
  armL: number;
  armR: number;
  elbowL: number;
  elbowR: number;
  armSpread: number;
  /** Forearm swing toward the midline, at the elbow. */
  elbowIn: number;
  headTilt: number;
  /** Head turn, for looking around between pitches. */
  headYaw: number;
  /** Side-to-side weight shift. */
  sway: number;
  /**
   * Both legs leaning sideways from the hip. Paired with `sway` this keeps the
   * feet planted while the hips travel over one of them - without it a weight
   * shift drags the whole body, boots included, across the grass.
   */
  legSplay: number;
  /** Torso roll, which reads as shifting onto one leg. */
  roll: number;
  /**
   * Chest rise. Breathing belongs here rather than in `bob`, because the hips
   * carry the legs with them - a breath taken through the hips lifts the boots
   * off the ground and puts them back down again.
   */
  chest: number;
  bob: number;
  /** 0 = bat cocked over the shoulder, 1 = bat levelled through the zone. */
  batSwing: number;
}

const REST: PoseValues = {
  crouch: 0,
  lean: 0,
  twist: 0,
  legL: 0,
  legR: 0,
  // Straight. A knee angle swings the shin backwards, heel toward the butt,
  // so "a little soft" on a standing figure reads as a half-kneel rather than
  // as an athletic stance - the weight has to come from the torso instead.
  kneeL: 0,
  kneeR: 0,
  armL: 0,
  armR: 0,
  elbowL: -0.25,
  elbowR: -0.25,
  armSpread: 0.06,
  elbowIn: 0,
  headTilt: 0,
  headYaw: 0,
  sway: 0,
  legSplay: 0,
  roll: 0,
  chest: 0,
  bob: 0,
  batSwing: 0,
};

/**
 * Small, constant motion so nobody looks like a statue between pitches.
 *
 * The motion lives in the body, not the hands. Waving the arms around is the
 * cheapest thing to animate on this rig and by far the worst-looking: nine
 * fielders all working their gloves reads as a nervous tic rather than as life.
 * So the layers here are, in order of how much of the movement they carry:
 * a weight shift from foot to foot, breathing, a settle down into the knees and
 * back up, and the head looking around. The hands do almost nothing.
 *
 * Underneath everything are continuous waves on detuned frequencies, so they
 * never resolve into an obvious loop. On top are occasional *gestures* - a rock
 * onto the other foot, a sharp glance, a sink into a crouch - which are what
 * stop a field of nine from reading as nine copies of the same sine wave. They
 * fire on their own slow cycles, and `clock` is offset per player so no two
 * ever coincide.
 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The only poses in which a hitter is still holding the bat. */
const BATTING_POSES = new Set<Pose>(["ready", "idle", "swing"]);

/**
 * Distance from the hip joint down to the sole, in rig units. Rotating a leg
 * about Z by `phi` moves that foot sideways by roughly `LEG_REACH * phi`, which
 * is how `sway` gets cancelled at the ground.
 */
const LEG_REACH = 2.48;

/**
 * A squat that keeps its feet. Flexing the hip by `SQUAT_HIP` and the knee by
 * `SQUAT_KNEE` folds the leg into a Z; this pair is chosen so the sole ends up
 * back under the same spot of grass it started on, at any depth. The hips then
 * have to drop by however much vertical reach the fold cost, which is what
 * `squat` works out - guessing at it instead is what buries the boots.
 */
const SQUAT_HIP = 0.5;
const SQUAT_KNEE = 1.077;
/** Hip to knee, knee to sole, and how far the toe sits ahead of the ankle. */
const THIGH = 1.32;
const SHIN = 1.16;
const TOE_AHEAD = 0.1;

/**
 * How far the hips have to drop for a leg held at these angles to keep its sole
 * on the ground. Any pose that bends a knee owes the ground this much, and the
 * ones that guessed at it instead had their feet buried in the dirt.
 */
function legDrop(hip: number, knee: number): number {
  const shin = hip + knee;
  const reach =
    THIGH * Math.cos(hip) + SHIN * Math.cos(shin) + TOE_AHEAD * Math.sin(shin);
  return THIGH + SHIN - reach;
}

/** The pose channels a settle drives, at depth `g` (0 = stood up, 1 = deep). */
function squat(g: number) {
  const hip = -SQUAT_HIP * g;
  const knee = SQUAT_KNEE * g;
  return { crouch: legDrop(hip, knee), leg: hip, knee };
}

function idleLife(clock: number) {
  // Roughly twelve breaths a minute, which is slow enough to read as calm.
  const breath = Math.sin(clock * 1.15);

  // A gesture cycle: mostly idle, with a burst of movement near the end of it.
  const gesture = (period: number, phase: number, width: number) => {
    const t = ((clock / period + phase) % 1 + 1) % 1;
    return t > 1 - width ? Math.sin(((t - (1 - width)) / width) * Math.PI) : 0;
  };

  // Which way this player happens to be looking on this cycle.
  const glanceAim = Math.sin(clock * 0.037) * 3.7;
  const glance = gesture(7.3, 0.0, 0.22) * Math.sin(glanceAim) * 0.85;

  // Weight from one foot to the other. A rock underneath at roughly one cycle
  // every six seconds - slower than that and it stops reading as movement at
  // all - with a decisive shove onto one side every few seconds on top, so the
  // lean is always going somewhere but rarely centred.
  const rock = Math.sin(clock * 1.05) * 0.5 + Math.sin(clock * 0.62 + 2.2) * 0.3;
  const shove = gesture(5.5, 0.35, 0.5);
  const shoveDir = Math.sign(Math.sin(clock * 0.13 + 1.1)) || 1;
  const weight = clampUnit(rock + shove * shoveDir * 0.5);

  // Sinking into the knees and standing back up: the between-pitches settle.
  // Shallow and constant, deeper on the occasional gesture.
  const sink = clamp01(0.12 + 0.07 * Math.sin(clock * 1.3 + 0.4) + gesture(7.9, 0.7, 0.35) * 0.32);

  return {
    headYaw:
      Math.sin(clock * 0.41) * 0.3 + Math.sin(clock * 0.17 + 1.3) * 0.2 + glance,
    headTilt: Math.sin(clock * 0.29 + 0.7) * 0.08 - sink * 0.12,
    breath,
    /** -1 fully on one foot, +1 fully on the other. */
    weight,
    /** How far down into the knees, 0..1. */
    sink,
    /** Hands: a grip adjustment now and then, and nothing else. */
    fidget: gesture(13.7, 0.15, 0.12),
  };
}

/** Weight shift as pose channels: hips over one foot, feet where they were. */
function lean(weight: number, amount = 0.5) {
  const sway = weight * amount;
  return {
    sway,
    legSplay: -sway / LEG_REACH,
    roll: weight * 0.06,
  };
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function poseValues(
  pose: Pose,
  t: number,
  clock: number,
  isBatter = false,
): PoseValues {
  const life = idleLife(clock);

  if (isBatter && (pose === "ready" || pose === "idle")) {
    // Coiled at the plate, hands together off the back shoulder. The legs sit
    // by flexing the hip and letting the knee bring the shin back to vertical -
    // bending the knee alone just kicks the heels up behind.
    return {
      ...REST,
      // A hitter rocks too, but only slightly - the stance is already loaded
      // and anything bigger reads as stepping out of the box.
      ...lean(life.weight, 0.14),
      crouch: 0.2,
      chest: life.breath * 0.035,
      lean: 0.06,
      twist: 0.34,
      legL: -0.55,
      legR: -0.55,
      kneeL: 0.6,
      kneeR: 0.6,
      armL: BAT_STANCE.arm,
      armR: BAT_STANCE.arm,
      elbowL: BAT_STANCE.elbow,
      elbowR: BAT_STANCE.elbow,
      armSpread: BAT_STANCE.spread,
      elbowIn: BAT_STANCE.elbowIn,
      headYaw: life.headYaw * 0.3,
      headTilt: life.headTilt,
    };
  }

  switch (pose) {
    case "ready": {
      // Waiting on the pitch: down in the knees, weight rolling from foot to
      // foot, hands resting where they are. The athletic read comes from the
      // settle and the forward lean, not from working the glove.
      const settle = squat(life.sink);
      return {
        ...REST,
        ...lean(life.weight),
        crouch: settle.crouch,
        chest: life.breath * 0.05,
        lean: 0.13 + life.sink * 0.12,
        legL: settle.leg,
        legR: settle.leg,
        kneeL: settle.knee,
        kneeR: settle.knee,
        armL: -0.5 - life.sink * 0.12,
        armR: -0.5 - life.sink * 0.1,
        elbowL: -0.85 + life.breath * 0.04 - life.fidget * 0.3,
        elbowR: -0.85 - life.breath * 0.04 - life.fidget * 0.2,
        armSpread: 0.34 + life.sink * 0.06,
        headYaw: life.headYaw,
        headTilt: life.headTilt,
      };
    }
    case "crouch":
      // The catcher: deep squat, glove hand up, mask pointed at the mound.
      return {
        ...REST,
        crouch: 1.35,
        chest: life.breath * 0.04,
        lean: 0.34,
        legL: -1.45,
        legR: -1.45,
        kneeL: 2.25,
        kneeR: 2.25,
        armL: -1.55,
        armR: -0.55,
        elbowL: -0.5,
        elbowR: -1.15,
        armSpread: 0.62,
        headTilt: -0.34,
        headYaw: life.headYaw * 0.25,
      };
    case "walk": {
      // Strolling down to first with the base awarded. Half the cadence of a
      // run, a shorter stride, and the arms hanging rather than pumping.
      const swing = Math.sin(t * Math.PI * 2);
      const lift = Math.cos(t * Math.PI * 2);
      return {
        ...REST,
        crouch: 0.04,
        lean: 0.08,
        legL: swing * 0.42,
        legR: -swing * 0.42,
        kneeL: 0.12 + Math.max(0, -swing) * 0.5,
        kneeR: 0.12 + Math.max(0, swing) * 0.5,
        armL: -swing * 0.3,
        armR: swing * 0.3,
        elbowL: -0.4,
        elbowR: -0.4,
        armSpread: 0.12,
        headYaw: life.headYaw * 0.5,
        bob: Math.abs(lift) * 0.05,
      };
    }
    case "run": {
      const swing = Math.sin(t * Math.PI * 2);
      const lift = Math.cos(t * Math.PI * 2);
      return {
        ...REST,
        crouch: 0.16,
        lean: 0.3,
        legL: swing * 1.0,
        legR: -swing * 1.0,
        // The trailing leg folds up; the leading one extends.
        kneeL: 0.55 + Math.max(0, -swing) * 1.15,
        kneeR: 0.55 + Math.max(0, swing) * 1.15,
        armL: -swing * 0.85,
        armR: swing * 0.85,
        elbowL: -1.35,
        elbowR: -1.35,
        armSpread: 0.2,
        bob: Math.abs(lift) * 0.14,
      };
    }
    case "windup": {
      // Two beats. First the gather: sink onto the back leg with the hands
      // together at the belt. Then the leg kick, the front knee driving up as
      // the shoulders close off toward second base.
      const gather = clamp01(t / 0.4);
      const kick = clamp01((t - 0.35) / 0.65);
      const backHip = -0.34 * gather;
      const backKnee = 0.38 * gather;
      return {
        ...REST,
        // The back foot is the one on the rubber, so it sets the hip height.
        crouch: legDrop(backHip, backKnee),
        lean: -0.06 * gather + 0.1 * kick,
        twist: -0.72 * kick,
        legR: backHip,
        kneeR: backKnee,
        // Front leg: thigh up toward the chest, shin hanging under the knee.
        legL: -1.62 * kick,
        kneeL: 1.55 * kick,
        // Hands meet at the belt and ride up to the chest with the kick.
        armL: -0.55 - 0.55 * kick,
        armR: -0.5 - 0.5 * kick,
        elbowL: -1.45 - 0.35 * kick,
        elbowR: -1.5 - 0.3 * kick,
        elbowIn: 0.75 + 0.35 * kick,
        armSpread: 0.16,
        headTilt: -0.06,
        // Looking in at the plate over the front shoulder as the body turns.
        headYaw: 0.72 * kick,
      };
    }
    case "throw": {
      // Three beats sharing one timeline: the stride out, the arm coming over
      // - the ball leaves midway through it - and the follow-through. `t` runs
      // 0..1 across the whole motion, and the director releases the ball at
      // THROW_RELEASE, so these thresholds and that constant have to agree.
      const stride = clamp01(t / 0.34);
      const whip = clamp01((t - 0.14) / 0.3);
      const follow = clamp01((t - 0.36) / 0.64);

      // The front leg swings out ahead and plants; the back one trails off the
      // rubber and comes through behind.
      const frontHip = -1.62 + 0.9 * stride + 0.04 * follow;
      const frontKnee = 1.55 - 1.33 * stride + 0.1 * follow;
      const backHip = -0.34 + 0.89 * stride - 0.75 * follow;
      const backKnee = 0.38 + 1.0 * follow;

      // Which foot owns the ground changes mid-motion, and the hips have to
      // follow whichever one it is: the back foot until the stride lands, the
      // front foot from then on. Driving the height off the front leg the whole
      // way would drop the pitcher through the mound before they had strided,
      // and off the back leg would leave the stride hanging in mid-air. The
      // handover is the "drop and drive" - the hips sink half a unit as the
      // front foot takes the weight, because a leg reaching forward simply does
      // not reach as far down as one standing under you.
      const plant = clamp01((t - 0.12) / 0.22);
      const crouch =
        legDrop(backHip, backKnee) * (1 - plant) + legDrop(frontHip, frontKnee) * plant;

      return {
        ...REST,
        crouch,
        lean: 0.12 * stride + 0.44 * follow,
        // Closed, through square at release, then rotated well past it.
        twist: -0.72 + 1.05 * whip + 0.5 * follow,
        legL: frontHip,
        kneeL: frontKnee,
        legR: backHip,
        kneeR: backKnee,
        // Throwing arm: up and back off the shoulder, over the top, then down
        // and across the body. It is extended toward the plate at release and
        // spends the rest of the pose decelerating.
        armR: -0.5 - 2.3 * clamp01(t / 0.14) + 2.0 * whip + 1.4 * follow,
        elbowR: -1.8 + 1.9 * whip - 0.55 * follow,
        // Glove arm reaches out front, then is pulled into the ribs - the tug
        // that the shoulders rotate around.
        armL: -1.05 - 0.75 * stride + 1.35 * follow,
        elbowL: -1.75 + 1.05 * follow,
        elbowIn: 1.1 - 0.9 * whip,
        armSpread: 0.16 + 0.34 * follow,
        // The head cancels the lean rather than going with it: the pitcher
        // watches the pitch all the way in, however far the body folds over.
        headTilt: 0.1 + 0.5 * follow,
        headYaw: 0.72 - 0.72 * whip,
      };
    }
    case "swing": {
      const load = Math.min(1, t / 0.3);
      const fire = Math.max(0, (t - 0.3) / 0.7);
      return {
        ...REST,
        crouch: 0.17,
        lean: 0.08,
        twist: 0.62 * load - 2.6 * fire,
        legL: -0.5 + 0.28 * load,
        legR: -0.5,
        kneeL: 0.55,
        kneeR: 0.55,
        // The arms barely leave the stance: the bat is anchored to where these
        // angles put the hands, so anything more and the grip visibly lets go.
        // The twist above is what carries the bat through the zone.
        armL: BAT_STANCE.arm - 0.06 * load + 0.16 * fire,
        armR: BAT_STANCE.arm - 0.06 * load + 0.16 * fire,
        elbowL: BAT_STANCE.elbow - 0.07 * load + 0.22 * fire,
        elbowR: BAT_STANCE.elbow - 0.07 * load + 0.22 * fire,
        armSpread: BAT_STANCE.spread - 0.08 * fire,
        elbowIn: BAT_STANCE.elbowIn - 0.12 * fire,
        batSwing: fire,
      };
    }
    case "catch":
      return {
        ...REST,
        crouch: 0.2,
        lean: 0.12,
        legL: -0.55,
        legR: -0.55,
        kneeL: 0.6,
        kneeR: 0.6,
        armL: -2.5,
        armR: -2.1,
        elbowL: -0.7,
        elbowR: -0.8,
        armSpread: 0.5,
        headTilt: -0.2,
      };
    case "celebrate": {
      // Both fists up, then settling into a clap toward the dugout.
      const settle = clamp01((t - 0.45) / 0.9);
      const pump = Math.abs(Math.sin(clock * 7));
      return {
        ...REST,
        armL: -2.9 + settle * 1.15,
        armR: -2.9 + settle * 1.15,
        elbowL: -0.4 - settle * 0.95,
        elbowR: -0.4 - settle * 0.95,
        elbowIn: settle * (0.9 + pump * 0.25),
        armSpread: 0.7 - settle * 0.4,
        headTilt: -0.25 + settle * 0.2,
        headYaw: settle * 0.4,
        roll: Math.sin(clock * 9) * 0.12 * (1 - settle * 0.6),
        bob: pump * 0.45 * (1 - settle * 0.7),
      };
    }
    case "annoyed": {
      // Hands on hips, head down, a slow shake of it. Whatever a pitcher does
      // after giving one up, it is not standing there at attention.
      const shake = Math.sin(clock * 3.4);
      return {
        ...REST,
        crouch: 0.06,
        lean: 0.16,
        twist: shake * 0.12,
        armL: 0.12,
        armR: 0.12,
        elbowL: -1.55,
        elbowR: -1.55,
        elbowIn: 1.15,
        armSpread: 0.34,
        headTilt: 0.34 + Math.sin(clock * 1.6) * 0.06,
        headYaw: shake * 0.3,
        roll: Math.sin(clock * 1.1) * 0.05,
      };
    }
    case "dejected":
      return {
        ...REST,
        crouch: 0.15,
        lean: 0.62,
        legL: -0.45,
        legR: -0.45,
        kneeL: 0.5,
        kneeR: 0.5,
        armL: 0.3,
        armR: 0.3,
        elbowL: -0.15,
        elbowR: -0.15,
        headTilt: 0.35,
      };
    default: {
      // Standing around: the same life as `ready`, at about half the amplitude
      // and without the crouch, since nobody is expecting a ball right now.
      const settle = squat(life.sink * 0.45);
      return {
        ...REST,
        ...lean(life.weight, 0.4),
        crouch: settle.crouch,
        chest: life.breath * 0.045,
        lean: 0.04,
        legL: settle.leg,
        legR: settle.leg,
        kneeL: settle.knee,
        kneeR: settle.knee,
        elbowL: -0.25 - life.fidget * 0.25,
        elbowR: -0.25 - life.fidget * 0.25,
        headYaw: life.headYaw,
        headTilt: life.headTilt,
      };
    }
  }
}

export interface PlayerProps {
  actor: Actor;
  uniform: Uniform;
  species: Species;
  director: { actors: Map<string, Actor> };
  showLabel?: boolean;
  labelText?: string;
  accent?: string;
}

export function Player({
  actor,
  uniform,
  species,
  director,
  showLabel = false,
  labelText,
  accent = "#ffffff",
}: PlayerProps) {
  const rootRef = useRef<Group>(null);
  const labelRef = useRef<Sprite>(null);
  const limbsRef = useRef<Limbs | null>(null);
  const key = actor.key;
  const isAlien = species === "alien";
  const wearsHelmet = actor.role === "batter" || actor.role === "runner";
  // Hitters wear a single flap on the side turned toward the pitcher; runners
  // have usually swapped to a double.
  const helmetFlaps: 1 | 2 = actor.role === "runner" ? 2 : 1;
  const flapSide = actor.batSide === "L" ? -1 : 1;

  const materials = useMemo(() => {
    const phong = (color: string, shininess: number, specular: string) =>
      new MeshPhongMaterial({ color, shininess, specular, flatShading: false });

    return {
      jersey: phong(uniform.jersey, 26, "#2a2a2a"),
      pants: phong(uniform.pants, 18, "#242424"),
      trim: phong(uniform.trim, 34, "#333333"),
      helmet: new MeshPhongMaterial({ color: uniform.helmet, shininess: 78, specular: "#9a9a9a" }),
      skin: isAlien
        ? phong(alienSkin(actor.playerId), 52, "#5b6b58")
        : new MeshPhongMaterial({ color: ROBOT_METAL, shininess: 92, specular: "#b9c0c8" }),
      dark: phong(DARK_PART, 40, "#3a3a3a"),
      // Big glossy eyes are most of an alien's face.
      eye: new MeshPhongMaterial({ color: GLOSS_BLACK, shininess: 140, specular: "#ffffff" }),
      glint: new MeshPhongMaterial({ color: "#ffffff", emissive: "#8899aa" }),
      glow: new MeshPhongMaterial({
        color: EYE_GLOW,
        emissive: EYE_GLOW,
        emissiveIntensity: 1,
        shininess: 100,
        specular: "#ffffff",
      }),
      lamp: new MeshPhongMaterial({
        color: uniform.trim,
        emissive: uniform.trim,
        emissiveIntensity: 0.85,
      }),
      boot: phong(BOOT, 30, "#3a3a3a"),
      glove: phong("#7a4f2a", 16, "#3a2a1c"),
      // Worn-in leather is darker in the pocket and at the heel.
      gloveDark: phong("#4e3119", 12, "#2a1c10"),
      lace: phong("#e0bc86", 20, "#4a3a24"),
      bat: phong("#c89a5c", 30, "#4a4a4a"),
    };
  }, [uniform, actor.playerId, isAlien]);

  const label = labelText ?? actor.shortName;

  const numberMaterial = useMemo(() => {
    if (!actor.number) return null;
    return new MeshPhongMaterial({
      map: getNumberTexture(actor.number, uniform.jersey, uniform.trim),
      shininess: 12,
    });
  }, [actor.number, uniform.jersey, uniform.trim]);

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
      numberMaterial?.dispose();
    };
  }, [materials, numberMaterial]);

  const { model, limbs } = useMemo(() => {
    const root = new Group();
    root.scale.setScalar(SCALE);

    const add = (
      parent: Group,
      geometry: BufferGeometry,
      material: Material,
      position: [number, number, number],
      scale: [number, number, number] = [1, 1, 1],
      rotation?: [number, number, number],
      shadow = false,
    ) => {
      const mesh = new Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      if (rotation) mesh.rotation.set(...rotation);
      // Only the large masses cast shadows; fingers and lamps are not worth
      // the extra shadow-map draws across a full roster.
      mesh.castShadow = shadow;
      parent.add(mesh);
      return mesh;
    };

    const hips = new Group();
    hips.position.y = HIP_HEIGHT;
    root.add(hips);
    add(hips, GEO.pelvis, materials.pants, [0, -0.12, 0], [1, 1, 1], undefined, true);

    // --- Legs -------------------------------------------------------------
    const makeLeg = (side: number) => {
      const hip = new Group();
      hip.position.set(side * 0.44, -0.24, 0);
      hips.add(hip);

      if (isAlien) {
        add(hip, GEO.joint, materials.pants, [0, 0, 0], [0.5, 0.5, 0.5]);
        add(hip, GEO.capsule, materials.pants, [0, -0.64, 0], [1, 1, 1], undefined, true);
      } else {
        add(hip, GEO.joint, materials.dark, [0, 0, 0], [0.52, 0.52, 0.52]);
        add(hip, GEO.thighBlock, materials.pants, [0, -0.66, 0], [1, 1, 1], undefined, true);
        add(hip, GEO.joint, materials.dark, [0, -1.3, 0], [0.5, 0.5, 0.5]);
      }

      const knee = new Group();
      knee.position.y = -1.32;
      hip.add(knee);

      if (isAlien) {
        add(knee, GEO.capsule, materials.skin, [0, -0.52, 0], [0.82, 0.85, 0.82], undefined, true);
        // Sock cuff where the uniform meets the leg.
        add(knee, GEO.rod, materials.trim, [0, -0.12, 0], [0.58, 0.3, 0.58]);
        // Three-toed foot.
        for (const toe of [-0.26, 0, 0.26]) {
          add(knee, GEO.toe, materials.boot, [toe, -1.16, 0.32]);
        }
        add(knee, GEO.foot, materials.boot, [0, -1.18, -0.06], [0.86, 0.8, 0.6]);
      } else {
        add(knee, GEO.shinBlock, materials.skin, [0, -0.5, 0], [1, 1, 1], undefined, true);
        add(knee, GEO.rod, materials.trim, [0, -0.06, 0], [0.56, 0.22, 0.56]);
        add(knee, GEO.foot, materials.boot, [0, -1.12, 0.16], [1, 1, 1], undefined, true);
        add(knee, GEO.toe, materials.dark, [0, -1.12, 0.72], [1.5, 0.9, 0.5]);
      }
      return { hip, knee };
    };
    const left = makeLeg(1);
    const right = makeLeg(-1);

    // --- Torso ------------------------------------------------------------
    const torso = new Group();
    hips.add(torso);
    const chest = isAlien ? GEO.chestSlim : GEO.chestWide;
    add(torso, chest, materials.jersey, [0, 0.86, 0], [1, 1, 1], undefined, true);
    add(torso, GEO.belt, materials.trim, [0, 0.13, 0]);

    // Jersey number, on a plate across the shoulder blades.
    if (numberMaterial) {
      const depth = isAlien ? 0.94 : 1.06;
      add(
        torso,
        GEO.plane,
        numberMaterial,
        [0, 1.0, -(depth / 2 + 0.012)],
        [0.86, 0.86, 1],
        [0, Math.PI, 0],
      );
    }

    if (isAlien) {
      add(torso, GEO.ring, materials.trim, [0, 1.6, 0], [1.15, 1.15, 1.15], [Math.PI / 2, 0, 0]);
      add(torso, GEO.emblem, materials.trim, [0, 1.02, 0.48]);
      // Piping down the flanks.
      for (const side of [-1, 1]) {
        add(torso, GEO.box, materials.trim, [side * 0.86, 0.9, 0], [0.06, 1.2, 0.5]);
        add(torso, GEO.lowSphere, materials.jersey, [side * 0.94, 1.48, 0], [0.6, 0.5, 0.6]);
      }
      add(torso, GEO.taper, materials.skin, [0, 1.88, 0], [0.46, 0.42, 0.46]);
    } else {
      // Chest plate with status lights and cooling vents.
      add(torso, GEO.chestPanel, materials.dark, [0, 0.98, 0.53]);
      for (const [i, x] of [-0.3, 0, 0.3].entries()) {
        add(torso, GEO.lowSphere, i === 1 ? materials.glow : materials.lamp, [x, 1.16, 0.6], [0.17, 0.17, 0.12]);
      }
      for (const y of [0.72, 0.6, 0.48]) {
        add(torso, GEO.vent, materials.dark, [0, y, 0.58]);
      }
      for (const side of [-1, 1]) {
        add(torso, GEO.pauldron, materials.trim, [side * 1.0, 1.5, 0], [1, 1, 1], undefined, true);
      }
      add(torso, GEO.rod, materials.dark, [0, 1.88, 0], [0.42, 0.42, 0.42]);
      // Backpack.
      add(torso, GEO.limbBlock, materials.trim, [0, 1.0, -0.62], [1.5, 1.1, 0.5]);
    }

    // --- Arms -------------------------------------------------------------
    const rig = isAlien ? ARM.alien : ARM.robot;
    const makeArm = (side: number) => {
      const shoulder = new Group();
      shoulder.position.set(side * rig.shoulderX, ARM.shoulderY, 0);
      torso.add(shoulder);

      if (isAlien) {
        add(shoulder, GEO.capsule, materials.jersey, [0, -0.46, 0], [0.72, 0.72, 0.72], undefined, true);
        add(shoulder, GEO.rod, materials.trim, [0, -0.86, 0], [0.44, 0.14, 0.44]);
      } else {
        add(shoulder, GEO.joint, materials.dark, [0, 0, 0], [0.52, 0.52, 0.52]);
        add(shoulder, GEO.limbBlock, materials.jersey, [0, -0.5, 0], [1, 1, 1], undefined, true);
        add(shoulder, GEO.joint, materials.dark, [0, -0.98, 0], [0.46, 0.46, 0.46]);
      }

      const elbow = new Group();
      elbow.position.y = ARM.elbowY;
      shoulder.add(elbow);

      if (isAlien) {
        add(elbow, GEO.capsule, materials.skin, [0, -0.44, 0], [0.6, 0.68, 0.6], undefined, true);
        add(elbow, GEO.lowSphere, materials.skin, [0, -0.86, 0], [0.4, 0.36, 0.34]);
        for (const finger of [-0.19, 0, 0.19]) {
          add(elbow, GEO.finger, materials.skin, [finger, -1.12, 0.02]);
        }
      } else {
        add(elbow, GEO.limbBlock, materials.skin, [0, -0.44, 0], [0.92, 0.95, 0.92], undefined, true);
        add(elbow, GEO.box, materials.dark, [0, -0.94, 0], [0.44, 0.3, 0.42]);
        // Two-fingered claw.
        for (const finger of [-0.15, 0.15]) {
          add(elbow, GEO.finger, materials.dark, [finger, -1.2, 0.04], [1, 0.8, 1]);
        }
      }
      return { shoulder, elbow };
    };
    const armL = makeArm(1);
    const armR = makeArm(-1);

    // --- Head -------------------------------------------------------------
    const head = new Group();
    head.position.y = 2.12;
    torso.add(head);
    const danglers: Group[] = [];
    let batGroup: Group | null = null;

    if (isAlien) {
      // A tall teardrop cranium tapering to a small chin.
      add(head, GEO.sphere, materials.skin, [0, 0.8, 0], [1.52, 1.94, 1.36], undefined, true);
      add(head, GEO.sphere, materials.skin, [0, 0.16, 0.06], [0.94, 0.92, 1.02]);
      // Brow ridge. Skipped under a helmet, where the brim occupies exactly
      // this space and the ridge would poke through it.
      if (!wearsHelmet) {
        add(head, GEO.box, materials.skin, [0, 0.98, 0.5], [1.02, 0.12, 0.24]);
      }
      for (const side of [-1, 1]) {
        add(
          head,
          GEO.sphere,
          materials.eye,
          [side * 0.34, 0.68, 0.52],
          [0.52, 0.8, 0.3],
          [0.2, side * 0.36, side * -0.44],
        );
        add(head, GEO.lowSphere, materials.glint, [side * 0.44, 0.9, 0.63], [0.1, 0.12, 0.06]);
      }
      add(head, GEO.box, materials.eye, [0, 0.06, 0.5], [0.3, 0.05, 0.1]);

      for (const side of [-1, 1]) {
        const antenna = new Group();
        // Under a helmet they come out through the back rather than straight
        // up through the shell.
        if (wearsHelmet) {
          antenna.position.set(side * 0.34, 1.16, -0.62);
          antenna.rotation.set(-0.6, 0, side * 0.34);
        } else {
          antenna.position.set(side * 0.3, 1.5, -0.05);
          antenna.rotation.z = side * 0.26;
        }
        head.add(antenna);
        add(antenna, GEO.taper, materials.skin, [0, 0.3, 0], [0.11, 0.62, 0.11]);
        add(antenna, GEO.lowSphere, materials.lamp, [0, 0.66, 0], [0.24, 0.24, 0.24]);
        danglers.push(antenna);
      }

      // Only hitters and runners wear anything on their heads: a cap perched
      // on a tapered alien cranium never sat right. The cranium is tall and
      // narrow, so the helmet is scaled to match rather than sat on top.
      if (wearsHelmet) {
        // Rim just above the eyes; the shell is stretched tall (height 1.05)
        // because there is a whole cranium above that line to cover.
        const lid = new Group();
        lid.position.set(0, 0.95, 0);
        lid.scale.set(0.75, 0.72, 0.69);
        head.add(lid);
        buildHelmet(add, lid, materials, { flaps: helmetFlaps, flapSide, height: 1.05 });
      }
    } else {
      add(head, GEO.robotSkull, materials.skin, [0, 0.66, 0], [1, 1, 1], undefined, true);
      // Recessed visor with a glowing band inside it.
      add(head, GEO.visor, materials.dark, [0, 0.74, 0.52]);
      add(head, GEO.eyeBand, materials.glow, [0, 0.74, 0.6]);
      // Mouth grille.
      for (const y of [0.34, 0.24, 0.14]) {
        add(head, GEO.vent, materials.dark, [0, y, 0.56], [0.9, 1, 0.6]);
      }
      for (const side of [-1, 1]) {
        add(head, GEO.rod, materials.dark, [side * 0.74, 0.68, 0], [0.3, 0.16, 0.3], [0, 0, Math.PI / 2]);
        add(head, GEO.rod, materials.trim, [side * 0.82, 0.68, 0], [0.2, 0.06, 0.2], [0, 0, Math.PI / 2]);
      }
      add(head, GEO.crest, materials.trim, [0, 1.3, -0.06]);

      const antenna = new Group();
      if (wearsHelmet) {
        antenna.position.set(0.4, 1.0, -0.66);
        antenna.rotation.set(-0.55, 0, 0.2);
      } else {
        antenna.position.set(0.44, 1.24, -0.1);
      }
      head.add(antenna);
      add(antenna, GEO.taper, materials.dark, [0, 0.26, 0], [0.09, 0.54, 0.09]);
      add(antenna, GEO.lowSphere, materials.lamp, [0, 0.58, 0], [0.2, 0.2, 0.2]);
      danglers.push(antenna);

      if (wearsHelmet) {
        // A box skull has only a little headroom above the visor, so the shell
        // is flat (height 0.46) and wide enough to swallow the top corners -
        // an ellipsoid needs the width to contain a box.
        const lid = new Group();
        lid.position.set(0, 1.0, 0);
        lid.scale.set(0.84, 0.81, 0.78);
        head.add(lid);
        buildHelmet(add, lid, materials, { flaps: helmetFlaps, flapSide, height: 0.58 });
      }
    }

    // --- Equipment --------------------------------------------------------
    if (actor.role === "batter") {
      // Pinned to where the arm chain actually puts the hands, and built so the
      // taped section of the handle straddles that point - the hands close on
      // the grip rather than on thin air next to it.
      batGroup = new Group();
      batGroup.position.copy(handAnchor(isAlien, BAT_STANCE));
      batGroup.quaternion.setFromUnitVectors(UP, BAT_REST_AXIS);
      torso.add(batGroup);

      add(batGroup, GEO.batKnob, materials.dark, [0, -0.46, 0], [1.1, 0.18, 1.1]);
      add(batGroup, GEO.batHandle, materials.dark, [0, -0.06, 0], [1.4, 0.68, 1.4]);
      add(batGroup, GEO.batHandle, materials.bat, [0, 0.58, 0], [1.1, 0.62, 1.1]);
      add(batGroup, GEO.batBarrel, materials.bat, [0, 1.74, 0], [1.15, 1.86, 1.15], undefined, true);
      add(batGroup, GEO.lowSphere, materials.bat, [0, 2.66, 0], [0.46, 0.26, 0.46]);
    } else if (actor.role === "fielder") {
      // Built pointing "up" from the wrist, then flipped onto the end of the
      // forearm: rolling about Z keeps the pocket facing forward while the
      // fingers carry on down the arm.
      const kind = gloveFor(actor.positionKey);
      const glove = new Group();
      glove.position.set(0, -1.02, 0.1);
      // The catcher presents the mitt down the arm at the pitcher; everyone
      // else carries the glove with the pocket facing forward.
      glove.rotation.set(kind === "mitt" ? 1.9 : 0.24, 0, Math.PI);
      glove.scale.setScalar(kind === "mitt" ? 0.92 : 0.84);
      armL.elbow.add(glove);
      buildGlove(add, glove, materials, kind, 1);
    }

    const parts: Limbs = {
      hips,
      torso,
      head,
      legL: left.hip,
      legR: right.hip,
      kneeL: left.knee,
      kneeR: right.knee,
      armL: armL.shoulder,
      armR: armR.shoulder,
      elbowL: armL.elbow,
      elbowR: armR.elbow,
      danglers,
      bat: batGroup,
    };
    return { model: root, limbs: parts };
  }, [
    materials,
    numberMaterial,
    actor.role,
    actor.positionKey,
    isAlien,
    wearsHelmet,
    helmetFlaps,
    flapSide,
  ]);

  // The frame loop mutates the three.js graph in place, which is the R3F
  // contract but not something a memoized value may be used for.
  useLayoutEffect(() => {
    limbsRef.current = limbs;
  }, [limbs]);

  useFrame((state, delta) => {
    const group = rootRef.current;
    const parts = limbsRef.current;
    if (!group || !parts) return;

    const live = director.actors.get(key);
    if (!live) {
      group.visible = false;
      return;
    }
    group.visible = live.visible;
    if (!live.visible) return;

    group.position.copy(live.position);

    // Beamed out: drawn up into the column and shrinking as they go. A
    // non-uniform stretch was the first attempt and it pulled the figure apart.
    const gone = live.dissolve ?? 0;
    if (gone > 0) {
      group.position.y += gone * gone * 11;
      const shrink = 1 - gone * 0.92;
      group.scale.set(shrink, 1 - gone * 0.6, shrink);
    } else if (group.scale.x !== 1) {
      group.scale.set(1, 1, 1);
    }
    // Ease the yaw so runners do not snap around corners.
    const current = group.rotation.y;
    let diff = live.facing - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    group.rotation.y = current + diff * Math.min(1, delta * 12);

    const v = poseValues(
      live.pose,
      live.poseT,
      state.clock.elapsedTime + live.playerId,
      actor.role === "batter",
    );
    // Leaning the legs sideways shortens their vertical reach, so the hips have
    // to come down by the same amount or the boots lift off the grass.
    parts.hips.position.y =
      HIP_HEIGHT -
      v.crouch +
      v.bob -
      (LEG_REACH - v.crouch) * (1 - Math.cos(v.legSplay));
    parts.hips.position.x = v.sway;
    parts.torso.position.y = v.chest;
    parts.torso.rotation.x = v.lean;
    parts.torso.rotation.y = v.twist;
    parts.torso.rotation.z = v.roll;
    parts.head.rotation.x = v.headTilt - v.lean;
    parts.head.rotation.y = v.headYaw - v.twist;
    parts.legL.rotation.x = v.legL;
    parts.legR.rotation.x = v.legR;
    // Both legs lean together, so the hips can travel over a planted foot.
    parts.legL.rotation.z = v.legSplay;
    parts.legR.rotation.z = v.legSplay;
    parts.kneeL.rotation.x = v.kneeL;
    parts.kneeR.rotation.x = v.kneeR;
    parts.armL.rotation.x = v.armL;
    parts.armR.rotation.x = v.armR;
    parts.armL.rotation.z = -v.armSpread;
    parts.armR.rotation.z = v.armSpread;
    parts.elbowL.rotation.set(v.elbowL, 0, -v.elbowIn);
    parts.elbowR.rotation.set(v.elbowR, 0, v.elbowIn);

    if (parts.bat) {
      // Dropped at the plate the moment they leave the box, however they got
      // on: a run, a trot, or a walk.
      parts.bat.visible =
        live.role === "batter" && BATTING_POSES.has(live.pose);
      // The bat starts cocked and levels off as the swing fires, so it travels
      // through the zone instead of staying welded to the shoulder.
      BAT_AIM.copy(BAT_REST_AXIS).lerp(BAT_SWING_AXIS, v.batSwing).normalize();
      parts.bat.quaternion.setFromUnitVectors(UP, BAT_AIM);
    }

    // Sprites grow as the camera closes in, which is exactly wrong for a name
    // plate: on a tight shot it would fill the frame. Scale it back down by
    // distance so it reads the same size wherever the camera is.
    const plate = labelRef.current;
    if (plate) {
      const distance = state.camera.position.distanceTo(group.position);
      const size = 4.6 * Math.max(0.34, Math.min(1.25, distance / 95));
      plate.scale.set(labelAspect(label) * size, size, 1);
    }

    // Antennae lag behind the head, which sells the motion.
    const wobble = Math.sin(state.clock.elapsedTime * 5 + live.playerId) * 0.14;
    for (let i = 0; i < parts.danglers.length; i++) {
      const dangler = parts.danglers[i];
      dangler.rotation.x = -v.lean * 0.85 + wobble * (i === 0 ? 1 : -1);
    }
  });

  return (
    <group ref={rootRef} position={actor.position} rotation={[0, actor.facing, 0]}>
      <primitive object={model} />
      {showLabel && (
        <sprite ref={labelRef} position={[0, 17.2, 0]}>
          <spriteMaterial map={getLabelTexture(label, accent)} depthTest={false} transparent />
        </sprite>
      )}
    </group>
  );
}
