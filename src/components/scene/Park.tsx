"use client";

import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from "three";
import { buildPark } from "@/lib/field/park";

/**
 * The entire stadium in one InstancedMesh - every tile, seat, spectator and
 * light tower is the same unit cube with a per-instance transform and color.
 */
export function Park() {
  const mesh = useMemo(() => {
    const blocks = buildPark();
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshLambertMaterial({ flatShading: true });
    const instanced = new InstancedMesh(geometry, material, blocks.length);
    instanced.castShadow = false;
    instanced.receiveShadow = false;

    const dummy = new Object3D();
    const color = new Color();
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      dummy.position.set(block.p[0], block.p[1], block.p[2]);
      dummy.rotation.set(0, block.r ?? 0, 0);
      dummy.scale.set(block.s[0], block.s[1], block.s[2]);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
      instanced.setColorAt(i, color.set(block.c));
    }
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    instanced.frustumCulled = false;
    return instanced;
  }, []);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
      mesh.dispose();
    };
  }, [mesh]);

  return <primitive object={mesh} />;
}
