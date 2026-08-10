"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3, type Group, type Mesh } from "three";
import type { Director } from "@/lib/anim/director";

const TRAIL_LENGTH = 12;
const UP = new Vector3(0, 1, 0);
const velocity = new Vector3();

/**
 * The baseball, plus a short comet trail so a fast pitch stays trackable. At
 * speed the ball itself stretches along its path - the same trick a camera
 * shutter plays on a real one, and it costs nothing.
 */
export function Ball({ director }: { director: Director }) {
  const root = useRef<Group>(null);
  const stretch = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const trail = useRef<(Mesh | null)[]>([]);

  useFrame((_, delta) => {
    const group = root.current;
    if (!group) return;
    const ball = director.ball;
    group.visible = ball.visible;
    if (ball.visible) {
      group.position.copy(ball.position);
      if (spin.current) {
        spin.current.rotation.x += delta * 11;
        spin.current.rotation.z += delta * 7;
      }
      group.scale.setScalar(0.42 * ball.scale);
    }

    const points = ball.trail;
    if (stretch.current) {
      // Direction and speed come from the trail, which the director appends to
      // every frame the ball is live.
      const last = points[points.length - 1];
      const prev = points[points.length - 2];
      let smear = 1;
      if (ball.visible && last && prev) {
        velocity.subVectors(last, prev);
        const speed = velocity.length() / Math.max(delta, 0.001);
        if (speed > 1) {
          stretch.current.quaternion.setFromUnitVectors(UP, velocity.normalize());
          smear = 1 + Math.min(2.2, speed / 90);
        }
      }
      stretch.current.scale.set(1, smear, 1);
    }

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
        <group ref={stretch}>
          <group ref={spin}>
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
        </group>
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
