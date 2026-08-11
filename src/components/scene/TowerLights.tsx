"use client";

import { useMemo } from "react";
import { Object3D } from "three";
import { TOWER_ANGLES, towerPosition } from "@/lib/field/park";

/**
 * How each bank is aimed, and how wide it opens. Real banks are split between
 * the infield and the outfield, and this is why: four cones all pointed at the
 * mound leave the gaps and the warning track sitting in the dark. The two
 * towers down the lines throw across into the opposite outfield gap on a wide
 * cone; the pair inside them light the infield on a tighter, brighter one.
 *
 * `lateral` is negated against the tower's own side, so every beam crosses the
 * field rather than lighting the ground it stands on.
 */
const AIM: Record<number, { lateral: number; depth: number; angle: number; intensity: number }> = {
  [-74]: { lateral: 150, depth: 310, angle: 1, intensity: 0.85 },
  [-40]: { lateral: 95, depth: 100, angle: 0.86, intensity: 0.7 },
  [40]: { lateral: 95, depth: 100, angle: 0.86, intensity: 0.7 },
  [74]: { lateral: 150, depth: 310, angle: 1, intensity: 0.85 },
};

/**
 * The night rig: a spotlight on each of the four visible light towers.
 *
 * A single overhead light is what a night game looks like in a video game; what
 * it looks like in life is four beams crossing, so every player throws two or
 * three faint shadows that fan out in different directions. The two infield
 * banks cast the real shadows - that is where the players are, and a shadow map
 * spread over the whole outfield resolves nothing useful.
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
        const theta = (deg * Math.PI) / 180;
        const aim = AIM[deg];
        target.position.set(-Math.sin(theta) * aim.lateral, 4, -aim.depth);
        return target;
      }),
    [],
  );

  return (
    <>
      {TOWER_ANGLES.map((deg, i) => {
        const aim = AIM[deg];
        const infield = Math.abs(deg) < 60;
        return (
          <group key={deg}>
            <primitive object={targets[i]} />
            <spotLight
              position={towerPosition(deg)}
              target={targets[i]}
              angle={aim.angle}
              penumbra={0.9}
              decay={0}
              distance={0}
              intensity={aim.intensity * intensity}
              color="#fff4d6"
              castShadow={infield}
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
              shadow-camera-near={120}
              shadow-camera-far={900}
              shadow-bias={-0.0015}
            />
          </group>
        );
      })}
    </>
  );
}
