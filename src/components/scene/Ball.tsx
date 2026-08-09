"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { Director } from "@/lib/anim/director";

const TRAIL_LENGTH = 12;

/** The baseball, plus a short comet trail so a fast pitch stays trackable. */
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
      group.rotation.x += delta * 11;
      group.rotation.z += delta * 7;
      group.scale.setScalar(0.42 * ball.scale);
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
      mesh.scale.setScalar(0.3 * fade * fade * ball.scale);
    }
  });

  return (
    <>
      <group ref={root}>
        <mesh castShadow>
          <icosahedronGeometry args={[1, 2]} />
          <meshLambertMaterial color="#fdfdf6" emissive="#2a2a24" />
        </mesh>
        {/* Two stitched seams. */}
        <mesh rotation={[0, 0, 0.5]}>
          <torusGeometry args={[0.82, 0.08, 6, 20, Math.PI * 1.1]} />
          <meshLambertMaterial color="#c0392b" />
        </mesh>
        <mesh rotation={[Math.PI, 0, 0.5]}>
          <torusGeometry args={[0.82, 0.08, 6, 20, Math.PI * 1.1]} />
          <meshLambertMaterial color="#c0392b" />
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
          <icosahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.3 - i * 0.022} />
        </mesh>
      ))}
    </>
  );
}
