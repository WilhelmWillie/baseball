"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  type Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { DUGOUT, DUGOUT_ARCS, benchSeats } from "@/lib/field/stadium";
import { noise } from "@/lib/field/park";
import type { Uniform } from "@/lib/mlb/teams";
import type { Species } from "@/lib/game/species";
import { egg, joinGeometries, roundedBox } from "./geometry";

/**
 * The bench. Whoever is not on the field is in here: a row of teammates in the
 * club's colours, sitting in the dark under the dugout roof, watching the game.
 *
 * They are drawn the way the crowd is rather than the way the nine on the grass
 * are. A `Player` is seventy-odd meshes because it has to field a ball; a bench
 * is a dozen figures seen through a slot from forty feet away, and at seventy
 * meshes each they would cost more than every fielder in the park put together
 * for a detail no camera can resolve. So each part is one `InstancedMesh` across
 * a whole bench - six draws a dugout - and the only thing that moves after that
 * is the translation, which is the crowd's trick at a slower rhythm.
 *
 * What does survive from `Player` is the read: the home club are aliens and the
 * visitors robots, wearing what their fielders wear, so the bench plainly
 * belongs to the team out on the dirt.
 */

/**
 * Height of a seated figure, in feet, measured from the bench.
 *
 * Not invented. A fielder is sixteen feet tall with its hips at 6.9 - that is
 * `FIGURE_SCALE` times `HIP_HEIGHT` and the head chain above it in `Player.tsx`
 * - so sitting down it comes to 9.1 above whatever it is sitting on. Of that,
 * the head alone is 5.7: these figures are chibi, and a bench drawn to human
 * proportions would be a different species from the nine on the grass.
 *
 * `DUGOUT.soffit` is set to clear the number below, so the two move together.
 */
const SEATED = 9.1;
/** Radius of the skull, which is most of the figure. */
const HEAD_R = SEATED * 0.312;
/** Centre of the head, above the bench. */
const HEAD_Y = SEATED - HEAD_R;
/** How much room along the bench each figure gets. A head is nearly six. */
const PITCH = 8.6;

/** A seated figure shifts about far less, and far more slowly, than a fan. */
const BOB = 0.12;
const BOB_RATE = 0.31;
const SWAY = 0.16;
const SWAY_RATE = 0.19;
const NOD = 0.1;
const NOD_RATE = 0.47;
/** Idle steps a second. None of the above reaches a hertz; this is ample. */
const STEP_RATE = 20;

const DARK_PART = "#50666a";
const EYE = "#22303a";
const ROBOT_METAL = "#ece4cd";
const ROBOT_SCREEN = "#233f48";
const ROBOT_GLOW = "#b8ffdf";
/** The same narrow band of greens a fielder's skin is picked from. */
const ALIEN_SKIN = ["#8fd08a", "#a3d493", "#7fc7a0", "#9ad3a2", "#86cc92"];

/** One player on the bench. */
interface Occupant {
  x: number;
  z: number;
  yaw: number;
  skin: string;
  scale: number;
  /** Where in its idle cycle this one starts, 0..1. */
  phase: number;
}

/**
 * Who is sitting where. `benchSeats` walks the bench by arc length; all this
 * adds is that some places are left empty, because a dugout with every seat
 * taken reads as a bus.
 */
function occupants(arc: [number, number], salt: number): Occupant[] {
  const out: Occupant[] = [];
  for (const [i, seat] of benchSeats(arc, PITCH).entries()) {
    const roll = noise(seat.x, seat.z, salt + i);
    if (roll < 0.17) continue;
    out.push({
      x: seat.x,
      z: seat.z,
      yaw: seat.yaw,
      skin: ALIEN_SKIN[Math.floor(roll * 61) % ALIEN_SKIN.length],
      scale: 0.94 + roll * 0.09,
      phase: noise(seat.x, seat.z, salt + 19),
    });
  }
  return out;
}

/**
 * The body, built about the hips so the whole of it can be planted on the
 * bench: a torso, and thighs running forward off the front of it. The lap is
 * the whole of what makes a figure read as sitting rather than as standing in
 * a hole, and it is the one part of this worth the polygons.
 */
function seatedBody(): BufferGeometry {
  const torso = new CapsuleGeometry(SEATED * 0.132, SEATED * 0.132, 6, 14);
  torso.scale(1.2, 1, 0.95);
  torso.translate(0, SEATED * 0.215, -SEATED * 0.012);
  const lap = roundedBox(SEATED * 0.33, SEATED * 0.132, SEATED * 0.31, 0.45, 2);
  lap.translate(0, SEATED * 0.06, SEATED * 0.13);
  return joinGeometries([torso, lap]);
}

/** Two hands, resting on the knees. */
function restingHands(): BufferGeometry {
  const hand = new SphereGeometry(SEATED * 0.068, 10, 8);
  hand.scale(0.9, 0.85, 1);
  const y = SEATED * 0.13;
  const z = SEATED * 0.23;
  return joinGeometries([
    hand.clone().translate(-SEATED * 0.122, y, z),
    hand.translate(SEATED * 0.122, y, z),
  ]);
}

