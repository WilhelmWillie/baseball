"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type Material,
} from "three";
import type { Actor, Pose } from "@/lib/anim/director";
import type { Uniform } from "@/lib/mlb/teams";
import { getLabelTexture, getNumberTexture, labelAspect } from "./textures";

const SKIN = ["#e8bb92", "#cd8f60", "#9a6239", "#6b4227", "#f2d3b1"];
const SHOE = "#22242a";

/**
 * Shared low-poly geometry. Every player instance reuses these, so the whole
 * roster costs a handful of unique buffers no matter how many are on the field.
 */
const GEO = {
  box: new BoxGeometry(1, 1, 1),
  /** Tapered segment used for arms and legs. */
  limb: new CylinderGeometry(0.5, 0.42, 1, 7),
  head: new IcosahedronGeometry(0.5, 1),
  capCrown: new SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  helmet: new SphereGeometry(0.5, 12, 7, 0, Math.PI * 2, 0, Math.PI / 1.75),
  hand: new IcosahedronGeometry(0.5, 0),
  glove: new SphereGeometry(0.5, 7, 5),
  bat: new CylinderGeometry(0.17, 0.06, 1, 8),
  neck: new CylinderGeometry(0.5, 0.5, 1, 7),
};

function skinFor(playerId: number): string {
  return SKIN[playerId % SKIN.length];
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
  headTilt: number;
  bob: number;
}

const REST: PoseValues = {
  crouch: 0,
  lean: 0,
  twist: 0,
  legL: 0,
  legR: 0,
  kneeL: 0.08,
  kneeR: 0.08,
  armL: 0,
  armR: 0,
  elbowL: -0.25,
  elbowR: -0.25,
  armSpread: 0.06,
  headTilt: 0,
  bob: 0,
};

