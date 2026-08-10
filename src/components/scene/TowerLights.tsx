"use client";

import { useMemo } from "react";
import { Object3D } from "three";
import { TOWER_ANGLES, towerPosition } from "@/lib/field/park";

/**
 * The night rig: a spotlight on each of the four visible light towers, aimed
 * at the infield.
 *
 * A single overhead light is what a night game looks like in a video game; what
 * it looks like in life is four beams crossing, so every player throws two or
 * three faint shadows that fan out in different directions. Two of the four
 * cast real shadows - enough to read the effect without paying for four more
 * shadow maps over a whole ballpark.
 *
 * `decay` is zero on purpose: these are 500 feet from the plate, and physical
 * falloff over that distance would need an intensity large enough to blow out
 * anything that strayed near the tower.
 */
export function TowerLights({ intensity = 1 }: { intensity?: number }) {
  // Spotlights aim at a target object rather than a point, so each one needs
  // its own, parented into the scene.
  const targets = useMemo(
    () =>
      TOWER_ANGLES.map((deg) => {
        const target = new Object3D();
        // Each bank is aimed across the field rather than at the middle, the
        // way real ones are: crossed beams light the whole surface evenly
        // instead of stacking four cones on the pitcher's mound.
        const theta = (deg * Math.PI) / 180;
        target.position.set(-Math.sin(theta) * 105, 4, -70 - Math.cos(theta) * 40);
        return target;
      }),
    [],
  );

  return (
    <>
      {TOWER_ANGLES.map((deg, i) => (
        <group key={deg}>
          <primitive object={targets[i]} />
          <spotLight
            position={towerPosition(deg)}
            target={targets[i]}
            angle={0.82}
            penumbra={0.6}
            decay={0}
            distance={0}
            intensity={0.7 * intensity}
            color="#fff4d6"
            castShadow={i === 0 || i === 2}
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
            shadow-camera-near={120}
            shadow-camera-far={900}
            shadow-bias={-0.0015}
          />
        </group>
      ))}
    </>
  );
}
