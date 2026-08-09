"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { Director } from "@/lib/anim/director";

const TRAIL_LENGTH = 10;

/** A blocky baseball plus a short trail of fading cubes behind it. */
export function Ball({ director }: { director: Director }) {
  const root = useRef<Group>(null);
  const trail = useRef<(Mesh | null)[]>([]);

  useFrame((_, delta) => {
    const group = root.current;
    if (!group) return;
    const ball = director.ball;
    group.visible = ball.visible;
    if (ball.visible) {
      group.position.copy(ball.position);
      group.rotation.x += delta * 9;
      group.rotation.y += delta * 6;
      const scale = 0.42 * ball.scale;
      group.scale.setScalar(scale);
    }

    const points = ball.trail;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const mesh = trail.current[i];
      if (!mesh) continue;
      const point = points[points.length - 1 - i];
      if (!point || !ball.visible) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.copy(point);
      const fade = 1 - i / TRAIL_LENGTH;
      mesh.scale.setScalar(0.3 * fade * ball.scale);
    }
  });

  return (
    <>
      <group ref={root}>
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshLambertMaterial color="#fbfbf2" emissive="#3a3a30" />
        </mesh>
        <mesh scale={[1.02, 0.18, 1.02]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshLambertMaterial color="#c8402f" />
        </mesh>
      </group>
      {Array.from({ length: TRAIL_LENGTH }).map((_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            trail.current[i] = node;
          }}
          visible={false}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35 - i * 0.03} />
        </mesh>
      ))}
    </>
  );
}
