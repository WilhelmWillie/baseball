"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Material,
} from "three";
import type { Actor, Pose } from "@/lib/anim/director";
import type { Uniform } from "@/lib/mlb/teams";
import { getLabelTexture, getNumberTexture, labelAspect } from "./textures";

const SKIN = ["#e6b98f", "#c98b5c", "#8a5a36", "#5f3a22", "#f0d0ae"];
const SHOE = "#232427";

/** One shared unit cube for every body part. */
const UNIT = new BoxGeometry(1, 1, 1);

function skinFor(playerId: number): string {
  return SKIN[playerId % SKIN.length];
}

interface Limbs {
  root: Group;
  hips: Group;
  legL: Group;
  legR: Group;
  torso: Group;
  armL: Group;
  armR: Group;
  head: Group;
  bat?: Group;
}

interface PoseValues {
  crouch: number;
  lean: number;
  twist: number;
  legL: number;
  legR: number;
  armL: number;
  armR: number;
  armSpread: number;
  bob: number;
}

function poseValues(pose: Pose, t: number, clock: number): PoseValues {
  const base: PoseValues = {
    crouch: 0,
    lean: 0,
    twist: 0,
    legL: 0,
    legR: 0,
    armL: 0,
    armR: 0,
    armSpread: 0,
    bob: Math.sin(clock * 2 + t * 3) * 0.03,
  };

  switch (pose) {
    case "ready":
      return { ...base, crouch: 0.35, lean: 0.22, armL: -0.55, armR: -0.55, armSpread: 0.28 };
    case "run": {
      const swing = Math.sin(t * Math.PI * 2);
      return {
        ...base,
        crouch: 0.18,
        lean: 0.34,
        legL: swing * 1.05,
        legR: -swing * 1.05,
        armL: -swing * 0.95,
        armR: swing * 0.95,
        bob: Math.abs(Math.cos(t * Math.PI * 2)) * 0.16,
      };
    }
    case "windup":
      return {
        ...base,
        crouch: 0.25 + t * 0.1,
        lean: -0.12,
        twist: -0.5 * t,
        legL: -1.5 * t,
        armL: -2.1 * t,
        armR: -1.5 * t,
      };
    case "throw": {
      const u = Math.min(1, t * 1.6);
      return {
        ...base,
        crouch: 0.3,
        lean: 0.55 * u,
        twist: -0.5 + u * 0.8,
        legL: 0.9 * u,
        legR: -0.5 * u,
        armR: -2.6 + u * 3.1,
        armL: 1.1 * u,
      };
    }
    case "swing": {
      // Load, then whip through the zone.
      const load = Math.min(1, t / 0.32);
      const fire = Math.max(0, (t - 0.32) / 0.68);
      return {
        ...base,
        crouch: 0.3,
        lean: 0.18,
        twist: 0.65 * load - 2.5 * fire,
        legL: 0.3 * load,
        armL: -0.9 - 0.5 * load + 0.6 * fire,
        armR: -0.9 - 0.5 * load + 0.6 * fire,
      };
    }
    case "catch":
      return { ...base, crouch: 0.45, lean: 0.15, armL: -2.7, armR: -2.3, armSpread: 0.5 };
    case "celebrate":
      return {
        ...base,
        armL: -2.9,
        armR: -2.9,
        armSpread: 0.7,
        bob: Math.abs(Math.sin(clock * 7)) * 0.5,
      };
    case "dejected":
      return { ...base, crouch: 0.5, lean: 0.7, armL: 0.35, armR: 0.35 };
    case "sit":
      return { ...base, crouch: 1.35, legL: -1.45, legR: -1.45, armL: -0.3, armR: -0.3 };
    default:
      return { ...base, crouch: 0.05, armL: -0.08, armR: -0.08 };
  }
}

export interface VoxelPlayerProps {
  actor: Actor;
  uniform: Uniform;
  director: { actors: Map<string, Actor> };
  showLabel?: boolean;
  labelText?: string;
  accent?: string;
}

