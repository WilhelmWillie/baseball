"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Color,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import { FAN_HEIGHT, buildCrowd, type CrowdPalette, type Fan } from "@/lib/field/park";
import { roundedBox } from "./geometry";

/**
 * The people in the seats.
 *
 * They used to be a single coloured box each, drawn in with the rest of the
 * park, and at a real person's size against a park built in real feet they came
 * out about three pixels tall: a bowl of confetti rather than a crowd. These are
 * bigger, they have a head and shoulders, and they move.
 *
 * Three instanced meshes - a body, a head and a cap of hair. Everything about a
 * given fan - the seat, the facing, the size, the shirt, the skin, where in the
 * idle cycle they start - is baked once in `buildCrowd`; all this file does per
 * frame is breathe.
 */

/** Proportions of one fan, as fractions of `FAN_HEIGHT`. */
const BODY_H = 0.66;
const BODY_W = 0.5;
const BODY_D = 0.46;
const HEAD_D = 0.38;

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
 * TODO: react to the play. The director already knows when something has
 * happened and how big it was - `crowdVoice` computes exactly that for the
 * sound - so the shape of this is a 0..1 excitement level read here, driving
 * amplitude and rate up and putting a fraction of the bowl on its feet. The
 * per-instance phase below is what would keep that from looking like a wave
 * machine.
 */

interface Parts {
  bodies: InstancedMesh;
  heads: InstancedMesh;
  hair: InstancedMesh;
  /** Clock at which the next idle step is due. */
  nextAt: number;
}

/**
 * Idle steps a second. Three matrix buffers for four thousand people is most of
 * a megabyte going up to the card every frame, and none of it needs to: the bob
 * below is under half a hertz and a couple of inches deep, so it is perfectly
 * smooth at a third of the display's rate and costs a third as much.
 */
const STEP_RATE = 24;

interface Rest {
  body: Float32Array;
  head: Float32Array;
  /** How far the hair cap sits above the centre of its head. */
  hairLift: Float32Array;
}

/**
 * One frame of idle. Everything a fan is - where the seat is, which way it
 * faces, how big they are - was written into the instance matrix once and is
 * never touched again; all this does is move the translation, which is elements
 * 12, 13 and 14 of each sixteen. That is the whole reason the crowd can be a
 * couple of thousand people and still cost nothing: two thousand sines and four
 * thousand float writes, not two thousand matrix rebuilds.
 */
function breathe(parts: Parts, fans: Fan[], rest: Rest, t: number) {
  if (t < parts.nextAt) return;
  parts.nextAt = t + 1 / STEP_RATE;
  const bodyM = parts.bodies.instanceMatrix.array as Float32Array;
  const headM = parts.heads.instanceMatrix.array as Float32Array;
  const hairM = parts.hair.instanceMatrix.array as Float32Array;
  for (let i = 0; i < fans.length; i++) {
    const fan = fans[i];
    const turn = fan.phase * Math.PI * 2;
    const s = fan.scale;
    const bob = Math.sin(t * BOB_RATE * Math.PI * 2 + turn) * BOB * s;
    const sway = Math.sin(t * SWAY_RATE * Math.PI * 2 + turn * 1.7) * SWAY * s;
    const nod = Math.sin(t * HEAD_RATE * Math.PI * 2 + turn * 2.3) * HEAD_BOB * s;
    const m = i * 16;
    const r = i * 3;
    const headX = rest.head[r] + sway * 1.3;
    const headY = rest.head[r + 1] + bob + nod;
    bodyM[m + 12] = rest.body[r] + sway;
    bodyM[m + 13] = rest.body[r + 1] + bob;
    headM[m + 12] = headX;
    headM[m + 13] = headY;
    hairM[m + 12] = headX;
    hairM[m + 13] = headY + rest.hairLift[i];
  }
  parts.bodies.instanceMatrix.needsUpdate = true;
  parts.heads.instanceMatrix.needsUpdate = true;
  parts.hair.instanceMatrix.needsUpdate = true;
}

export function Crowd({ palette }: { palette: CrowdPalette }) {
  const fans = useMemo(() => buildCrowd(palette), [palette]);

  const parts = useMemo<Parts>(() => {
    const radius = FAN_HEIGHT * HEAD_D * 0.5;
    const bodyGeometry = roundedBox(
      FAN_HEIGHT * BODY_W,
      FAN_HEIGHT * BODY_H,
      FAN_HEIGHT * BODY_D,
      FAN_HEIGHT * 0.14,
      1,
    );
    // A sphere is the wrong shape for a head and the right shape for a cheap
    // one: eight segments around is enough to read as round at the size these
    // are ever seen, and there are a couple of thousand of them.
    const headGeometry = new SphereGeometry(radius, 7, 5);
    headGeometry.scale(1, 1.06, 0.94);
    // Hair is what turns a beige sphere into a person at six pixels tall. A cap
    // rather than a full second head: the top half of a slightly larger sphere,
    // squashed down and sat on top, so the face stays skin.
    const hairGeometry = new SphereGeometry(radius * 1.05, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.62);
    hairGeometry.scale(1, 0.92, 1);

    return {
      bodies: makeMesh(bodyGeometry, fans, (fan) => fan.shirt),
      heads: makeMesh(headGeometry, fans, (fan) => fan.skin),
      hair: makeMesh(hairGeometry, fans, (fan) => fan.hair),
      nextAt: 0,
    };
  }, [fans]);

  useEffect(() => {
    return () => {
      for (const mesh of [parts.bodies, parts.heads, parts.hair]) {
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
    }
    return { body, head, hairLift };
  }, [fans]);

  useFrame((state) => breathe(parts, fans, rest, state.clock.elapsedTime));

  return (
    <>
      <primitive object={parts.bodies} />
      <primitive object={parts.heads} />
      <primitive object={parts.hair} />
    </>
  );
}

function makeMesh(
  geometry: BufferGeometry,
  fans: Fan[],
  pick: (fan: Fan) => string,
): InstancedMesh {
  const mesh = new InstancedMesh(
    geometry,
    new MeshLambertMaterial({ flatShading: true }),
    fans.length,
  );
  const dummy = new Object3D();
  const color = new Color();
  for (let i = 0; i < fans.length; i++) {
    const fan = fans[i];
    dummy.position.set(fan.p[0], fan.p[1], fan.p[2]);
    dummy.rotation.set(0, fan.yaw, 0);
    dummy.scale.setScalar(fan.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set(pick(fan)));
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
