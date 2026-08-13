"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { Vector3, type PerspectiveCamera } from "three";
import { useGameStore } from "@/store/gameStore";
import type { Director } from "@/lib/anim/director";
import { DEFAULT_CONDITIONS, skyLook } from "@/lib/field/sky";
import { Park } from "./Park";
import { Crowd } from "./Crowd";
import { Backstop } from "./Backstop";
import { DEFAULT_CROWD, type CrowdPalette } from "@/lib/field/park";
import { Field } from "./Field";
import { Ball } from "./Ball";
import { Player } from "./Player";
import { Effects } from "./Effects";
import { ContactShadows, GroundOcclusion } from "./Shadows";
import { Weather } from "./Weather";
import { TowerLights } from "./TowerLights";

/** Drives the animation clock and promotes feed state once the queue drains. */
function Engine() {
  const director = useGameStore((s) => s.director);
  const settle = useGameStore((s) => s.settle);
  useFrame((_, delta) => {
    director.update(Math.min(delta, 0.1));
    if (director.isIdle()) settle();
  });
  return null;
}

/**
 * Drives the camera from the director's shot list, or from the seat the viewer
 * picked. Two things matter here: a change of shot cuts rather than sliding the
 * camera across the park, and a hard-hit ball knocks the lens for a moment
 * afterwards.
 */
function CameraRig({ director }: { director: Director }) {
  const view = useGameStore((s) => s.cameraView);
  const target = useRef(new Vector3());
  const shake = useRef(new Vector3());
  const initialised = useRef(false);
  const lastCut = useRef(director.cameraCut);
  const lastView = useRef(view);

  useFrame((state, delta) => {
    const desired = director.desiredCamera(view);
    applyFraming(state.camera as PerspectiveCamera, state.viewport.aspect, desired.fov ?? BASE_FOV);
    // A phone held upright sees a very tall slice of the world, and most of it
    // is empty grass above and below the play. Pulling the framing in toward
    // the diamond spends that space on the game instead. A chosen seat keeps
    // its own aim - re-pointing it at the infield would not be that seat any
    // more - but it still moves up a little, which costs the composition
    // nothing and buys back some of the size the tall frame took away.
    const portrait = clamp01((0.85 - state.viewport.aspect) / 0.4);
    if (portrait > 0) {
      if (!desired.fixed) desired.target.lerp(INFIELD, portrait * 0.6);
      desired.position.lerp(desired.target, portrait * 0.14);
    }
    // And on top of that, drop the whole frame down so the plate action -
    // pitcher, batter, catcher - sits low on the screen rather than marooned in
    // the middle of a tall one. This is a lens shift, not a tilt: the shot's
    // composition is untouched, the rendered slice of it simply moves.
    applyPortraitShift(state.camera as PerspectiveCamera, state.size, portrait);
    // Changing seats is a cut like any other.
    const cut = director.cameraCut !== lastCut.current || view !== lastView.current;
    lastView.current = view;
    if (cut) lastCut.current = director.cameraCut;

    if (!initialised.current || cut) {
      state.camera.position.copy(desired.position);
      target.current.copy(desired.target);
      initialised.current = true;
    } else {
      const k = Math.min(1, delta * desired.lerp);
      state.camera.position.lerp(desired.position, k);
      target.current.lerp(desired.target, k);
    }

    const knock = director.cameraShake;
    if (knock > 0.001) {
      const t = state.clock.elapsedTime;
      shake.current.set(
        Math.sin(t * 47) * knock * 1.6,
        Math.sin(t * 39 + 1.7) * knock * 1.2,
        Math.sin(t * 53 + 0.6) * knock * 1.1,
      );
      state.camera.position.add(shake.current);
    }
    state.camera.lookAt(target.current);
  });

  return null;
}

function Actors({ director }: { director: Director }) {
  const snapshot = useGameStore((s) => s.snapshot);
  const [, bump] = useState(0);
  const version = useRef(director.rosterVersion);

  useFrame(() => {
    if (director.rosterVersion !== version.current) {
      version.current = director.rosterVersion;
      bump((v) => v + 1);
    }
  });

  if (!snapshot) return null;

  return (
    <>
      {[...director.actors.values()].map((actor) => {
        const team = snapshot.teams[actor.side];
        const highlight =
          actor.role === "batter" ||
          actor.role === "runner" ||
          actor.positionKey === "pitcher";
        return (
          <Player
            key={actor.key}
            actor={actor}
            uniform={team.uniform}
            // The home club are aliens, the visitors are robots.
            species={actor.side === "home" ? "alien" : "robot"}
            director={director}
            showLabel={highlight}
            accent={team.palette.primary}
          />
        );
      })}
    </>
  );
}

/**
 * Keeps the framing sane on a phone. `fov` in three.js is *vertical*, so a tall
 * narrow viewport sees a much narrower slice of the world horizontally - on a
 * portrait phone the diamond falls out of frame at either side. Holding the
 * horizontal field of view roughly constant instead, by widening the vertical
 * one as the aspect narrows, keeps the same shot on every screen.
 *
 * `base` is the lens the shot was composed on: the broadcast one, or the longer
 * lens a fixed seat watches through.
 */
