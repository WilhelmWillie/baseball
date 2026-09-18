"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhongMaterial,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  type PerspectiveCamera,
  type Sprite,
  TorusGeometry,
  Vector3,
  type Material,
} from "three";
import type { Actor, Pose } from "@/lib/anim/director";
import {
  FIGURE_SCALE,
  LEG_REACH,
  SHIN,
  SWING,
  THIGH,
  TOE_AHEAD,
  legAt,
  type Gait,
} from "@/lib/anim/gait";
import type { Uniform } from "@/lib/mlb/teams";
import type { Species } from "@/lib/game/species";
import { egg, panel, roundedBox } from "./geometry";
import { getLabelTexture, getNumberTexture, labelAspect } from "./textures";

/**
 * Two species share one skeleton, so the whole pose vocabulary drives both:
 * the home club are aliens, the visitors are robots. Team colors still carry
 * the uniform, which makes the species a second, redundant read on who is who -
 * and the panel and the board in the park put the same two faces on their team
 * chips, which is why the type lives outside the 3D layer.
 */
export type { Species };

/**
 * Cartoon scale. Deliberately far larger than life - these figures exist to
 * communicate the state of the game from a camera 80 feet up, not to be
 * anatomically sensible next to a 90-foot base path.
 *
 * It lives in `@/lib/anim/gait` rather than here because the locomotion has to
 * know it: a stride measured in model units is only a speed once you know how
 * many feet a model unit is worth.
 */
const SCALE = FIGURE_SCALE;

/** `tan(fov/2)` of the broadcast lens, which name plates are sized against. */
const BASE_LENS = Math.tan((50 * Math.PI) / 360);

/** How high the name plate floats over the actor's feet. */
const LABEL_HEIGHT = 18.6;

/**
 * Where the head is seated, in torso space: at the top of the neck rather than
 * a head's length above it. These figures are chibi - the head is the biggest
 * single mass on the body and there is next to no neck under it - so this is
 * far lower than it would be on a figure built to human proportions.
 */
const HEAD_Y = 1.58;
const PLATE_AT = new Vector3();

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
const BAT_STANCE = { arm: -0.82, elbow: -1.72, spread: 0.26, elbowIn: 0.86 };

/**
 * How far the hitter's head comes round off his shoulders to watch the pitcher,
 * signed by which box he is in.
 *
 * A stance is square to the plate, so a hitter who only faced the way his chest
 * does would spend the at-bat looking at the catcher. A real one turns his head
 * most of a right angle; so does this one, which is also what puts his face
 * toward the camera in centre field rather than the back of his helmet.
 */
const LOOK_AT_MOUND = 1.46;

/**
 * Bat attitude in torso space, as a direction from the hands to the barrel.
 * At rest it stands up over the shoulder and *out over the plate*; through the
 * swing it levels off and comes across the body, with the torso twist carrying
 * it the rest of the way through the zone.
 *
 * That forward lean is not decoration. The hands sit at z = 0.84 and the head
 * is a chibi head - a foot of skull in every direction from the neck - so a bat
 * cocked back behind the hands passes straight through it, and one cocked
 * sideways has to lie almost flat to clear it. Leaning the barrel out over the
 * plate keeps the whole bat in front of the face at any angle the swing takes.
 */
const BAT_REST_AXIS = new Vector3(-0.52, 0.76, 0.39).normalize();
const BAT_SWING_AXIS = new Vector3(-0.82, 0.02, 0.57).normalize();
const UP = new Vector3(0, 1, 0);
/** Scratch, so the frame loop allocates nothing. */
const BAT_AIM = new Vector3();

/**
 * The arm skeleton, shared by the model builder and by `handAnchor` so the two
 * can never disagree about where a hand ends up.
 */