export function VoxelPlayer({
  actor,
  uniform,
  director,
  showLabel = false,
  labelText,
  accent = "#ffffff",
}: VoxelPlayerProps) {
  const rootRef = useRef<Group>(null);
  const limbsRef = useRef<Limbs | null>(null);
  const key = actor.key;

  const materials = useMemo(() => {
    const jersey = new MeshLambertMaterial({ color: uniform.jersey });
    const pants = new MeshLambertMaterial({ color: uniform.pants });
    const cap = new MeshLambertMaterial({ color: uniform.cap });
    const trim = new MeshLambertMaterial({ color: uniform.trim });
    const skin = new MeshLambertMaterial({ color: skinFor(actor.playerId) });
    const shoe = new MeshLambertMaterial({ color: SHOE });
    const glove = new MeshLambertMaterial({ color: "#5a3a22" });
    const bat = new MeshLambertMaterial({ color: "#c79a5b" });
    return { jersey, pants, cap, trim, skin, shoe, glove, bat };
  }, [uniform, actor.playerId]);

  // The number lives on the back face of the torso block.
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

  // The model and its limb handles are built together so nothing has to be
  // written into a ref during render.
  const { model, limbs } = useMemo(() => {
    const root = new Group();
    const hips = new Group();
    hips.position.y = 2.55;
    root.add(hips);

    const makeLeg = (side: number) => {
      const group = new Group();
      group.position.set(side * 0.45, 0, 0);
      const thigh = new Mesh(UNIT, materials.pants);
      thigh.scale.set(0.82, 2.55, 0.82);
      thigh.position.y = -1.28;
      group.add(thigh);
      const shoe = new Mesh(UNIT, materials.shoe);
      shoe.scale.set(0.9, 0.42, 1.25);
      shoe.position.set(0, -2.48, 0.18);
      group.add(shoe);
      const sock = new Mesh(UNIT, materials.trim);
      sock.scale.set(0.86, 0.5, 0.86);
      sock.position.y = -2.1;
      group.add(sock);
      hips.add(group);
      return group;
    };
    const legL = makeLeg(1);
    const legR = makeLeg(-1);

    const torso = new Group();
    hips.add(torso);
    const chest = new Mesh(UNIT, torsoMaterials as Material | Material[]);
    chest.scale.set(2.1, 2.35, 1.15);
    chest.position.y = 1.18;
    torso.add(chest);
    const belt = new Mesh(UNIT, materials.trim);
    belt.scale.set(2.16, 0.28, 1.2);
    belt.position.y = 0.06;
    torso.add(belt);

    const makeArm = (side: number) => {
      const group = new Group();
      group.position.set(side * 1.32, 2.15, 0);
      const arm = new Mesh(UNIT, materials.jersey);
      arm.scale.set(0.62, 1.35, 0.62);
      arm.position.y = -0.68;
      group.add(arm);
      const hand = new Mesh(UNIT, materials.skin);
      hand.scale.set(0.66, 0.95, 0.66);
      hand.position.y = -1.8;
      group.add(hand);
      torso.add(group);
      return group;
    };
    const armL = makeArm(1);
    const armR = makeArm(-1);

    const head = new Group();
    head.position.y = 2.42;
    torso.add(head);
    const skull = new Mesh(UNIT, materials.skin);
    skull.scale.set(1.25, 1.25, 1.25);
    skull.position.y = 0.62;
    head.add(skull);
    const cap = new Mesh(UNIT, materials.cap);
    cap.scale.set(1.36, 0.42, 1.36);
    cap.position.y = 1.42;
    head.add(cap);
    const brim = new Mesh(UNIT, materials.cap);
    brim.scale.set(1.36, 0.2, 0.62);
    brim.position.set(0, 1.28, 0.72);
    head.add(brim);

    let bat: Group | undefined;
    if (actor.role === "batter") {
      bat = new Group();
      const stick = new Mesh(UNIT, materials.bat);
      stick.scale.set(0.34, 3.1, 0.34);
      stick.position.y = 1.3;
      bat.add(stick);
      bat.position.set(0, -1.9, 0.2);
      bat.rotation.x = -0.5;
      armL.add(bat);
    } else if (actor.role === "fielder") {
      const glove = new Mesh(UNIT, materials.glove);
      glove.scale.set(1.0, 1.15, 0.5);
      glove.position.y = -2.1;
      armL.add(glove);
    }

    const parts: Limbs = { root, hips, legL, legR, torso, armL, armR, head, bat };
    return { model: root, limbs: parts };
  }, [materials, torsoMaterials, actor.role]);

  // Hand the limb handles to a ref: the frame loop mutates the three.js scene
  // graph in place, which is the R3F contract but not something a memoized
  // value may be used for.
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

    const values = poseValues(live.pose, live.poseT, state.clock.elapsedTime + live.playerId);
    parts.hips.position.y = 2.55 - values.crouch + values.bob;
    parts.torso.rotation.x = values.lean;
    parts.torso.rotation.y = values.twist;
    parts.legL.rotation.x = values.legL;
    parts.legR.rotation.x = values.legR;
    parts.armL.rotation.x = values.armL;
    parts.armR.rotation.x = values.armR;
    parts.armL.rotation.z = -values.armSpread;
    parts.armR.rotation.z = values.armSpread;
  });

  const label = labelText ?? actor.shortName;

  return (
    <group ref={rootRef} position={actor.position} rotation={[0, actor.facing, 0]}>
      <primitive object={model} />
      {showLabel && (
        <sprite position={[0, 9.2, 0]} scale={[labelAspect(label) * 4.2, 4.2, 1]}>
          <spriteMaterial
            map={getLabelTexture(label, accent)}
            depthTest={false}
            transparent
          />
        </sprite>
      )}
    </group>
  );
}
