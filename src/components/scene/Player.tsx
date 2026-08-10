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
  MeshLambertMaterial,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from "three";
import type { Actor, Pose } from "@/lib/anim/director";
import type { Uniform } from "@/lib/mlb/teams";
import { getLabelTexture, getNumberTexture, labelAspect } from "./textures";

/**
 * Two species share one skeleton, so the whole pose vocabulary drives both:
 * the home club are aliens, the visitors are robots. Team colors still carry
 * the uniform, which makes the species a second, redundant read on who is who.
 */
export type Species = "alien" | "robot";

/** Cartoon scale - a touch over life size so players read from the stands. */
const SCALE = 1.32;

const ALIEN_SKIN = ["#8fd694", "#7fc7c0", "#a5d977", "#79c8a8", "#b5d96a"];
const ROBOT_METAL = "#b9c1c9";
const ROBOT_DARK = "#3a4149";
const EYE_GLOW = "#7ff0ff";
const ALIEN_EYE = "#12161c";
const BOOT = "#22262c";

/** Shared low-poly geometry - every player reuses these buffers. */
const GEO = {
  box: new BoxGeometry(1, 1, 1),
  limb: new CapsuleGeometry(0.42, 0.7, 3, 8),
  segment: new CylinderGeometry(0.44, 0.4, 1, 8),
  joint: new IcosahedronGeometry(0.5, 1),
  sphere: new SphereGeometry(0.5, 12, 9),
  domeTop: new SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7),
  antennaBall: new IcosahedronGeometry(0.5, 1),
  bat: new CylinderGeometry(0.17, 0.06, 1, 8),
  ring: new TorusGeometry(0.5, 0.12, 6, 16),
};

