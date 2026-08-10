"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
  type Camera,
} from "three";
import type { Conditions } from "@/lib/field/sky";

const MAX_DROPS = 900;
/** Half-extent of the box of weather kept around the camera. */
const SPAN = 150;
const CEILING = 120;

interface Drop {
  pos: Vector3;
  speed: number;
  sway: number;
  phase: number;
}

function makeDrops(): Drop[] {
  const drops: Drop[] = [];
  for (let i = 0; i < MAX_DROPS; i++) {
    drops.push({
      pos: new Vector3(
        (Math.random() - 0.5) * SPAN * 2,
        Math.random() * CEILING,
        (Math.random() - 0.5) * SPAN * 2,
      ),
      speed: 0.7 + Math.random() * 0.6,
      sway: Math.random() * 2 + 0.5,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return drops;
}

function step(
  mesh: InstancedMesh,
  drops: Drop[],
  dummy: Object3D,
  camera: Camera,
  conditions: Conditions,
  dt: number,
) {
  const active = Math.round(MAX_DROPS * Math.min(1, conditions.rain));
  if (active === 0) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;

  const snow = conditions.snow;
  const fall = snow ? 22 : 190;
  const wind = conditions.wind;
  // Rain leans into the wind; snow gets pushed around by it.
  const lean = snow ? 2.4 : 0.55;

  for (let i = 0; i < active; i++) {
    const drop = drops[i];
    drop.phase += dt * drop.sway;
    drop.pos.y -= fall * drop.speed * dt;
    drop.pos.x += (wind.x * lean + (snow ? Math.sin(drop.phase) * 6 : 0)) * dt;
    drop.pos.z += (wind.z * lean + (snow ? Math.cos(drop.phase * 0.7) * 6 : 0)) * dt;

    // Keep the box centred on the camera and wrap anything that leaves it, so
    // the same few hundred drops cover wherever the camera happens to look.
    const dx = drop.pos.x - camera.position.x;
    const dz = drop.pos.z - camera.position.z;
    if (drop.pos.y < 0) {
      drop.pos.y = CEILING;
      drop.pos.x = camera.position.x + (Math.random() - 0.5) * SPAN * 2;
      drop.pos.z = camera.position.z + (Math.random() - 0.5) * SPAN * 2;
    } else if (Math.abs(dx) > SPAN) {
      drop.pos.x -= Math.sign(dx) * SPAN * 2;
    } else if (Math.abs(dz) > SPAN) {
      drop.pos.z -= Math.sign(dz) * SPAN * 2;
    }

    dummy.position.copy(drop.pos);
    if (snow) {
      dummy.rotation.set(0, drop.phase, 0);
      dummy.scale.set(0.5, 0.5, 0.5);
    } else {
      // Streaks tilt along the way they are falling.
      dummy.rotation.set(0, 0, Math.atan2(wind.x * lean, fall) * -1);
      dummy.scale.set(0.5, 5.5, 0.5);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  dummy.scale.set(0, 0, 0);
  dummy.updateMatrix();
  for (let i = active; i < MAX_DROPS; i++) mesh.setMatrixAt(i, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Rain and snow: a few hundred streaks in a box that travels with the camera.
 * It only exists when the feed says the weather is doing something.
 */
export function Weather({ conditions }: { conditions: Conditions }) {
  const { mesh, drops, dummy } = useMemo(() => {
    const instanced = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: "#dce8f5", transparent: true, opacity: 0.45, depthWrite: false }),
      MAX_DROPS,
    );
    instanced.frustumCulled = false;
    instanced.visible = false;
    return { mesh: instanced, drops: makeDrops(), dummy: new Object3D() };
  }, []);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.dispose();
    };
  }, [mesh]);

  useFrame((state, delta) => {
    step(mesh, drops, dummy, state.camera, conditions, Math.min(delta, 0.06));
  });

  if (conditions.rain <= 0) return null;
  return <primitive object={mesh} />;
}