function applyFraming(camera: PerspectiveCamera, aspect: number, base: number) {
  if (!camera.isPerspectiveCamera) return;
  const horizontal = 2 * Math.atan(Math.tan((base * Math.PI) / 360) * BASE_ASPECT);
  const fov = (2 * Math.atan(Math.tan(horizontal / 2) / Math.max(0.45, aspect)) * 180) / Math.PI;
  const next = Math.min(WIDEST, base * WIDEST_GAIN, Math.max(base, fov));
  if (Math.abs(camera.fov - next) < 0.01) return;
  camera.fov = next;
  camera.updateProjectionMatrix();
}

/**
 * Shift the rendered frustum down in portrait so the subject sits toward the
 * bottom of a tall frame. `setViewOffset` renders an off-centre slice of the
 * same frustum - an asymmetric lens shift - so nothing zooms and no perspective
 * is added; the picture just slides. A negative vertical offset raises the top
 * of the frustum, which drops what was centred toward the foot of the frame.
 */
function applyPortraitShift(camera: PerspectiveCamera, size: { width: number; height: number }, portrait: number) {
  if (!camera.isPerspectiveCamera) return;
  if (portrait > 0.001 && size.width > 0 && size.height > 0) {
    const dy = -portrait * PORTRAIT_DROP * size.height;
    camera.setViewOffset(size.width, size.height, 0, dy, size.width, size.height);
  } else if (camera.view?.enabled) {
    camera.clearViewOffset();
  }
}

/**
 * How far down the frame slides at full portrait, as a fraction of its height.
 * Enough to seat the plate action along the bottom third without pushing a
 * rising fly ball off the top.
 */
const PORTRAIT_DROP = 0.16;

/** The framing the shot list was composed against: a 16:9 desktop window. */
const BASE_FOV = 50;
const BASE_ASPECT = 16 / 9;
/**
 * As wide as the correction is allowed to go. A long lens on a portrait phone
 * would need a fisheye to hold its horizontal framing; past here the shot gives
 * up some of its width instead.
 */
const WIDEST = 78;
/**
 * And as wide as any *one* shot is allowed to be pulled, as a multiple of the
 * lens it was composed on. The correction above is absolute, which is fine for
 * the 50-degree broadcast lens but ruinous for a long one: holding the width of
 * a 20-degree centre-field shot on a phone held upright would mean opening up
 * to nearly 80 degrees, and the hitter it was framed on would be four pixels
 * tall. Past this the shot keeps its subject and loses the width instead - but
 * not so early that the centre-field shot loses the pitcher off the left edge,
 * which is what set this number.
 */
const WIDEST_GAIN = 1.9;

/** Roughly the middle of the diamond, in world space. */
const INFIELD = new Vector3(0, 6, -63);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function Scene() {
  const director = useGameStore((s) => s.director);
  const conditions = useGameStore((s) => s.snapshot?.conditions) ?? DEFAULT_CONDITIONS;
  const teams = useGameStore((s) => s.snapshot?.teams);

  // The stands wear the home club's colours, with the visitors' sprinkled in.
  const crowd = useMemo<CrowdPalette>(
    () =>
      teams
        ? {
            home: [teams.home.palette.primary, teams.home.palette.secondary],
            away: [teams.away.palette.primary, teams.away.palette.secondary],
          }
        : DEFAULT_CROWD,
    [teams],
  );

  // Recomputed only when the conditions object changes, which is once a poll.
  const look = useMemo(() => skyLook(conditions), [conditions]);

  useEffect(() => {
    director.fx.wind.copy(conditions.wind);
  }, [director, conditions]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 50, near: 2, far: 4000, position: [0, 92, 132] }}
    >
      {look.background ? (
        <color attach="background" args={[look.background]} />
      ) : (
        <Sky
          sunPosition={look.skySun}
          turbidity={look.turbidity}
          rayleigh={look.rayleigh}
          mieCoefficient={look.mie}
        />
      )}
      {look.fog && <fogExp2 attach="fog" args={[look.fog.color, look.fog.density]} />}

      <hemisphereLight args={[look.hemiSky, look.hemiGround, look.hemiIntensity]} />
      <ambientLight intensity={look.ambient} />
      <directionalLight
        position={look.sun}
        intensity={look.sunIntensity}
        color={look.sunColor}
        castShadow={!look.towerRig}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={100}
        shadow-camera-far={1400}
        shadow-camera-left={-320}
        shadow-camera-right={320}
        shadow-camera-top={320}
        shadow-camera-bottom={-320}
        shadow-bias={-0.0006}
      />
      {/* Bounce off the far side, so nothing sits in pure black. */}
      <directionalLight
        position={[-look.sun[0] * 0.7, 190, -280]}
        intensity={look.fillIntensity}
        color={look.fillColor}
      />

      {look.towerRig && <TowerLights intensity={0.55 + look.night * 0.65} />}

      <Field />
      <GroundOcclusion />
      <Park lampsLit={look.lampsLit} crowd={crowd} />
      <Crowd palette={crowd} director={director} />
      <Backstop />
      <ContactShadows director={director} />
      <Actors director={director} />
      <Ball director={director} />
      <Effects fx={director.fx} />
      <Weather conditions={conditions} />

      <Engine />
      <CameraRig director={director} />
    </Canvas>
  );
}
