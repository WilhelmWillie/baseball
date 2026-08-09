"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Sky } from "@react-three/drei";
import { Vector3, type WebGLRenderer } from "three";
import { useGameStore } from "@/store/gameStore";
import type { Director } from "@/lib/anim/director";
import { Park } from "./Park";
import { Field } from "./Field";
import { Ball } from "./Ball";
import { Player } from "./Player";

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

function CameraRig({ director }: { director: Director }) {
  const target = useRef(new Vector3());
  const initialised = useRef(false);

  useFrame((state, delta) => {
    if (director.isFreeCamera()) return;
    const desired = director.desiredCamera();
    if (!initialised.current) {
      state.camera.position.copy(desired.position);
      target.current.copy(desired.target);
      initialised.current = true;
    }
    const k = Math.min(1, delta * desired.lerp);
    state.camera.position.lerp(desired.position, k);
    target.current.lerp(desired.target, k);
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
  const cameraFree = useGameStore((s) => s.cameraFree);

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
      <Sky sunPosition={[-260, 190, 190]} turbidity={5} rayleigh={1.2} />

      <hemisphereLight args={["#cfe6ff", "#42663a", 0.8]} />
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[-300, 380, 220]}
        intensity={1.25}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={100}
        shadow-camera-far={900}
        shadow-camera-left={-320}
        shadow-camera-right={320}
        shadow-camera-top={320}
        shadow-camera-bottom={-320}
        shadow-bias={-0.0006}
      />
      <directionalLight position={[240, 190, -280]} intensity={0.25} color="#ffe6bd" />

      <Field />
      <Park />
      <Actors director={director} />
      <Ball director={director} />

      <Engine />
      <CameraRig director={director} />
      {cameraFree && (
        <OrbitControls
          makeDefault
          target={[0, 0, -70]}
          maxPolarAngle={Math.PI / 2.06}
          minDistance={40}
          maxDistance={800}
        />
      )}
      {onRenderer && <RendererBridge onReady={onRenderer} />}
    </Canvas>
  );
}
