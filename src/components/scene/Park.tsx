"use client";

import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
} from "three";
import { buildPark, type Block } from "@/lib/field/park";

const LAMP_ON = "#fff6c9";
const LAMP_OFF = "#8d9298";

function fill(mesh: InstancedMesh, blocks: Block[], override?: string) {
  const dummy = new Object3D();
  const color = new Color();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    dummy.position.set(block.p[0], block.p[1], block.p[2]);
    dummy.rotation.set(0, block.r ?? 0, 0);
    dummy.scale.set(block.s[0], block.s[1], block.s[2]);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set(override ?? block.c));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
}

/**
 * The entire stadium in one InstancedMesh - every tile, seat, spectator and
 * light tower is the same unit cube with a per-instance transform and color.
 * The lamp faces are split into a second, tiny mesh so they can burn unlit by
 * the sun once the tower lights come on.
 */
export function Park({ lampsLit }: { lampsLit: boolean }) {
  const { structure, lamps } = useMemo(() => {
    const blocks = buildPark();
    const geometry = new BoxGeometry(1, 1, 1);

    const solid = blocks.filter((b) => !b.glow);
    const glowing = blocks.filter((b) => b.glow);

    const structureMesh = new InstancedMesh(
      geometry,
      new MeshLambertMaterial({ flatShading: true }),
      solid.length,
    );
    structureMesh.castShadow = false;
    structureMesh.receiveShadow = false;
    fill(structureMesh, solid);

    const lampMesh = new InstancedMesh(
      geometry.clone(),
      new MeshBasicMaterial({ toneMapped: false }),
      glowing.length,
    );

    return { structure: structureMesh, lamps: lampMesh, lampBlocks: glowing };
  }, []);

  const lampBlocks = useMemo(() => buildPark().filter((block) => block.glow), []);

  useEffect(() => {
    fill(lamps, lampBlocks, lampsLit ? LAMP_ON : LAMP_OFF);
  }, [lamps, lampBlocks, lampsLit]);

  useEffect(() => {
    return () => {
      structure.geometry.dispose();
      (structure.material as MeshLambertMaterial).dispose();
      structure.dispose();
      lamps.geometry.dispose();
      (lamps.material as MeshBasicMaterial).dispose();
      lamps.dispose();
    };
  }, [structure, lamps]);

  return (
    <>
      <primitive object={structure} />
      <primitive object={lamps} />
    </>
  );
}
