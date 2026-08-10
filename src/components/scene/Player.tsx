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
  TorusGeometry,
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
  bat: new CylinderGeometry(0.17, 0.06, 1, 10),

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
  capTop: roundedBox(1.34, 0.3, 1.2, 0.12),
  earFlap: roundedBox(0.16, 0.46, 0.54, 0.07),
  vent: roundedBox(0.62, 0.08, 0.1, 0.03),
  finger: roundedBox(0.14, 0.44, 0.14, 0.06),
  toe: roundedBox(0.24, 0.2, 0.5, 0.08),
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
      glove: phong("#6b4526", 14, "#2a2a2a"),
      bat: phong("#c89a5c", 30, "#4a4a4a"),
    };
  }, [uniform, actor.playerId, isAlien]);

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
    hips.position.y = 2.45;
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
    const makeArm = (side: number) => {
      const shoulder = new Group();
      shoulder.position.set(side * (isAlien ? 0.98 : 1.06), 1.46, 0);
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
      elbow.position.y = -0.98;
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

    if (isAlien) {
      // A tall teardrop cranium tapering to a small chin.
      add(head, GEO.sphere, materials.skin, [0, 0.8, 0], [1.52, 1.94, 1.36], undefined, true);
      add(head, GEO.sphere, materials.skin, [0, 0.16, 0.06], [0.94, 0.92, 1.02]);
      // Brow ridge.
      add(head, GEO.box, materials.skin, [0, 0.98, 0.5], [1.02, 0.12, 0.24]);
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
        antenna.position.set(side * 0.3, 1.5, -0.05);
        antenna.rotation.z = side * 0.26;
        head.add(antenna);
        add(antenna, GEO.taper, materials.skin, [0, 0.3, 0], [0.11, 0.62, 0.11]);
        add(antenna, GEO.lowSphere, materials.lamp, [0, 0.66, 0], [0.24, 0.24, 0.24]);
        danglers.push(antenna);
      }

      if (wearsHelmet) {
        add(head, GEO.dome, materials.helmet, [0, 0.86, 0], [1.66, 1.5, 1.52], undefined, true);
        add(head, GEO.brim, materials.helmet, [0, 0.88, 0.7], [1.1, 1, 1]);
        add(head, GEO.earFlap, materials.helmet, [0.66, 0.58, 0.04]);
      } else {
        add(head, GEO.dome, materials.helmet, [0, 1.24, 0], [1.24, 0.9, 1.14]);
        add(head, GEO.brim, materials.helmet, [0, 1.26, 0.56], [0.86, 1, 0.86]);
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
      antenna.position.set(0.44, 1.24, -0.1);
      head.add(antenna);
      add(antenna, GEO.taper, materials.dark, [0, 0.26, 0], [0.09, 0.54, 0.09]);
      add(antenna, GEO.lowSphere, materials.lamp, [0, 0.58, 0], [0.2, 0.2, 0.2]);
      danglers.push(antenna);

      if (wearsHelmet) {
        add(head, GEO.dome, materials.helmet, [0, 0.82, 0], [1.62, 1.24, 1.5], undefined, true);
        add(head, GEO.brim, materials.helmet, [0, 0.86, 0.68], [1.16, 1, 1]);
        add(head, GEO.earFlap, materials.helmet, [0.68, 0.56, 0.02]);
      } else {
        add(head, GEO.capTop, materials.helmet, [0, 1.3, 0]);
        add(head, GEO.brim, materials.helmet, [0, 1.24, 0.58]);
      }
    }

    // --- Equipment --------------------------------------------------------
    if (actor.role === "batter") {
      const bat = new Mesh(GEO.bat, materials.bat);
      bat.scale.set(1, 3.1, 1);
      bat.position.set(0, -1.6, 0.12);
      bat.rotation.x = -0.6;
      bat.castShadow = true;
      armL.elbow.add(bat);
    } else if (actor.role === "fielder") {
      const glove = new Mesh(GEO.sphere, materials.glove);
      glove.scale.set(1.1, 1.24, 0.66);
      glove.position.set(0, -1.14, 0.12);
      glove.castShadow = true;
      armL.elbow.add(glove);
      const web = new Mesh(GEO.box, materials.dark);
      web.scale.set(0.9, 0.12, 0.5);
      web.position.set(0, -0.62, 0.12);
      armL.elbow.add(web);
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
  }, [materials, numberMaterial, actor.role, isAlien, wearsHelmet]);

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
    const wobble = Math.sin(state.clock.elapsedTime * 5 + live.playerId) * 0.14;
    for (let i = 0; i < parts.danglers.length; i++) {
      const dangler = parts.danglers[i];
      dangler.rotation.x = -v.lean * 0.85 + wobble * (i === 0 ? 1 : -1);
    }
  });

  const label = labelText ?? actor.shortName;

  return (
    <group ref={rootRef} position={actor.position} rotation={[0, actor.facing, 0]}>
      <primitive object={model} />
      {showLabel && (
        <sprite position={[0, 17.2, 0]} scale={[labelAspect(label) * 4.6, 4.6, 1]}>
          <spriteMaterial map={getLabelTexture(label, accent)} depthTest={false} transparent />
        </sprite>
      )}
    </group>
  );
}