/**
 * An alien's face: two glossy domes and a closed smile, which is every feature
 * `Player` gives a fielder and no more. It faces local +Z, and a seat's yaw has
 * already pointed that at the field.
 */
function alienFace(): BufferGeometry {
  // Every feature has to end up *outside* the skull. The eyes are domes stood
  // proud of the face rather than holes cut into it, which is what makes them
  // read as wet at this size - sink them a tenth of a radius and the face goes
  // blank, because a sphere inside a sphere draws nothing at all.
  const eye = new SphereGeometry(HEAD_R * 0.29, 10, 8);
  eye.scale(0.92, 1.26, 0.46);
  const smile = new TorusGeometry(HEAD_R * 0.17, HEAD_R * 0.036, 6, 12, Math.PI * 0.8);
  smile.rotateZ(-Math.PI * 0.9);
  smile.translate(0, -HEAD_R * 0.36, HEAD_R * 0.9);
  return joinGeometries([
    eye.clone().translate(-HEAD_R * 0.46, HEAD_R * 0.04, HEAD_R * 0.92),
    eye.translate(HEAD_R * 0.46, HEAD_R * 0.04, HEAD_R * 0.92),
    smile,
  ]);
}

/**
 * The club cap: a crown pulled over the skull, and a peak out in front of it.
 *
 * The crown has to be *wider* than the head at every height it covers. The
 * skull is an egg whose widest point is above its middle, so a crown cut to the
 * radius of a sphere clips through it in a ring and comes out looking like a
 * fringe of hair rather than a cap.
 */
function alienCap(): BufferGeometry {
  // Cut high enough that the rim clears the eyes: these are half a head across
  // and set near the middle of the face, so a cap worn low is a blindfold.
  const crown = new SphereGeometry(HEAD_R * 1.07, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.36);
  crown.scale(1, 0.97, 1);
  crown.translate(0, HEAD_R * 0.06, 0);
  // A half disc, swept from -X round through +Z to +X so it covers the front
  // of the head only, then narrowed so it reads as a peak and not a sun hat.
  const brim = new CylinderGeometry(
    HEAD_R * 0.95, HEAD_R * 0.95, HEAD_R * 0.11, 16, 1, false, -Math.PI / 2, Math.PI,
  );
  brim.scale(0.62, 1, 1);
  brim.translate(0, HEAD_R * 0.42, HEAD_R * 0.33);
  return joinGeometries([crown, brim]);
}

/** A robot wears its face on a screen, with a pair of bars lit on it. */
function robotScreen(): BufferGeometry {
  const screen = roundedBox(HEAD_R * 1.18, HEAD_R * 0.8, HEAD_R * 0.16, 0.12, 2);
  screen.translate(0, HEAD_R * 0.04, HEAD_R * 0.94);
  return screen;
}

function robotEyes(): BufferGeometry {
  const bar = roundedBox(HEAD_R * 0.28, HEAD_R * 0.26, HEAD_R * 0.1, 0.05, 2);
  bar.translate(0, HEAD_R * 0.07, HEAD_R * 1.0);
  return joinGeometries([
    bar.clone().translate(-HEAD_R * 0.29, 0, 0),
    bar.translate(HEAD_R * 0.29, 0, 0),
  ]);
}

/**
 * The antenna a robot wears where an alien wears a cap. It is kept to the same
 * height as that cap on purpose: the soffit is only a few inches over a seated
 * figure, and a taller aerial would stand through the dugout roof.
 */
function robotCrest(): BufferGeometry {
  const stalk = new CylinderGeometry(HEAD_R * 0.05, HEAD_R * 0.05, HEAD_R * 0.42, 6);
  stalk.translate(0, HEAD_R * 1.06, -HEAD_R * 0.06);
  const bulb = new SphereGeometry(HEAD_R * 0.1, 8, 6);
  bulb.translate(0, HEAD_R * 1.22, -HEAD_R * 0.06);
  return joinGeometries([stalk, bulb]);
}

/**
 * One drawn part of the figure. `head` rides the head rather than the body, and
 * `unit` marks the one geometry built a unit across rather than in feet - the
 * skull, which is a stock shape scaled to `HEAD_R` here.
 */
interface Part {
  geometry: BufferGeometry;
  material: Material;
  head: boolean;
  unit?: boolean;
  /** Painted per figure, off its own skin, rather than by the material. */
  tint?: boolean;
}

interface Bench {
  meshes: InstancedMesh[];
  /** Whether each mesh follows the head. Indexed like `meshes`. */
  onHead: boolean[];
  people: Occupant[];
  /** Resting position of the body and the head, per occupant. */
  rest: { x: Float32Array; bodyY: Float32Array; headY: Float32Array };
  /** Clock at which the next idle step is due. */
  nextAt: number;
}

