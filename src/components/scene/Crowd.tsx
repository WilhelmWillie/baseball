"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
} from "three";
import { FAN_HEIGHT, buildCrowd, type CrowdPalette, type Fan } from "@/lib/field/park";
import { roundedBox } from "./geometry";

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

/** Eyes. Dark enough to read at six pixels, not so dark they look like holes. */
const EYE = "#2b2426";

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
  eyes: InstancedMesh;
  /** Clock at which the next idle step is due. */
  nextAt: number;
}

/**
 * Idle steps a second. Four matrix buffers for a couple of thousand people is
 * half a megabyte going up to the card every frame, and none of it needs to:
 * the bob below is under half a hertz and a couple of inches deep, so it is
 * perfectly smooth at a third of the display's rate and costs a third as much.
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
 * 12, 13 and 14 of each sixteen. That is the whole reason a crowd this size
 * costs nothing: a few thousand sines and float writes, not a few thousand
 * matrix rebuilds.
 */
function breathe(parts: Parts, fans: Fan[], rest: Rest, t: number) {
  if (t < parts.nextAt) return;
  parts.nextAt = t + 1 / STEP_RATE;
  const bodyM = parts.bodies.instanceMatrix.array as Float32Array;
  const headM = parts.heads.instanceMatrix.array as Float32Array;
  const hairM = parts.hair.instanceMatrix.array as Float32Array;
  const eyeM = parts.eyes.instanceMatrix.array as Float32Array;
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
    // The eyes share the head's transform exactly: same seat, same facing, same
    // scale, so they are baked into the head's local frame and simply ride it.
    eyeM[m + 12] = headX;
    eyeM[m + 13] = headY;
  }
  parts.bodies.instanceMatrix.needsUpdate = true;
  parts.heads.instanceMatrix.needsUpdate = true;
  parts.hair.instanceMatrix.needsUpdate = true;
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
  return joinGeometries(left, right);
}

/**
 * Concatenate two non-indexed geometries. three ships a utility for this in its
 * examples, but pulling that path in for one call to weld two spheres together
 * is not worth it.
 */
function joinGeometries(a: BufferGeometry, b: BufferGeometry): BufferGeometry {
  const flat = [a.toNonIndexed(), b.toNonIndexed()];
  const out = new BufferGeometry();
  for (const name of ["position", "normal"]) {
    const parts = flat.map((g) => g.getAttribute(name).array as Float32Array);
    const merged = new Float32Array(parts[0].length + parts[1].length);
    merged.set(parts[0], 0);
    merged.set(parts[1], parts[0].length);
    out.setAttribute(name, new BufferAttribute(merged, 3));
  }
  a.dispose();
  b.dispose();
  for (const g of flat) g.dispose();
  return out;
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
    // Hair is what turns a beige sphere into a person at this size. A cap
    // rather than a full second head: the top of a slightly larger sphere, sat
    // over the skull. It has to stop well above the eyes - taken any further
    // round it stops reading as hair and starts reading as a motorcycle helmet.
    const hairGeometry = new SphereGeometry(radius * 1.05, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.42);
    hairGeometry.scale(1, 0.95, 1);

    return {
      bodies: makeMesh(bodyGeometry, fans, (fan) => fan.shirt),
      heads: makeMesh(headGeometry, fans, (fan) => fan.skin),
      hair: makeMesh(hairGeometry, fans, (fan) => fan.hair),
      // Unlit, so a fan in the shade of the upper deck still has eyes.
      eyes: makeMesh(eyePair(radius), fans, () => EYE, true),
      nextAt: 0,
    };
  }, [fans]);

  useEffect(() => {
    return () => {
      for (const mesh of [parts.bodies, parts.heads, parts.hair, parts.eyes]) {
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
      <primitive object={parts.eyes} />
    </>
  );
}

function makeMesh(
  geometry: BufferGeometry,
  fans: Fan[],
  pick: (fan: Fan) => string,
  unlit = false,
): InstancedMesh {
  const mesh = new InstancedMesh(
    geometry,
    unlit
      ? new MeshBasicMaterial({ toneMapped: false })
      : new MeshLambertMaterial({ flatShading: true }),
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