function poseValues(pose: Pose, t: number, clock: number): PoseValues {
  const idleBob = Math.sin(clock * 1.8) * 0.035;

  switch (pose) {
    case "ready":
      return {
        ...REST,
        crouch: 0.34,
        lean: 0.2,
        kneeL: 0.62,
        kneeR: 0.62,
        armL: -0.5,
        armR: -0.5,
        elbowL: -0.85,
        elbowR: -0.85,
        armSpread: 0.34,
        bob: idleBob,
      };
    case "run": {
      const swing = Math.sin(t * Math.PI * 2);
      const lift = Math.cos(t * Math.PI * 2);
      return {
        ...REST,
        crouch: 0.16,
        lean: 0.32,
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
    case "windup":
      return {
        ...REST,
        crouch: 0.22 + t * 0.08,
        lean: -0.1,
        twist: -0.55 * t,
        legL: -1.45 * t,
        kneeL: 1.7 * t,
        kneeR: 0.3,
        armL: -2.0 * t,
        armR: -1.4 * t,
        elbowL: -1.5 * t,
        elbowR: -1.2 * t,
        headTilt: -0.1,
      };
    case "throw": {
      const u = Math.min(1, t * 1.6);
      return {
        ...REST,
        crouch: 0.28,
        lean: 0.5 * u,
        twist: -0.55 + u * 0.85,
        legL: 0.85 * u,
        legR: -0.45 * u,
        kneeL: 0.5,
        kneeR: 0.45,
        // Arm whips from cocked behind the head to extended out front.
        armR: -2.5 + u * 3.0,
        elbowR: -1.9 + u * 1.9,
        armL: 0.9 * u,
        elbowL: -0.6,
      };
    }
    case "swing": {
      const load = Math.min(1, t / 0.3);
      const fire = Math.max(0, (t - 0.3) / 0.7);
      return {
        ...REST,
        crouch: 0.3,
        lean: 0.16,
        twist: 0.7 * load - 2.6 * fire,
        legL: 0.28 * load,
        kneeL: 0.7,
        kneeR: 0.55,
        armL: -1.0 - 0.35 * load + 0.75 * fire,
        armR: -1.0 - 0.35 * load + 0.75 * fire,
        elbowL: -1.5 + 1.1 * fire,
        elbowR: -1.5 + 1.1 * fire,
        armSpread: 0.16,
      };
    }
    case "catch":
      return {
        ...REST,
        crouch: 0.42,
        lean: 0.12,
        kneeL: 0.8,
        kneeR: 0.8,
        armL: -2.5,
        armR: -2.1,
        elbowL: -0.7,
        elbowR: -0.8,
        armSpread: 0.5,
        headTilt: -0.2,
      };
    case "celebrate":
      return {
        ...REST,
        armL: -2.9,
        armR: -2.9,
        elbowL: -0.4,
        elbowR: -0.4,
        armSpread: 0.7,
        headTilt: -0.25,
        bob: Math.abs(Math.sin(clock * 7)) * 0.45,
      };
    case "dejected":
      return {
        ...REST,
        crouch: 0.45,
        lean: 0.62,
        kneeL: 0.5,
        kneeR: 0.5,
        armL: 0.3,
        armR: 0.3,
        elbowL: -0.15,
        elbowR: -0.15,
        headTilt: 0.35,
      };
    default:
      return { ...REST, bob: idleBob };
  }
}

export interface PlayerProps {
  actor: Actor;
  uniform: Uniform;
  director: { actors: Map<string, Actor> };
  showLabel?: boolean;
  labelText?: string;
  accent?: string;
}

export function Player({
  actor,
  uniform,
  director,
  showLabel = false,
  labelText,
  accent = "#ffffff",
}: PlayerProps) {
  const rootRef = useRef<Group>(null);
  const limbsRef = useRef<Limbs | null>(null);
  const key = actor.key;
  const wearsHelmet = actor.role === "batter" || actor.role === "runner";

  const materials = useMemo(() => {
    const jersey = new MeshLambertMaterial({ color: uniform.jersey });
    const pants = new MeshLambertMaterial({ color: uniform.pants });
    const cap = new MeshLambertMaterial({ color: wearsHelmet ? uniform.helmet : uniform.cap });
    const trim = new MeshLambertMaterial({ color: uniform.trim });
    const skin = new MeshLambertMaterial({ color: skinFor(actor.playerId) });
    const shoe = new MeshLambertMaterial({ color: SHOE });
    const glove = new MeshLambertMaterial({ color: "#6b4526" });
    const bat = new MeshLambertMaterial({ color: "#c89a5c" });
    return { jersey, pants, cap, trim, skin, shoe, glove, bat };
  }, [uniform, actor.playerId, wearsHelmet]);

  // The number sits on the back face of the chest block.
  const torsoMaterials = useMemo(() => {
    const plain = materials.jersey;
    if (!actor.number) return plain;
    const map = getNumberTexture(actor.number, uniform.jersey, uniform.trim);
    const back = new MeshLambertMaterial({ map });
    return [plain, plain, plain, plain, plain, back] as Material[];
  }, [materials.jersey, actor.number, uniform.jersey, uniform.trim]);

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) material.dispose();
      if (Array.isArray(torsoMaterials)) {
        for (const material of torsoMaterials) {
          if (material !== materials.jersey) material.dispose();
        }
      }
    };
  }, [materials, torsoMaterials]);

  const { model, limbs } = useMemo(() => {
    const root = new Group();

    const add = (
      parent: Group,
      geometry: BufferGeometry,
      material: Material | Material[],
      scale: [number, number, number],
      position: [number, number, number],
      rotation?: [number, number, number],
    ) => {
      const mesh = new Mesh(geometry, material);
      mesh.scale.set(...scale);
      mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const hips = new Group();
    hips.position.y = 2.45;
    root.add(hips);

    add(hips, GEO.box, materials.pants, [1.5, 0.55, 0.95], [0, -0.1, 0]);

    const makeLeg = (side: number) => {
      const hip = new Group();
      hip.position.set(side * 0.42, -0.2, 0);
      hips.add(hip);
      add(hip, GEO.limb, materials.pants, [0.56, 1.3, 0.56], [0, -0.65, 0]);

      const knee = new Group();
      knee.position.y = -1.3;
      hip.add(knee);
      add(knee, GEO.limb, materials.pants, [0.48, 0.55, 0.48], [0, -0.27, 0]);
      // Socks below the knee, then the shoe.
      add(knee, GEO.limb, materials.trim, [0.44, 0.7, 0.44], [0, -0.9, 0]);
      add(knee, GEO.box, materials.shoe, [0.6, 0.26, 1.0], [0, -1.32, 0.18]);
      return { hip, knee };
    };
    const left = makeLeg(1);
    const right = makeLeg(-1);

    const torso = new Group();
    hips.add(torso);
    add(torso, GEO.box, torsoMaterials, [1.8, 1.5, 0.98], [0, 0.85, 0]);
    add(torso, GEO.box, materials.trim, [1.84, 0.2, 1.0], [0, 0.12, 0]);
    // Shoulder yoke, in trim color like a jersey placket.
    add(torso, GEO.box, materials.trim, [2.05, 0.36, 0.98], [0, 1.62, 0]);
    add(torso, GEO.neck, materials.skin, [0.5, 0.4, 0.5], [0, 1.92, 0]);

    const makeArm = (side: number) => {
      const shoulder = new Group();
      shoulder.position.set(side * 1.08, 1.5, 0);
      torso.add(shoulder);
      add(shoulder, GEO.limb, materials.jersey, [0.44, 0.95, 0.44], [0, -0.48, 0]);

      const elbow = new Group();
      elbow.position.y = -0.95;
      shoulder.add(elbow);
      add(elbow, GEO.limb, materials.skin, [0.36, 0.85, 0.36], [0, -0.43, 0]);
      add(elbow, GEO.hand, materials.skin, [0.34, 0.38, 0.34], [0, -0.92, 0]);
      return { shoulder, elbow };
    };
    const armL = makeArm(1);
    const armR = makeArm(-1);

    const head = new Group();
    head.position.y = 2.12;
    torso.add(head);
    add(head, GEO.head, materials.skin, [1.04, 1.14, 1.02], [0, 0.42, 0]);
    if (wearsHelmet) {
      add(head, GEO.helmet, materials.cap, [1.16, 1.1, 1.16], [0, 0.36, 0]);
      add(head, GEO.box, materials.cap, [1.0, 0.12, 0.6], [0, 0.34, 0.5]);
      // Ear flap on the pitcher's side.
      add(head, GEO.box, materials.cap, [0.16, 0.42, 0.5], [0.56, 0.2, 0.05]);
    } else {
      add(head, GEO.capCrown, materials.cap, [1.1, 0.78, 1.1], [0, 0.5, 0]);
      add(head, GEO.box, materials.cap, [0.94, 0.11, 0.62], [0, 0.52, 0.5]);
    }

    if (actor.role === "batter") {
      const bat = new Mesh(GEO.bat, materials.bat);
      bat.scale.set(1, 2.9, 1);
      bat.position.set(0, -1.4, 0.1);
      bat.rotation.x = -0.6;
      bat.castShadow = true;
      armL.elbow.add(bat);
    } else if (actor.role === "fielder") {
      const glove = new Mesh(GEO.glove, materials.glove);
      glove.scale.set(0.95, 1.05, 0.55);
      glove.position.set(0, -1.05, 0.1);
      glove.castShadow = true;
      armL.elbow.add(glove);
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
    };
    return { model: root, limbs: parts };
  }, [materials, torsoMaterials, actor.role, wearsHelmet]);

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
    // Ease the yaw so runners do not snap around corners.
    const current = group.rotation.y;
    let diff = live.facing - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    group.rotation.y = current + diff * Math.min(1, delta * 12);

    const v = poseValues(live.pose, live.poseT, state.clock.elapsedTime + live.playerId);
    parts.hips.position.y = 2.45 - v.crouch + v.bob;
    parts.torso.rotation.x = v.lean;
    parts.torso.rotation.y = v.twist;
    parts.head.rotation.x = v.headTilt - v.lean;
    parts.legL.rotation.x = v.legL;
    parts.legR.rotation.x = v.legR;
    parts.kneeL.rotation.x = v.kneeL;
    parts.kneeR.rotation.x = v.kneeR;
    parts.armL.rotation.x = v.armL;
    parts.armR.rotation.x = v.armR;
    parts.armL.rotation.z = -v.armSpread;
    parts.armR.rotation.z = v.armSpread;
    parts.elbowL.rotation.x = v.elbowL;
    parts.elbowR.rotation.x = v.elbowR;
  });

  const label = labelText ?? actor.shortName;

  return (
    <group ref={rootRef} position={actor.position} rotation={[0, actor.facing, 0]}>
      <primitive object={model} />
      {showLabel && (
        <sprite position={[0, 8.4, 0]} scale={[labelAspect(label) * 3.4, 3.4, 1]}>
          <spriteMaterial map={getLabelTexture(label, accent)} depthTest={false} transparent />
        </sprite>
      )}
    </group>
  );
}
