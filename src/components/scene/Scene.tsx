"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3, type WebGLRenderer } from "three";
import { useGameStore } from "@/store/gameStore";
import type { Director } from "@/lib/anim/director";
import { Park } from "./Park";
import { Ball } from "./Ball";
import { VoxelPlayer } from "./VoxelPlayer";

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
          <VoxelPlayer
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
  quality: "pixel" | "crisp";
  onRenderer?: (gl: WebGLRenderer) => void;
}

export function Scene({ quality, onRenderer }: SceneProps) {
  const director = useGameStore((s) => s.director);
  const cameraFree = useGameStore((s) => s.cameraFree);

  return (
    <Canvas
      shadows={false}
      dpr={quality === "pixel" ? 0.42 : 1}
      gl={{
        antialias: false,
        // Required so the snapshot button can read pixels back out.
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      }}
      camera={{ fov: 50, near: 1, far: 3000, position: [0, 92, 132] }}
      style={{ imageRendering: "pixelated" }}
    >
      <color attach="background" args={["#79bdf0"]} />
      <hemisphereLight args={["#cfe8ff", "#3c5a34", 0.85]} />
      <ambientLight intensity={0.42} />
      <directionalLight position={[-260, 340, 190]} intensity={1.15} />
      <directionalLight position={[220, 180, -260]} intensity={0.28} color="#ffe9c2" />

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
          maxDistance={700}
        />
      )}
      {onRenderer && <RendererBridge onReady={onRenderer} />}
    </Canvas>
  );
}