const ARM = {
  shoulderY: 1.4,
  elbowY: -0.92,
  alien: { shoulderX: 0.96, handY: -0.84 },
  robot: { shoulderX: 1.04, handY: -0.9 },
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

// Soft greens, because a grey alien is a horror-film alien. The variation is
// warm-to-cool across a narrow band rather than a spread of hues, so a roster
// reads as individuals without anyone looking radioactive.
const ALIEN_SKIN = ["#8fd08a", "#a3d493", "#7fc7a0", "#9ad3a2", "#86cc92"];
const ROBOT_METAL = "#ece4cd";
const DARK_PART = "#50666a";
const EYE_GLOW = "#b8ffdf";
const GLOSS_BLACK = "#0d1014";
/** The face screen a robot's eyes are drawn on - darker than any panel. */
const SCREEN = "#233f48";
const BOOT = "#252930";

/**
 * Which face a robot happens to be wearing. There is exactly one screen and
 * three ways of lighting it, picked off the player id the way an alien's skin
 * is: a squint, a pair of level bars, and wide open eyes. Nine robots in the
 * field with one expression between them read as nine copies of a prop.
 */
const ROBOT_FACES = ["happy", "level", "wide"] as const;
type RobotFace = (typeof ROBOT_FACES)[number];

function robotFace(playerId: number): RobotFace {
  return ROBOT_FACES[playerId % ROBOT_FACES.length];
}

/**
 * An arc of tube, used for everything drawn as a *curve* rather than as a
 * block: an alien's smile, a robot's eyes. `sweep` is how much of the circle it
 * covers and the arc is centred on the bottom of it, so the shape as built is a
 * cup - turn it over with a half rotation about Z for a cap.
 */
function arc(sweep: number, tube = 0.12): BufferGeometry {
  const geometry = new TorusGeometry(0.5, tube, 10, 32, sweep);
  geometry.rotateZ(-Math.PI / 2 - sweep / 2);
  return geometry;
}

/** Shared geometry - every player reuses these buffers. */
const GEO = {
  box: new BoxGeometry(1, 1, 1),
  plane: new PlaneGeometry(1, 1),
  sphere: new SphereGeometry(0.5, 32, 24),
  bead: new SphereGeometry(0.5, 20, 14),
  joint: new SphereGeometry(0.5, 24, 16),
  capsule: new CapsuleGeometry(0.32, 0.6, 8, 20),
  rod: new CylinderGeometry(0.5, 0.5, 1, 24),
  disc: new CylinderGeometry(0.5, 0.5, 1, 32),
  taper: new CylinderGeometry(0.42, 0.5, 1, 24),
  dome: new SphereGeometry(0.5, 32, 20, 0, Math.PI * 2, 0, Math.PI / 1.85),
  ring: new TorusGeometry(0.5, 0.11, 8, 20),
  /** The bellows the head sits on, and the ribs of it. */
  bellows: new TorusGeometry(0.5, 0.17, 8, 16),
  /** The head an alien wears: one lathed surface, no seams to hide. */
  cranium: egg(0.08),
  smile: arc(1.5, 0.075),
  /** Three ways of lighting a face screen. */
  eyeHappy: arc(2.3, 0.13),
  eyeWide: new SphereGeometry(0.5, 14, 10),
  // A bat, in three pieces: knob, handle, and a barrel that flares out to the
  // far end. The old single taper had the fat end at the hands.
  batKnob: new CylinderGeometry(0.15, 0.13, 1, 10),
  batHandle: new CylinderGeometry(0.085, 0.075, 1, 10),
  batBarrel: new CylinderGeometry(0.2, 0.1, 1, 12),

  // Chamfered panels. The radii are deliberately generous - a chibi figure is
  // a pile of pillows, and a hard edge anywhere on it reads as a different
  // character entirely.
  pelvis: roundedBox(1.46, 0.64, 1.02, 0.26),
  chestSlim: roundedBox(1.74, 1.4, 1.08, 0.48),
  chestWide: roundedBox(1.9, 1.42, 1.2, 0.52),
  belt: roundedBox(1.7, 0.22, 0.98, 0.1),
  emblem: panel(0.52, 0.52, 0.1),
  /** A shoulder cap, rounded over the top rather than slabbed across it. */
  pauldron: roundedBox(0.86, 0.62, 1.0, 0.3),
  limbBlock: roundedBox(0.58, 0.86, 0.58, 0.26),
  shinBlock: roundedBox(0.56, 0.82, 0.56, 0.25),
  thighBlock: roundedBox(0.7, 1.06, 0.7, 0.3),
  /** A continuous, pill-shaped enamel shell around the face screen. */
  robotSkull: roundedBox(2.12, 1.8, 1.62, 0.68, 6),
  /** The recess the screen sits in, and the glass itself. */
  socket: roundedBox(1.86, 1.18, 0.64, 0.3),
  screen: roundedBox(1.69, 1.02, 0.58, 0.28),
  eyeBar: roundedBox(0.6, 0.16, 0.1, 0.07),
  chestPanel: roundedBox(1.0, 0.72, 0.14, 0.14),
  /** Feet, which a chibi figure wears two sizes too big. */
  foot: roundedBox(0.9, 0.42, 1.44, 0.2),
  sole: roundedBox(0.92, 0.14, 1.42, 0.07),
  crest: roundedBox(0.24, 0.2, 1.1, 0.09),
  brim: roundedBox(1.12, 0.13, 0.66, 0.06),
  earFlap: roundedBox(0.16, 0.46, 0.54, 0.07),
  vent: roundedBox(0.6, 0.09, 0.12, 0.04),
  finger: roundedBox(0.17, 0.4, 0.17, 0.08),
  /** A hand, as a mitt rather than a set of knuckles. */
  mitt: roundedBox(0.56, 0.5, 0.5, 0.22),
  toe: roundedBox(0.26, 0.22, 0.46, 0.1),

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

/** Face and helmet anchors, measured inside the continuous rounded shell. */
const ROBOT_SCREEN_Y = 0.83;
const ROBOT_BROW_Y = 1.32;
const ROBOT_CROWN = 1.87;
/** Helmet rim just above the screen, around the shell's rounded crown. */
const ROBOT_RIM_Y = 1.2;

/**
 * The alien's, the same way: one egg of a cranium centred here, ending there,
 * with the eyes on a line the helmet rim has to clear.
 */
const ALIEN_SKULL_Y = 0.98;
const ALIEN_SKULL_TOP = ALIEN_SKULL_Y + 1.08;
const ALIEN_EYE_Y = ALIEN_SKULL_Y - 0.02;
const ALIEN_RIM_Y = 1.54;

/**
 * Eyes on the face screen. One pair of glowing shapes, in whichever of the
 * three expressions this robot wears - see {@link robotFace}. They are drawn as
 * curves rather than as blocks because a curve is what makes a screen read as a
 * face: two level bars are a machine, the same two bars bent up at the ends are
 * pleased to be here.
 */
function buildRobotEyes(
  addTo: AddPart,
  head: Group,
  glow: Material,
  y: number,
  z: number,
  face: RobotFace,
) {
  for (const side of [-1, 1]) {
    const x = side * 0.38;
    if (face === "happy") {
      // A squint: the cup turned over, so it arches up over the eye.
      addTo(head, GEO.eyeHappy, glow, [x, y - 0.04, z], [0.62, 0.42, 0.5], [0, 0, Math.PI]);
    } else if (face === "level") {
      addTo(head, GEO.eyeBar, glow, [x, y, z], [1, 1, 1]);
    } else {
      // Wide open, and tilted slightly inward so they read as a face rather
      // than as two lamps.
      addTo(head, GEO.eyeWide, glow, [x, y, z], [0.44, 0.54, 0.2], [0, 0, side * 0.16]);
    }
  }
}

/**
 * How tall to build a helmet whose shell has to rise `clear` above the rim,
 * inside a lid scaled by `lidY`.
 *
 * The shell is a sphere cut a little past its equator and stretched by
 * `height`, and the arithmetic of that cut - see {@link buildHelmet} - leaves
 * the top of it `1.156 * height` above the rim. Solving that here rather than
 * guessing is what lets two very differently shaped heads share one shell.
 */
function helmetHeight(clear: number, lidY: number): number {
  return clear / (1.156 * lidY);
}

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
  addTo(parent, GEO.bead, trim, [0, 1.14 * h, -0.04], [0.18, 0.18, 0.18]);
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
    addTo(parent, GEO.bead, gloveDark, [0, 0.98, 0.1], [1.36, 1.36, 0.5]);
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
 * A squat that keeps its feet. Flexing the hip by `SQUAT_HIP` and the knee by
 * `SQUAT_KNEE` folds the leg into a Z; this pair is chosen so the sole ends up
 * back under the same spot of grass it started on, at any depth. The hips then
 * have to drop by however much vertical reach the fold cost, which is what
 * `squat` works out - guessing at it instead is what buries the boots.
 */
const SQUAT_HIP = 0.5;
const SQUAT_KNEE = 1.077;

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

/**
 * One frame of a gait, built from the same stride table its cadence is derived
 * from - see `@/lib/anim/gait`. `t` is the phase through the cycle, 0..1, and
 * the director advances it by however many cycles the ground under the figure
 * has gone by, which is what keeps the boots from sliding.
 *
 * There is deliberately no per-gait code here. Sprinting, running and walking
 * differ by how far the hips swing, how much of the cycle a foot spends down,
 * how hard the knee drives through the air and how far the torso is pitched
 * over - all of it numbers, all of it in one table. Anything written as a
 * special case for one of the three would be a fourth thing to keep in step
 * with the cadence, and the cadence is the only reason this works.
 */
function gaitPose(gait: Gait, t: number, life: ReturnType<typeof idleLife>): PoseValues {
  const swing = SWING[gait];
  const left = legAt(swing, t);
  const right = legAt(swing, t + 0.5);

  // The hips ride on whichever foot is down - on both of them through the
  // double support of a walk - so a planted sole holds its height as well as
  // its place. This is also where the bounce comes from, for nothing: a leg is
  // at its longest directly under the hip and shortest at either end of its
  // stride, so the body rises and falls over each step on its own.
  const weight = left.support + right.support;
  const dropL = legDrop(left.hip, left.knee);
  const dropR = legDrop(right.hip, right.knee);
  const crouch =
    weight > 0
      ? (dropL * left.support + dropR * right.support) / weight
      : Math.min(dropL, dropR);
  // Nothing is holding a sprinter up for a third of every cycle, and a figure
  // that stays at a constant height through that is a figure skating.
  const flight = Math.max(0, 1 - weight);

  // Arms oppose the legs: the left arm is back when the left leg is forward,
  // which is at phase zero. Nothing about the arms has to be slip-free, so
  // they run on a plain sine.
  const pump = Math.cos(t * Math.PI * 2);

  return {
    ...REST,
    crouch,
    bob: swing.bob * flight,
    lean: swing.lean,
    // Shoulders counter-rotate against the hips, a little, late.
    twist: -pump * swing.arm * 0.13,
    roll: pump * swing.arm * 0.05,
    legL: left.hip,
    legR: right.hip,
    kneeL: left.knee,
    kneeR: right.knee,
    armL: swing.arm * pump,
    armR: -swing.arm * pump,
    elbowL: swing.elbow,
    elbowR: swing.elbow,
    armSpread: swing.spread,
    // Eyes up and level. `headTilt` is read back as `headTilt - lean` - see the
    // render step - so it describes where the head is pointing in the world
    // rather than relative to a torso that is already pitched over: near zero
    // is a runner looking down the line, which is what a runner does however
    // far forward the rest of him is folded.
    headTilt: swing.lean * 0.1,
    headYaw: gait === "walk" ? life.headYaw * 0.5 : 0,
  };
}

function poseValues(
  pose: Pose,
  t: number,
  clock: number,
  isBatter = false,
  batSide: "R" | "L" = "R",
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
      headYaw: (batSide === "R" ? LOOK_AT_MOUND : -LOOK_AT_MOUND) + life.headYaw * 0.16,
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
    case "sprint":
    case "run":
    case "walk":
      return gaitPose(pose, t, life);
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
      // Three beats instead of two: a coil that gathers rather than moving at
      // one speed, an explosive turn through the ball, and a last fifth that
      // unwinds slightly instead of holding at full extension. That last part
      // is what the pose switch back to "ready" lands on when the swing ends -
      // freezing at maximum twist made that cut read as a snap back rather
      // than a follow-through settling out.
      const load = clamp01(t / 0.28);
      const loadEase = load * load;
      const fireRaw = clamp01((t - 0.28) / 0.72);
      // easeOutCubic: the turn explodes rather than ramping at a constant
      // rate, then eases off - closer to how a real swing decelerates once
      // the bat is already out in front of the plate.
      const fire = 1 - (1 - fireRaw) ** 3;
      const unwind = fireRaw > 0.82 ? (fireRaw - 0.82) / 0.18 : 0;
      const twist = (0.7 * loadEase - 2.75 * fire) * (1 - 0.16 * unwind);
      const mound = batSide === "R" ? LOOK_AT_MOUND : -LOOK_AT_MOUND;
      // `headYaw` is read back as `headYaw - twist` (see the render step
      // below), so it only has to describe how far the head leads or trails
      // the shoulders, not fight the torso's own rotation. Without the
      // `+ twist` term the head would spin along with the torso instead of
      // holding on the pitch - it starts looking where "ready" left it and
      // eases toward square as the eyes come off the mound and onto the ball.
      const headYaw = twist + mound * (1 - 0.7 * fire);
      return {
        ...REST,
        crouch: 0.17 + 0.05 * fire,
        lean: 0.08 + 0.1 * fire - 0.06 * unwind,
        twist,
        // The back leg pivots up onto the toe as the hips clear; the front
        // one plants and takes the weight coming forward.
        legL: -0.5 + 0.32 * loadEase + 0.14 * fire,
        legR: -0.5 - 0.2 * fire,
        kneeL: 0.55 - 0.1 * fire,
        kneeR: 0.55 + 0.32 * fire,
        // The arms barely leave the stance: the bat is anchored to where these
        // angles put the hands, so anything more and the grip visibly lets go.
        // The twist above is what carries the bat through the zone.
        armL: BAT_STANCE.arm - 0.07 * loadEase + 0.2 * fire,
        armR: BAT_STANCE.arm - 0.07 * loadEase + 0.2 * fire,
        elbowL: BAT_STANCE.elbow - 0.08 * loadEase + 0.26 * fire,
        elbowR: BAT_STANCE.elbow - 0.08 * loadEase + 0.26 * fire,
        armSpread: BAT_STANCE.spread - 0.1 * fire,
        elbowIn: BAT_STANCE.elbowIn - 0.14 * fire,
        headYaw,
        headTilt: -0.06 * fire,
        roll: 0.05 * fire,
        chest: 0.03 * fire,
        batSwing: fire,
      };
    }
    case "dive": {
      // Laid out at a ball going past. Two beats: the arms are thrown out ahead
      // first and the body follows them down, so it reads as reaching rather
      // than as falling over.
      //
      // The rig only yaws, so the figure cannot actually go horizontal. What
      // sells it instead is the torso folding to seventy degrees over hips
      // dropped to shin height, with the legs trailing and the heels kicked up
      // behind - and the heels are the reason this pose owes the ground
      // `legDrop` like any other. Folding the knee up hard is what buys the
      // hips their depth without putting the boots through the dirt.
      const reach = clamp01(t / 0.3);
      const land = clamp01((t - 0.25) / 0.55);
      const hip = 0.55 * reach;
      const knee = 1.5 * land;
      return {
        ...REST,
        crouch: legDrop(hip, knee),
        lean: 0.5 * reach + 0.72 * land,
        legL: hip,
        legR: hip * 0.85,
        kneeL: knee,
        kneeR: knee * 1.15,
        // Both arms straight out ahead, glove side leading.
        armL: -2.35 * reach,
        armR: -1.95 * reach,
        elbowL: -0.12,
        elbowR: -0.3,
        armSpread: 0.24 - 0.14 * reach,
        // Head up, eyes on the ball, however far the rest of him is going.
        headTilt: -0.3 - 0.35 * land,
        roll: 0.18 * reach,
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
    case "dance": {
      // The running man. One knee drives up while the other foot slides back
      // out from under it, and the trick of the dance is that the two happen
      // at once - the up-front leg lands on the beat the back one leaves on,
      // so the figure runs hard and travels nowhere.
      //
      // Unlike a gait this one *wants* the foot to slide: the crouch here is
      // held flat rather than ridden off the planted leg, because a running
      // man that bobs with each step is just jogging on the spot.
      const beat = clock * 5.6;
      const drive = Math.sin(beat);
      const front = Math.max(0, drive);
      const back = Math.max(0, -drive);
      const hop = Math.abs(Math.cos(beat));
      return {
        ...REST,
        crouch: 0.62 - hop * 0.16,
        bob: hop * 0.3,
        lean: 0.2,
        twist: drive * 0.16,
        roll: drive * 0.1,
        // Knee up on one side, the other leg raked back and straight.
        legL: -1.2 * front + 0.62 * back,
        legR: -1.2 * back + 0.62 * front,
        kneeL: 1.45 * front + 0.14 * back,
        kneeR: 1.45 * back + 0.14 * front,
        // Elbows locked at a right angle and pumping, which is what makes it
        // read as running rather than as marching.
        armL: -0.55 + drive * 0.62,
        armR: -0.55 - drive * 0.62,
        elbowL: -1.5,
        elbowR: -1.5,
        armSpread: 0.22,
        headTilt: 0.06,
        headYaw: drive * 0.18,
      };
    }
    case "rain": {
      // Making it rain. One hand holds the stack up by the shoulder, the other
      // works across it flicking bills off the top, and the knees ride a slow
      // bounce underneath. The money itself is thrown by the director - see
      // `Fx.cash` - because particles are not something a pose can do.
      const flick = Math.sin(clock * 7.4);
      const bounce = Math.sin(clock * 3.7);
      const settle = squat(0.26 + bounce * 0.12);
      return {
        ...REST,
        ...lean(bounce, 0.34),
        crouch: settle.crouch,
        legL: settle.leg,
        legR: settle.leg,
        kneeL: settle.knee,
        kneeR: settle.knee,
        lean: -0.08,
        twist: -0.2 + flick * 0.1,
        // The stack hand stays put up by the ear.
        armR: -2.15,
        elbowR: -1.9,
        // The other sweeps out and back across it, peeling them off.
        armL: -1.85 + flick * 0.42,
        elbowL: -1.15 - flick * 0.5,
        elbowIn: 0.78 + flick * 0.22,
        armSpread: 0.44,
        headTilt: -0.22,
        headYaw: -0.3 + flick * 0.14,
      };
    }
    case "wacky": {
      // The inflatable tube man outside a car dealership. Everything runs on
      // its own detuned frequency and none of it agrees with anything else,
      // which is the entire joke: there is no pose here, only a body that has
      // lost its skeleton and is being held up by a fan.
      const whip = Math.sin(clock * 3.1);
      const flail = Math.sin(clock * 7.7);
      const noodle = Math.sin(clock * 5.3 + 1.4);
      return {
        ...REST,
        ...lean(whip, 0.5),
        crouch: 0.1 - Math.abs(whip) * 0.08,
        bob: 0.18 + noodle * 0.2,
        // Folded nearly double one moment and snapped upright the next.
        lean: 0.22 + whip * 0.46,
        twist: noodle * 0.4,
        roll: whip * 0.44,
        // Legs stay long and loose - a tube man has no knees to speak of.
        legL: whip * 0.16,
        legR: -whip * 0.14,
        kneeL: 0.1 + Math.max(0, noodle) * 0.2,
        kneeR: 0.1 + Math.max(0, -noodle) * 0.2,
        // Arms overhead, flapping out of phase with each other and with the
        // elbows, which is what stops it reading as a jumping jack.
        armL: -2.95 + flail * 0.55,
        armR: -2.95 + Math.sin(clock * 7.7 + 2.2) * 0.55,
        elbowL: noodle * 0.95,
        elbowR: Math.sin(clock * 6.1 + 3.4) * 0.95,
        armSpread: 0.46 + flail * 0.3,
        headTilt: noodle * 0.42,
        headYaw: flail * 0.5,
      };
    }
    case "frustrated": {
      // Both hands thrown up - *what was that* - held there a beat, then
      // dropped and slapped against the thighs. Three beats, because the drop
      // is what carries the meaning: hands going up on their own is a cheer.
      const throwUp = clamp01(t / 0.22);
      const drop = clamp01((t - 1.15) / 0.4);
      const slap = clamp01((t - 1.5) / 0.6);
      const shake = Math.sin(clock * 3.6);
      return {
        ...REST,
        crouch: 0.05 + 0.12 * slap,
        lean: -0.1 * throwUp + 0.26 * drop,
        twist: shake * 0.12 * (1 - drop),
        // Up and out to the sides, palms to the sky, then straight back down.
        //
        // Both the shoulder angle and the spread have to be dialled in against
        // each other, and neither alone gets there. Spread on its own swings
        // the arm out sideways at shoulder height - a shrug. Shoulder angle on
        // its own carries it up and over *behind* the head, where the hands
        // are hidden by the torso and the whole gesture is invisible from the
        // front. This pair puts them above the shoulder, out, and slightly
        // ahead, which is where hands go up in the air.
        armL: -2.45 * throwUp + 2.6 * drop,
        armR: -2.45 * throwUp + 2.6 * drop,
        // Elbows near straight on the way up: a bent one is a shrug.
        elbowL: -0.55 + 0.1 * throwUp + 0.2 * drop,
        elbowR: -0.55 + 0.1 * throwUp + 0.2 * drop,
        armSpread: 0.24 + 0.81 * throwUp - 0.66 * drop,
        // Head back at the sky on the way up, down at the dirt after.
        headTilt: -0.42 * throwUp + 0.78 * drop,
        headYaw: shake * 0.26,
        roll: shake * 0.05,
      };
    }
    case "facepalm": {
      // Hand up, head down into it, and it stays there. The far arm folds
      // across the chest on the way, which it does whether or not it is asked
      // to: `elbowIn` is one channel driving both forearms toward the midline,
      // and the fold happens to be exactly what this pose wants anyway.
      const reach = clamp01(t / 0.45);
      const sink = clamp01((t - 0.4) / 0.7);
      return {
        ...REST,
        crouch: 0.08 + 0.14 * sink,
        lean: 0.16 * reach + 0.14 * sink,
        legL: -0.12 * sink,
        legR: -0.12 * sink,
        kneeL: 0.14 * sink,
        kneeR: 0.14 * sink,
        // Upper arm up and across, forearm folded back onto the face.
        armR: -1.72 * reach,
        elbowR: -0.25 - 2.15 * reach,
        armL: -0.55 * reach,
        elbowL: -0.25 - 1.15 * reach,
        elbowIn: 0.95 * reach,
        armSpread: 0.2 + 0.16 * reach,
        // The head comes down to meet the hand rather than waiting for it,
        // and has to out-pitch the torso lean to end up looking at the dirt.
        headTilt: 0.62 * reach,
        headYaw: Math.sin(clock * 1.9) * 0.13 * reach,
        roll: -0.06 * reach,
      };
    }
    case "collapse": {
      // Straight down onto the knees, folded over them, hands on the dirt.
      // What a pitcher does the moment a ball he threw lands in the seats.
      //
      // The rig only yaws, so nobody here can actually lie down - what sells
      // it instead is depth: the hips go to shin height on a knee fold hard
      // enough that the boots stay under them, and the torso folds most of a
      // right angle over the top. `legDrop` is what buys that honestly.
      const buckle = clamp01(t / 0.55);
      const fall = buckle * buckle;
      const heave = Math.sin(clock * 1.5);
      const hip = -0.66 * fall;
      const knee = 2.42 * fall;
      return {
        ...REST,
        crouch: legDrop(hip, knee),
        legL: hip,
        legR: hip * 0.92,
        kneeL: knee,
        kneeR: knee,
        lean: 0.98 * fall + heave * 0.04,
        // Arms hang from a torso that is already folded over, which puts the
        // hands out on the ground ahead of the knees.
        armL: -0.28 * fall,
        armR: -0.28 * fall,
        elbowL: -0.18,
        elbowR: -0.18,
        armSpread: 0.34 * fall,
        chest: heave * 0.05,
        // Hanging, and the torso is already folded almost double under it.
        headTilt: 1.24 * fall,
        roll: Math.sin(clock * 1.1) * 0.05 * fall,
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

/**
 * Crossfading between poses.
 * ==========================
 *
 * Every pose above is a set of joint angles evaluated from scratch, and the
 * director changes which one an actor is in the instant the animation calls
 * for it: a chaser goes from `ready` to `sprint` on one frame, a pitcher from
 * `throw` to `ready`, a runner from `sprint` to `celebrate` the moment he
 * touches the bag. Written straight onto the rig those are teleports - every
 * joint in the body arrives at its new angle in a sixtieth of a second, which
 * is the one motion a body cannot make.
 *
 * So a change of pose is blended rather than cut. The pose being left keeps
 * running on a clock of its own - the follow-through of a throw carries on
 * through the blend, a stride keeps striding - and the rig is drawn from a mix
 * of the two that crosses over the span below. There is no cost once the blend
 * is done: past `k = 1` the incoming pose is used as it comes.
 *
 * The spans are per *incoming* pose, because the thing that decides how long a
 * transition can take is what is starting rather than what is ending. A swing
 * or a throw has to fire; blending into one over a fifth of a second is how a
 * hitter arrives late at every pitch. Standing back up out of one has all the
 * time in the world.
 */
const POSE_BLEND_DEFAULT = 0.18;
const POSE_BLEND: Partial<Record<Pose, number>> = {
  // Explosive. These start now, or they read as a flinch.
  swing: 0.06,
  throw: 0.07,
  dive: 0.07,
  catch: 0.09,
  windup: 0.14,
  // Locomotion: long enough that the legs arrive rather than snap into the
  // stride, short enough that the first step still lands with the first frame.
  sprint: 0.12,
  run: 0.14,
  walk: 0.2,
  // Coming back to rest, which nobody is in a hurry to do.
  ready: 0.26,
  idle: 0.26,
  crouch: 0.3,
};

/** Every channel of a pose, so a mix can be written without naming them twice. */
const POSE_CHANNELS = Object.keys(REST) as Array<keyof PoseValues>;

/** Longest a frame may be, so a stall does not blink a blend out of existence. */
const MAX_STEP = 0.1;

/**
 * How fast a pose's own clock may be running. `poseT` means different things
 * to different poses - a phase for a gait, seconds for a reaction, a normalized
 * ramp for a swing - so the rate it advances at is measured rather than known,
 * and this is the guard on a measurement taken across a dropped frame.
 */
const MAX_POSE_RATE = 8;

/** Past this in one frame the figure was moved rather than having moved. */
const TELEPORT = 10;

function mixPose(from: PoseValues, to: PoseValues, k: number, out: PoseValues): PoseValues {
  for (const channel of POSE_CHANNELS) {
    out[channel] = from[channel] + (to[channel] - from[channel]) * k;
  }
  return out;
}

/** Smoothstep, so a blend leaves one pose and arrives at the other gently. */
function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

interface PoseFade {
  /** The pose being blended out of, and its own clock. */
  from: Pose | null;
  fromT: number;
  /** How fast that clock was running when the pose changed. */
  rate: number;
  /** 0..1 through the blend, and how long it takes. */
  k: number;
  span: number;
  /** What was on screen last frame, to notice a change at all. */
  pose: Pose | null;
  poseT: number;
  seen: boolean;
  at: Vector3;
  /** Scratch for the mix, so the frame loop allocates nothing. */
  out: PoseValues;
}

function newFade(): PoseFade {
  return {
    from: null,
    fromT: 0,
    rate: 0,
    k: 1,
    span: POSE_BLEND_DEFAULT,
    pose: null,
    poseT: 0,
    seen: false,
    at: new Vector3(),
    out: { ...REST },
  };
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
  // Where this figure is in a change of pose. See `PoseFade`.
  const fadeRef = useRef<PoseFade>(newFade());
  const key = actor.key;
  const isAlien = species === "alien";
  const face = robotFace(actor.playerId);
  const wearsHelmet = actor.role === "batter" || actor.role === "runner";
  // Hitters wear a single flap on the side turned toward the pitcher; runners
  // have usually swapped to a double.
  const helmetFlaps: 1 | 2 = actor.role === "runner" ? 2 : 1;
  const flapSide = actor.batSide === "L" ? -1 : 1;

  const materials = useMemo(() => {
    const phong = (color: string, shininess: number, specular: string) =>
      new MeshPhongMaterial({ color, shininess, specular, flatShading: false });

    return {
      jersey: phong(uniform.jersey, 12, "#252525"),
      pants: phong(uniform.pants, 18, "#242424"),
      trim: phong(uniform.trim, 34, "#333333"),
      helmet: new MeshPhongMaterial({ color: uniform.helmet, shininess: 78, specular: "#9a9a9a" }),
      skin: isAlien
        ? phong(alienSkin(actor.playerId), 24, "#445747")
        : new MeshPhongMaterial({ color: ROBOT_METAL, shininess: 48, specular: "#85816f" }),
      dark: phong(DARK_PART, 40, "#3a3a3a"),
      // Big glossy eyes are most of an alien's face.
      eye: new MeshPhongMaterial({ color: GLOSS_BLACK, shininess: 90, specular: "#777777" }),
      // The robot's face screen: darker than any panel on the figure and
      // polished, so the eyes on it read as lit rather than as painted.
      screen: new MeshPhongMaterial({ color: SCREEN, shininess: 34, specular: "#2b3440" }),
      glint: new MeshBasicMaterial({ color: "#fff9e9", toneMapped: false }),
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
      faceInk: phong(GLOSS_BLACK, 4, "#101010"),
      blush: phong("#edaaa0", 12, "#392a28"),
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
        add(hip, GEO.joint, materials.pants, [0, 0, 0], [0.58, 0.58, 0.58]);
        add(hip, GEO.capsule, materials.pants, [0, -0.64, 0], [1.14, 1, 1.14], undefined, true);
      } else {
        add(hip, GEO.joint, materials.dark, [0, 0, 0], [0.58, 0.58, 0.58]);
        add(hip, GEO.thighBlock, materials.pants, [0, -0.66, 0], [1, 1, 1], undefined, true);
        // A fat knee joint. Chibi limbs are pill, joint, pill - the joint is
        // what stops two pills from reading as one bent sausage.
        add(hip, GEO.joint, materials.dark, [0, -1.3, 0], [0.62, 0.62, 0.62]);
      }

      const knee = new Group();
      knee.position.y = -1.32;
      hip.add(knee);

      if (isAlien) {
        add(knee, GEO.capsule, materials.skin, [0, -0.52, 0], [0.92, 0.85, 0.92], undefined, true);
        // Sock cuff where the uniform meets the leg.
        add(knee, GEO.rod, materials.trim, [0, -0.12, 0], [0.66, 0.3, 0.66]);
        // A big soft boot with three toes over the front of it.
        add(knee, GEO.foot, materials.boot, [0, -1.06, 0.08], [0.92, 0.86, 0.86], undefined, true);
        for (const toe of [-0.26, 0, 0.26]) {
          add(knee, GEO.toe, materials.boot, [toe, -1.06, 0.58]);
        }
        add(knee, GEO.sole, materials.dark, [0, -1.24, 0.08], [0.92, 1, 0.86]);
      } else {
        add(knee, GEO.shinBlock, materials.skin, [0, -0.5, 0], [1, 1, 1], undefined, true);
        add(knee, GEO.rod, materials.trim, [0, -0.06, 0], [0.62, 0.24, 0.62]);
        add(knee, GEO.foot, materials.boot, [0, -1.02, 0.16], [1, 1, 1], undefined, true);
        // Toe cap and sole, in the club's trim, so the boot reads as a shoe.
        add(knee, GEO.toe, materials.trim, [0, -1.02, 0.85], [1.9, 1.1, 0.42]);
        add(knee, GEO.sole, materials.dark, [0, -1.2, 0.16]);
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
      const depth = isAlien ? 1.08 : 1.2;
      add(
        torso,
        GEO.plane,
        numberMaterial,
        [0, 0.92, -(depth / 2 + 0.012)],
        [0.86, 0.86, 1],
        [0, Math.PI, 0],
      );
    }

    if (isAlien) {
      // A clean jersey: just the team emblem on the chest and a short neck
      // rising out of the collar. The neck is stubby on purpose - a long one
      // under a head this size reads as a lollipop.
      add(torso, GEO.disc, materials.trim, [-0.38, 1.03, 0.56], [0.42, 0.08, 0.42], [Math.PI / 2, 0, 0]);
      for (const y of [1.18, 0.92, 0.66]) {
        add(torso, GEO.bead, materials.trim, [0.1, y, 0.535], [0.09, 0.09, 0.045]);
      }
      add(torso, GEO.taper, materials.skin, [0, 1.56, 0], [0.62, 0.5, 0.62]);
    } else {
      // Chest plate with status lights and cooling vents.
      add(torso, GEO.chestPanel, materials.dark, [0, 0.92, 0.57]);
      for (const [i, x] of [-0.28, 0, 0.28].entries()) {
        add(torso, GEO.bead, i === 1 ? materials.glow : materials.lamp, [x, 1.08, 0.63], [0.17, 0.17, 0.12]);
      }
      for (const y of [0.7, 0.58]) {
        add(torso, GEO.vent, materials.dark, [0, y, 0.62]);
      }
      for (const side of [-1, 1]) {
        add(torso, GEO.pauldron, materials.trim, [side * 0.98, 1.36, 0], [1, 1, 1], undefined, true);
      }
      add(torso, GEO.rod, materials.dark, [0, 1.54, 0], [0.56, 0.5, 0.56]);
      // Backpack.
      add(torso, GEO.limbBlock, materials.trim, [0, 0.94, -0.66], [1.5, 1.1, 0.5]);
    }

    // --- Arms -------------------------------------------------------------
    const rig = isAlien ? ARM.alien : ARM.robot;
    const makeArm = (side: number) => {
      const shoulder = new Group();
      shoulder.position.set(side * rig.shoulderX, ARM.shoulderY, 0);
      torso.add(shoulder);

      if (isAlien) {
        add(shoulder, GEO.capsule, materials.jersey, [0, -0.44, 0], [0.72, 0.66, 0.72], undefined, true);
        add(shoulder, GEO.rod, materials.trim, [0, -0.8, 0], [0.46, 0.16, 0.46]);
      } else {
        add(shoulder, GEO.joint, materials.dark, [0, 0, 0], [0.58, 0.58, 0.58]);
        add(shoulder, GEO.limbBlock, materials.jersey, [0, -0.48, 0], [1, 1, 1], undefined, true);
        add(shoulder, GEO.joint, materials.dark, [0, -0.92, 0], [0.54, 0.54, 0.54]);
      }

      const elbow = new Group();
      elbow.position.y = ARM.elbowY;
      shoulder.add(elbow);

      if (isAlien) {
        add(elbow, GEO.capsule, materials.skin, [0, -0.4, 0], [0.68, 0.5, 0.68], undefined, true);
        // A soft mitt of a hand with three stubby fingers, rather than the
        // spider's hand the old three long ones made.
        add(elbow, GEO.bead, materials.skin, [0, -0.78, 0], [0.5, 0.46, 0.44]);
        for (const finger of [-0.19, 0, 0.19]) {
          add(elbow, GEO.finger, materials.skin, [finger, -0.99, 0.04], [1, 0.78, 1]);
        }
      } else {
        add(elbow, GEO.limbBlock, materials.skin, [0, -0.4, 0], [0.98, 0.86, 0.98], undefined, true);
        // A mitt with two fat fingers and a thumb, which is as much hand as a
        // figure this size can carry without it turning into gravel.
        add(elbow, GEO.mitt, materials.dark, [0, -0.86, 0.02], [1, 1, 1], undefined, true);
        for (const finger of [-0.16, 0.16]) {
          add(elbow, GEO.finger, materials.dark, [finger, -1.12, 0.06], [1, 0.72, 1]);
        }
        add(elbow, GEO.finger, materials.dark, [0.3, -0.86, 0.14], [0.9, 0.8, 0.9], [0, 0, 0.7]);
      }
      return { shoulder, elbow };
    };
    const armL = makeArm(1);
    const armR = makeArm(-1);

    // --- Head -------------------------------------------------------------
    const head = new Group();
    head.position.y = HEAD_Y;
    head.scale.setScalar(1.12);
    torso.add(head);
    const danglers: Group[] = [];
    let batGroup: Group | null = null;

    if (isAlien) {
      // One egg of a head: widest up at the brow, tapering to a chin that runs
      // out into the neck. It is a single lathed surface rather than a cranium
      // sat on a jaw, because the seam between those two lands exactly where a
      // second mouth would be - see `egg` in ./geometry.
      add(head, GEO.cranium, materials.skin, [0, ALIEN_SKULL_Y, -0.02], [2.22, 2.16, 1.98], undefined, true);
      for (const side of [-1, 1]) {
        // Eyes, which are the whole face: big glossy domes standing proud of
        // the head, set wide and canted in toward each other.
        add(
          head,
          GEO.sphere,
          materials.eye,
          [side * 0.48, ALIEN_EYE_Y + 0.03, 0.80],
          [0.64, 0.79, 0.34],
          [0.03, side * 0.23, side * -0.10],
        );
        // Two highlights each - a big one up on the outside and a small one
        // low and inboard. One alone reads as a scratch on the paint; a pair
        // is what makes a black dome read as wet.
        add(head, GEO.bead, materials.glint, [side * 0.54, ALIEN_EYE_Y + 0.22, 0.966], [0.13, 0.17, 0.055]);
        add(head, GEO.bead, materials.glint, [side * 0.40, ALIEN_EYE_Y - 0.13, 0.97], [0.065, 0.08, 0.04]);
      }
      for (const side of [-1, 1]) {
        add(head, GEO.sphere, materials.blush, [side * 0.72, ALIEN_EYE_Y - 0.35, 0.73], [0.36, 0.18, 0.07], [0, side * 0.4, 0]);
        add(head, GEO.sphere, materials.skin, [side * 1.02, 0.95, -0.02], [0.40, 0.58, 0.32], [0, 0, -side * 0.3]);
      }
      add(head, GEO.sphere, materials.skin, [0, ALIEN_EYE_Y - 0.21, 0.965], [0.20, 0.17, 0.16]);
      // A small closed smile, and nothing else: no nose, no brow, no jaw line.
      // Every extra feature on a face this size is another seam to explain.
      add(head, GEO.smile, materials.faceInk, [0, ALIEN_EYE_Y - 0.48, 0.85], [0.53, 0.34, 0.32]);

      for (const side of [-1, 1]) {
        const antenna = new Group();
        // Under a helmet they come out through the back rather than straight
        // up through the shell.
        if (wearsHelmet) {
          antenna.position.set(side * 0.34, ALIEN_SKULL_TOP - 0.5, -0.66);
          antenna.rotation.set(-0.6, 0, side * 0.34);
        } else {
          antenna.position.set(side * 0.3, ALIEN_SKULL_TOP - 0.16, -0.08);
          antenna.rotation.z = side * 0.3;
        }
        head.add(antenna);
        add(antenna, GEO.taper, materials.skin, [0, 0.26, 0], [0.12, 0.56, 0.12]);
        add(antenna, GEO.bead, materials.lamp, [0, 0.6, 0], [0.26, 0.26, 0.26]);
        danglers.push(antenna);
      }

      // Only hitters and runners wear anything on their heads: a cap perched
      // on an alien cranium never sat right. The rim goes just above the eyes
      // and the shell is stretched over whatever is left of the skull.
      if (wearsHelmet) {
        const lid = new Group();
        lid.position.set(0, ALIEN_RIM_Y, 0);
        lid.scale.set(0.95, 0.92, 0.9);
        head.add(lid);
        buildHelmet(add, lid, materials, {
          flaps: helmetFlaps,
          flapSide,
          height: helmetHeight(ALIEN_SKULL_TOP - ALIEN_RIM_Y + 0.14, 0.92),
        });
      }
    } else {
      // One continuous enamel shell, like a little retro radio.
      add(head, GEO.robotSkull, materials.skin, [0, 0.94, -0.02], [1, 1, 1], undefined, true);
      add(head, GEO.socket, materials.dark, [0, ROBOT_SCREEN_Y, 0.69], [1, 1, 0.28]);
      add(head, GEO.screen, materials.screen, [0, ROBOT_SCREEN_Y, 0.765], [1, 1, 0.22]);
      buildRobotEyes(add, head, materials.glow, ROBOT_SCREEN_Y + 0.13, 0.84, face);
      add(head, GEO.smile, materials.glow, [0, ROBOT_SCREEN_Y - 0.18, 0.85], [0.38, 0.26, 0.3]);
      for (const side of [-1, 1]) {
        add(head, GEO.sphere, materials.blush, [side * 0.58, ROBOT_SCREEN_Y - 0.12, 0.836], [0.25, 0.11, 0.04]);
      }
      // The bellows the whole head rides on. Three ribs, narrowing upward,
      // which is what makes the head read as *mounted* rather than balanced.
      for (const [i, y] of [-0.22, -0.06, 0.1].entries()) {
        add(head, GEO.bellows, materials.dark, [0, y, 0], [0.62 - i * 0.06, 0.62 - i * 0.06, 0.5], [Math.PI / 2, 0, 0]);
      }
      // Ear discs: a dark housing with a bright lens in it, the one place on
      // the figure that catches a highlight from the side.
      for (const side of [-1, 1]) {
        add(head, GEO.disc, materials.dark, [side * 0.94, ROBOT_SCREEN_Y, 0.04], [0.74, 0.3, 0.74], [0, 0, Math.PI / 2]);
        add(head, GEO.disc, materials.trim, [side * 1.06, ROBOT_SCREEN_Y, 0.04], [0.56, 0.12, 0.56], [0, 0, Math.PI / 2]);
        add(head, GEO.bead, materials.glint, [side * 1.12, ROBOT_SCREEN_Y + 0.12, 0.12], [0.13, 0.13, 0.09]);
      }
      // A trim strip down the crown, and vents in the side of the upper case.
      if (!wearsHelmet) add(head, GEO.crest, materials.trim, [0, ROBOT_CROWN - 0.12, -0.12], [1, 1, 0.9]);


      const antenna = new Group();
      if (wearsHelmet) {
        antenna.position.set(0.42, ROBOT_BROW_Y, -0.76);
        antenna.rotation.set(-0.55, 0, 0.2);
      } else {
        antenna.position.set(0.44, ROBOT_CROWN - 0.18, -0.16);
        antenna.rotation.z = 0.16;
      }
      head.add(antenna);
      add(antenna, GEO.taper, materials.dark, [0, 0.3, 0], [0.1, 0.6, 0.1]);
      add(antenna, GEO.bead, materials.lamp, [0, 0.66, 0], [0.24, 0.24, 0.24]);
      danglers.push(antenna);

      if (wearsHelmet) {
        // A case head has only a little headroom above the screen, so the shell
        // is flat and wide enough to swallow the top corners - an ellipsoid
        // needs the width to contain a box. Both numbers come off the skull.
        const lid = new Group();
        lid.position.set(0, ROBOT_RIM_Y, 0);
        lid.scale.set(1.08, 1.0, 1.04);
        head.add(lid);
        buildHelmet(add, lid, materials, {
          flaps: helmetFlaps,
          flapSide,
          height: helmetHeight(ROBOT_CROWN - ROBOT_RIM_Y + 0.24, 1.0),
        });
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
      add(batGroup, GEO.bead, materials.bat, [0, 2.66, 0], [0.46, 0.26, 0.46]);
    } else if (actor.role === "fielder") {
      // Built pointing "up" from the wrist, then flipped onto the end of the
      // forearm: rolling about Z keeps the pocket facing forward while the
      // fingers carry on down the arm.
      const kind = gloveFor(actor.positionKey);
      const glove = new Group();
      glove.position.set(0, rig.handY - 0.1, 0.12);
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
    face,
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
    const fade = fadeRef.current;
    if (!live) {
      group.visible = false;
      fade.seen = false;
      return;
    }
    group.visible = live.visible;
    if (!live.visible) {
      fade.seen = false;
      return;
    }

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

    // A change of pose is crossfaded rather than cut. See `PoseFade` above:
    // the pose being left keeps running on its own clock through the blend, so
    // a follow-through follows through and a stride keeps striding while the
    // body arrives at whatever it is doing next.
    const step = Math.min(delta, MAX_STEP);
    const clock = state.clock.elapsedTime + live.playerId;
    const isBatter = actor.role === "batter";
    const batSide = live.batSide ?? "R";

    if (live.pose === fade.pose && step > 0) {
      // How fast `poseT` is running, measured rather than assumed - a gait
      // phase wraps, a reaction counts seconds, a swing is a 0..1 ramp.
      let advance = live.poseT - fade.poseT;
      if (advance < 0) advance += 1;
      fade.rate = Math.min(MAX_POSE_RATE, advance / step);
    } else if (live.pose !== fade.pose) {
      // Somewhere else entirely: a figure that was off screen, or one the
      // director picked up and put down, arrives in its new pose rather than
      // travelling to it.
      const jumped = !fade.seen || fade.at.distanceTo(live.position) > TELEPORT;
      fade.from = jumped ? null : fade.pose;
      fade.fromT = fade.poseT;
      fade.span = POSE_BLEND[live.pose] ?? POSE_BLEND_DEFAULT;
      fade.k = fade.from ? 0 : 1;
    }
    fade.pose = live.pose;
    fade.poseT = live.poseT;
    fade.seen = true;
    fade.at.copy(live.position);

    let v = poseValues(live.pose, live.poseT, clock, isBatter, batSide);
    if (fade.from && fade.k < 1) {
      fade.k = Math.min(1, fade.k + step / Math.max(0.001, fade.span));
      fade.fromT += fade.rate * step;
      const leaving = poseValues(fade.from, fade.fromT, clock, isBatter, batSide);
      v = mixPose(leaving, v, smooth(fade.k), fade.out);
      if (fade.k >= 1) fade.from = null;
    }
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
    // distance so it reads the same size wherever the camera is. A long lens
    // magnifies everything the same way, so the fixed seats - which watch the
    // game through one - need the same treatment applied to the lens.
    const plate = labelRef.current;
    if (plate) {
      const camera = state.camera as PerspectiveCamera;
      // Measured to the plate itself rather than to the feet under it. The two
      // are the same number from any distance that matters, and from a lens
      // sitting on top of a player they are not.
      PLATE_AT.copy(group.position).y += LABEL_HEIGHT;
      const distance = camera.position.distanceTo(PLATE_AT);
      // Nobody reads the plate of a player they are standing inside: the first
      // person seats put the lens on one, and his own name is not the shot.
      plate.visible = distance > 13;
      const lens = Math.min(1, Math.tan((camera.fov * Math.PI) / 360) / BASE_LENS);
      // Past the far clamp the correction stops and the plate starts shrinking
      // with distance like anything else. That ceiling has to sit beyond the
      // furthest subject any shot is actually framed on, or the name over the
      // hitter goes illegible on the one camera that watches him all game: the
      // centre-field shot has the plate a hundred and fifty-five feet out.
      const size = 4.6 * lens * Math.max(0.15, Math.min(1.75, distance / 95));
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
        <sprite ref={labelRef} position={[0, LABEL_HEIGHT, 0]}>
          <spriteMaterial map={getLabelTexture(label, accent)} depthTest={false} transparent />
        </sprite>
      )}
    </group>
  );
}