function partsFor(species: Species, uniform: Uniform): Part[] {
  const lambert = (color: string) => new MeshLambertMaterial({ color });
  const body: Part = { geometry: seatedBody(), material: lambert(uniform.jersey), head: false };
  if (species === "alien") {
    return [
      body,
      { geometry: restingHands(), material: lambert("#ffffff"), head: false, tint: true },
      { geometry: egg(0.1, 20, 22), material: lambert("#ffffff"), head: true, unit: true, tint: true },
      { geometry: alienCap(), material: lambert(uniform.cap), head: true },
      { geometry: alienFace(), material: new MeshBasicMaterial({ color: EYE }), head: true },
    ];
  }
  return [
    body,
    { geometry: restingHands(), material: lambert(DARK_PART), head: false },
    { geometry: roundedBox(1, 1, 1, 0.22, 3), material: lambert(ROBOT_METAL), head: true, unit: true },
    { geometry: robotScreen(), material: lambert(ROBOT_SCREEN), head: true },
    { geometry: robotEyes(), material: new MeshBasicMaterial({ color: ROBOT_GLOW }), head: true },
    { geometry: robotCrest(), material: lambert(DARK_PART), head: true },
  ];
}

/** Builds every instanced part of one bench and seats everyone on it. */
function buildBench(arc: [number, number], species: Species, uniform: Uniform, salt: number): Bench {
  const people = occupants(arc, salt);
  const parts = partsFor(species, uniform);
  const meshes = parts.map((part) => {
    const mesh = new InstancedMesh(part.geometry, part.material, Math.max(1, people.length));
    // A bench is a handful of figures inside a box the camera is often looking
    // straight into; a bounding sphere around the lot of them is not worth the
    // frame it occasionally saves.
    mesh.frustumCulled = false;
    mesh.count = people.length;
    return mesh;
  });

  const rest = {
    x: new Float32Array(people.length),
    bodyY: new Float32Array(people.length),
    headY: new Float32Array(people.length),
  };
  const dummy = new Object3D();
  const tint = new Color();
  for (const [i, person] of people.entries()) {
    const s = person.scale;
    rest.x[i] = person.x;
    // The body geometry is built about the hips, so it is planted on the bench
    // as it stands; only the head needs lifting into place.
    rest.bodyY[i] = DUGOUT.bench;
    rest.headY[i] = DUGOUT.bench + HEAD_Y * s;
    for (const [p, mesh] of meshes.entries()) {
      const part = parts[p];
      dummy.position.set(person.x, part.head ? rest.headY[i] : rest.bodyY[i], person.z);
      dummy.rotation.set(0, person.yaw, 0);
      dummy.scale.setScalar(part.unit ? s * HEAD_R * 2 : s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (part.tint) mesh.setColorAt(i, tint.set(person.skin));
    }
  }
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  return { meshes, onHead: parts.map((p) => p.head), people, rest, nextAt: 0 };
}

/**
 * One frame of idle, written straight into the translation slots (elements 12,
 * 13 and 14) of each instance matrix. Where a figure sits, which way it faces
 * and how big it is were baked in once and are never touched again.
 */
function settle(bench: Bench, t: number) {
  if (t < bench.nextAt) return;
  bench.nextAt = t + 1 / STEP_RATE;
  for (let i = 0; i < bench.people.length; i++) {
    const person = bench.people[i];
    const turn = person.phase * Math.PI * 2;
    const s = person.scale;
    const bob = Math.sin(t * BOB_RATE * Math.PI * 2 + turn) * BOB * s;
    const sway = Math.sin(t * SWAY_RATE * Math.PI * 2 + turn * 1.6) * SWAY * s;
    const nod = Math.sin(t * NOD_RATE * Math.PI * 2 + turn * 2.1) * NOD * s;
    const m = i * 16;
    for (const [p, mesh] of bench.meshes.entries()) {
      const array = mesh.instanceMatrix.array as Float32Array;
      array[m + 12] = bench.rest.x[i] + sway;
      array[m + 13] = (bench.onHead[p] ? bench.rest.headY[i] + nod : bench.rest.bodyY[i]) + bob;
    }
  }
  for (const mesh of bench.meshes) mesh.instanceMatrix.needsUpdate = true;
}

/**
 * `home` and `away` are taken as two props rather than one object so that the
 * benches are built once a game: the snapshot hands back the same two uniforms
 * every time, and a `{ home, away }` wrapper made in the caller would be a new
 * object on every render and throw away a park's worth of geometry with it.
 */
export function Dugouts({ home, away }: { home: Uniform; away: Uniform }) {
  const benches = useMemo(
    () => [
      // Which bench is which is decided by the fascia: `StadiumSigns` paints
      // VISITORS on the third-base dugout and HOME on the first-base one.
      buildBench(DUGOUT_ARCS[0], "robot", away, 7),
      buildBench(DUGOUT_ARCS[1], "alien", home, 23),
    ],
    [home, away],
  );

  const clock = useRef(0);
  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1);
    for (const bench of benches) settle(bench, clock.current);
  });

  useEffect(
    () => () => {
      for (const bench of benches) {
        for (const mesh of bench.meshes) {
          mesh.geometry.dispose();
          (mesh.material as Material).dispose();
          mesh.dispose();
        }
      }
    },
    [benches],
  );

  return (
    <>
      {benches.flatMap((bench, b) =>
        bench.meshes.map((mesh, i) => <primitive key={`${b}-${i}`} object={mesh} />),
      )}
    </>
  );
}
