"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { Vector3, type WebGLRenderer } from "three";
import { useGameStore } from "@/store/gameStore";
import type { Director } from "@/lib/anim/director";
import { DEFAULT_CONDITIONS, skyLook } from "@/lib/field/sky";
import { Park } from "./Park";
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
 * Drives the camera from the director's shot list. Two things matter here: a
 * change of shot cuts rather than sliding the camera across the park, and a
 * hard-hit ball knocks the lens for a moment afterwards.
 */
function CameraRig({ director }: { director: Director }) {
  const target = useRef(new Vector3());
  const shake = useRef(new Vector3());
  const initialised = useRef(false);
  const lastCut = useRef(director.cameraCut);

  useFrame((state, delta) => {
    const desired = director.desiredCamera();
    const cut = director.cameraCut !== lastCut.current;
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

function RendererBridge({ onReady }: { onReady: (gl: WebGLRenderer) => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    onReady(gl);
  }, [gl, onReady]);
  return null;
}

export interface SceneProps {
  onRenderer?: (gl: WebGLRenderer) => void;
}

export function Scene({ onRenderer }: SceneProps) {
  const director = useGameStore((s) => s.director);
  const conditions = useGameStore((s) => s.snapshot?.conditions) ?? DEFAULT_CONDITIONS;

  // Recomputed only when the conditions object changes, which is once a poll.
  const look = useMemo(() => skyLook(conditions), [conditions]);

  useEffect(() => {
    director.fx.wind.copy(conditions.wind);
  }, [director, conditions]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{
        antialias: true,
        // Required so the snapshot button can read pixels back out.
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      }}
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
      <Park lampsLit={look.lampsLit} />
      <ContactShadows director={director} />
      <Actors director={director} />
      <Ball director={director} />
      <Effects fx={director.fx} />
      <Weather conditions={conditions} />

      <Engine />
      <CameraRig director={director} />
      {onRenderer && <RendererBridge onReady={onRenderer} />}
    </Canvas>
  );
}