function alienSkin(playerId: number): string {
  return ALIEN_SKIN[playerId % ALIEN_SKIN.length];
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
  const limbsRef = useRef<Limbs | null>(null);
  const key = actor.key;
  const isAlien = species === "alien";
  const wearsHelmet = actor.role === "batter" || actor.role === "runner";

  const materials = useMemo(() => {
    const jersey = new MeshLambertMaterial({ color: uniform.jersey });
    const pants = new MeshLambertMaterial({ color: uniform.pants });
    const trim = new MeshLambertMaterial({ color: uniform.trim });
    const helmet = new MeshLambertMaterial({ color: uniform.helmet });
    const skin = new MeshLambertMaterial({
      color: isAlien ? alienSkin(actor.playerId) : ROBOT_METAL,
    });
    const dark = new MeshLambertMaterial({ color: isAlien ? ALIEN_EYE : ROBOT_DARK });
    const glow = new MeshLambertMaterial({
      color: isAlien ? ALIEN_EYE : EYE_GLOW,
      emissive: isAlien ? "#000000" : EYE_GLOW,
      emissiveIntensity: 0.9,
    });
    const boot = new MeshLambertMaterial({ color: BOOT });
    const glove = new MeshLambertMaterial({ color: "#6b4526" });
    const bat = new MeshLambertMaterial({ color: "#c89a5c" });
    return { jersey, pants, trim, helmet, skin, dark, glow, boot, glove, bat };
  }, [uniform, actor.playerId, isAlien]);

  // The number sits on the back face of the chest.
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
    root.scale.setScalar(SCALE);

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
    add(hips, GEO.box, materials.pants, [1.45, 0.6, 0.95], [0, -0.12, 0]);

    // --- Legs -------------------------------------------------------------
    const makeLeg = (side: number) => {
      const hip = new Group();
      hip.position.set(side * 0.42, -0.22, 0);
      hips.add(hip);

      if (isAlien) {
        add(hip, GEO.limb, materials.pants, [0.6, 0.85, 0.6], [0, -0.62, 0]);
      } else {
        add(hip, GEO.segment, materials.pants, [0.62, 1.25, 0.62], [0, -0.63, 0]);
        add(hip, GEO.joint, materials.dark, [0.54, 0.54, 0.54], [0, -1.28, 0]);
      }

      const knee = new Group();
      knee.position.y = -1.3;
      hip.add(knee);

      if (isAlien) {
        add(knee, GEO.limb, materials.skin, [0.5, 0.6, 0.5], [0, -0.5, 0]);
        // Three-toed foot.
        for (const toe of [-0.28, 0, 0.28]) {
          add(knee, GEO.box, materials.boot, [0.24, 0.2, 0.85], [toe, -1.22, 0.26]);
        }
        add(knee, GEO.box, materials.boot, [0.8, 0.24, 0.5], [0, -1.22, -0.08]);
      } else {
        add(knee, GEO.segment, materials.skin, [0.5, 1.0, 0.5], [0, -0.5, 0]);
        add(knee, GEO.box, materials.boot, [0.72, 0.34, 1.15], [0, -1.15, 0.2]);
      }
      return { hip, knee };
    };
    const left = makeLeg(1);
    const right = makeLeg(-1);

    // --- Torso ------------------------------------------------------------
    const torso = new Group();
    hips.add(torso);
    add(torso, GEO.box, torsoMaterials, [1.78, 1.5, 0.96], [0, 0.85, 0]);
    add(torso, GEO.box, materials.trim, [1.82, 0.2, 0.99], [0, 0.12, 0]);

    if (isAlien) {
      // Slim shoulders and a bright collar.
      add(torso, GEO.box, materials.trim, [2.0, 0.3, 0.96], [0, 1.6, 0]);
      add(torso, GEO.sphere, materials.skin, [0.6, 0.5, 0.6], [0, 1.86, 0]);
    } else {
      // Chest plate with a status light, and blocky shoulder pads.
      add(torso, GEO.box, materials.dark, [1.0, 0.7, 0.12], [0, 0.95, 0.52]);
      add(torso, GEO.joint, materials.glow, [0.24, 0.24, 0.14], [0, 0.95, 0.6]);
      add(torso, GEO.box, materials.trim, [2.16, 0.42, 1.0], [0, 1.58, 0]);
      add(torso, GEO.segment, materials.skin, [0.46, 0.4, 0.46], [0, 1.88, 0]);
    }

    // --- Arms -------------------------------------------------------------
    const makeArm = (side: number) => {
      const shoulder = new Group();
      shoulder.position.set(side * 1.06, 1.48, 0);
      torso.add(shoulder);

      if (isAlien) {
        add(shoulder, GEO.limb, materials.jersey, [0.44, 0.6, 0.44], [0, -0.45, 0]);
      } else {
        add(shoulder, GEO.joint, materials.dark, [0.5, 0.5, 0.5], [0, 0, 0]);
        add(shoulder, GEO.segment, materials.jersey, [0.46, 0.92, 0.46], [0, -0.46, 0]);
        add(shoulder, GEO.joint, materials.dark, [0.44, 0.44, 0.44], [0, -0.93, 0]);
      }

      const elbow = new Group();
      elbow.position.y = -0.95;
      shoulder.add(elbow);

      if (isAlien) {
        add(elbow, GEO.limb, materials.skin, [0.36, 0.52, 0.36], [0, -0.42, 0]);
        // Long three-fingered hand.
        for (const finger of [-0.2, 0, 0.2]) {
          add(elbow, GEO.box, materials.skin, [0.14, 0.42, 0.14], [finger, -1.06, 0]);
        }
      } else {
        add(elbow, GEO.segment, materials.skin, [0.38, 0.85, 0.38], [0, -0.42, 0]);
        add(elbow, GEO.box, materials.dark, [0.44, 0.36, 0.4], [0, -0.98, 0]);
      }
      return { shoulder, elbow };
    };
    const armL = makeArm(1);
    const armR = makeArm(-1);

    // --- Head -------------------------------------------------------------
    const head = new Group();
    head.position.y = 2.1;
    torso.add(head);
    const danglers: Group[] = [];

    if (isAlien) {
      // Tall teardrop skull with big black eyes.
      add(head, GEO.sphere, materials.skin, [1.28, 1.72, 1.2], [0, 0.62, 0]);
      add(head, GEO.sphere, materials.skin, [0.92, 0.7, 0.9], [0, 0.05, 0.05]);
      for (const side of [-1, 1]) {
        add(
          head,
          GEO.sphere,
          materials.dark,
          [0.46, 0.66, 0.24],
          [side * 0.3, 0.62, 0.5],
          [0.18, side * 0.34, side * -0.42],
        );
      }
      // Antennae, which get to wobble.
      for (const side of [-1, 1]) {
        const antenna = new Group();
        antenna.position.set(side * 0.26, 1.2, 0);
        antenna.rotation.z = side * 0.3;
        head.add(antenna);
        add(antenna, GEO.segment, materials.skin, [0.1, 0.72, 0.1], [0, 0.36, 0]);
        add(antenna, GEO.antennaBall, materials.trim, [0.26, 0.26, 0.26], [0, 0.76, 0]);
        danglers.push(antenna);
      }
      if (wearsHelmet) {
        add(head, GEO.domeTop, materials.helmet, [1.4, 1.1, 1.34], [0, 0.72, 0]);
        add(head, GEO.box, materials.helmet, [1.1, 0.14, 0.66], [0, 0.86, 0.62]);
      }
    } else {
      // Boxy head with a glowing visor band.
      add(head, GEO.box, materials.skin, [1.32, 1.18, 1.16], [0, 0.62, 0]);
      add(head, GEO.box, materials.dark, [1.36, 0.42, 0.18], [0, 0.68, 0.58]);
      add(head, GEO.box, materials.glow, [1.0, 0.24, 0.1], [0, 0.68, 0.64]);
      // Ear pods.
      for (const side of [-1, 1]) {
        add(head, GEO.segment, materials.dark, [0.28, 0.24, 0.28], [side * 0.72, 0.6, 0], [0, 0, Math.PI / 2]);
      }
      const antenna = new Group();
      antenna.position.set(0.36, 1.2, 0);
      head.add(antenna);
      add(antenna, GEO.segment, materials.dark, [0.08, 0.6, 0.08], [0, 0.3, 0]);
      add(antenna, GEO.antennaBall, materials.trim, [0.2, 0.2, 0.2], [0, 0.64, 0]);
      danglers.push(antenna);

      // A cap for fielders, a full shell for hitters.
      if (wearsHelmet) {
        add(head, GEO.domeTop, materials.helmet, [1.5, 1.0, 1.44], [0, 0.78, 0]);
        add(head, GEO.box, materials.helmet, [1.16, 0.14, 0.68], [0, 0.9, 0.64]);
      } else {
        add(head, GEO.box, materials.helmet, [1.36, 0.28, 1.2], [0, 1.28, 0]);
        add(head, GEO.box, materials.helmet, [1.1, 0.12, 0.62], [0, 1.2, 0.6]);
      }
    }

    // --- Equipment --------------------------------------------------------
    if (actor.role === "batter") {
      const bat = new Mesh(GEO.bat, materials.bat);
      bat.scale.set(1, 2.9, 1);
      bat.position.set(0, -1.5, 0.1);
      bat.rotation.x = -0.6;
      bat.castShadow = true;
      armL.elbow.add(bat);
    } else if (actor.role === "fielder") {
      const glove = new Mesh(GEO.sphere, materials.glove);
      glove.scale.set(1.0, 1.1, 0.6);
      glove.position.set(0, -1.15, 0.1);
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
      danglers,
    };
    return { model: root, limbs: parts };
  }, [materials, torsoMaterials, actor.role, isAlien, wearsHelmet]);

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

    // Antennae lag behind the head, which sells the motion.
    const wobble = Math.sin(state.clock.elapsedTime * 5 + live.playerId) * 0.12;
    for (let i = 0; i < parts.danglers.length; i++) {
      const dangler = parts.danglers[i];
      dangler.rotation.x = -v.lean * 0.8 + wobble * (i === 0 ? 1 : -1);
    }
  });

  const label = labelText ?? actor.shortName;

  return (
    <group ref={rootRef} position={actor.position} rotation={[0, actor.facing, 0]}>
      <primitive object={model} />
      {showLabel && (
        <sprite position={[0, 11.4, 0]} scale={[labelAspect(label) * 3.8, 3.8, 1]}>
          <spriteMaterial map={getLabelTexture(label, accent)} depthTest={false} transparent />
        </sprite>
      )}
    </group>
  );
}
