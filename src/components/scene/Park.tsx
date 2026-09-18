"use client";

import { useEffect, useMemo } from "react";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Shape,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import { buildPark, type Block, type CrowdPalette } from "@/lib/field/park";
import { paintedPark } from "@/lib/field/paint";
import { StadiumSigns } from "./StadiumSigns";
import { Stadium } from "./Stadium";
import { roundedBox } from "./geometry";

const LAMP_ON = "#fff6c9";
const LAMP_OFF = "#8d9298";

/** A gently beveled gable, normalized to the same unit bounds as other parts. */
function roofGeometry(): BufferGeometry {
  const profile = new Shape();
  profile.moveTo(-0.5, -0.5);
  profile.lineTo(0.5, -0.5);
  profile.lineTo(0.5, -0.3);
  profile.lineTo(0, 0.5);
  profile.lineTo(-0.5, -0.3);
  profile.closePath();
  const roof = new ExtrudeGeometry(profile, {
    depth: 0.94, steps: 1, bevelEnabled: true, bevelThickness: 0.03,
    bevelSize: 0.025, bevelSegments: 3, curveSegments: 1,
  });
  roof.center();
  roof.computeBoundingBox();
  const bounds = roof.boundingBox!;
  roof.scale(1 / (bounds.max.x - bounds.min.x), 1 / (bounds.max.y - bounds.min.y), 1);
  return roof;
}

function geometryFor(shape: NonNullable<Block["shape"]>): BufferGeometry {
  switch (shape) {
    case "round": return roundedBox(1, 1, 1, 0.14, 2);
    case "sphere": return new SphereGeometry(0.5, 20, 14);
    case "cylinder": return new CylinderGeometry(0.42, 0.5, 1, 16);
    case "roof": return roofGeometry();
    default: return new BoxGeometry(1, 1, 1);
  }
}

function fill(mesh: InstancedMesh, blocks: Block[], override?: string) {
  const dummy = new Object3D();
  const color = new Color();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    dummy.position.set(...block.p);
    dummy.rotation.set(0, block.r ?? 0, 0);
    dummy.scale.set(...block.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, color.set(override ?? block.c));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
}

/** Shared batches for fixtures and scenery; the continuous bowl adds one draw. */
export function Park({ lampsLit, crowd }: { lampsLit: boolean; crowd: CrowdPalette }) {
  const { structures, lamps, lampBlocks } = useMemo(() => {
    const blocks = buildPark(crowd);
    const shapes = ["box", "round", "sphere", "cylinder", "roof"] as const;
    const structures = shapes.map((shape) => {
      const instances = blocks.filter((b) => !b.glow && (b.shape ?? "box") === shape);
      const material = new MeshLambertMaterial();
      paintedPark(material);
      const mesh = new InstancedMesh(geometryFor(shape), material, instances.length);
      fill(mesh, instances);
      return mesh;
    });
    const lampBlocks = blocks.filter((block) => block.glow);
    const lamps = new InstancedMesh(
      roundedBox(1, 1, 1, 0.18, 2),
      new MeshBasicMaterial({ toneMapped: false }),
      lampBlocks.length,
    );
    return { structures, lamps, lampBlocks };
  }, [crowd]);

  useEffect(() => {
    fill(lamps, lampBlocks, lampsLit ? LAMP_ON : LAMP_OFF);
  }, [lamps, lampBlocks, lampsLit]);

  useEffect(() => () => {
    for (const mesh of [...structures, lamps]) {
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial | MeshBasicMaterial).dispose();
      mesh.dispose();
    }
  }, [structures, lamps]);

  return (
    <>
      <Stadium />
      <StadiumSigns />
      {structures.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      <primitive object={lamps} />
    </>
  );
}
