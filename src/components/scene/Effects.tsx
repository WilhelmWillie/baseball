"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BoxGeometry,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
} from "three";
import type { Fx, Particle } from "@/lib/anim/particles";

const MAX_CONFETTI = 900;
const MAX_SPARKS = 1400;
const MAX_DUST = 460;

/** Push a particle list into an InstancedMesh, hiding the unused slots. */
function writeInstances(
  mesh: InstancedMesh,
  particles: Particle[],
  dummy: Object3D,
  color: Color,
  max: number,
  fade: boolean,
) {
  const count = Math.min(particles.length, max);
  for (let i = 0; i < count; i++) {
    const p = particles[i];
    dummy.position.copy(p.pos);
    dummy.rotation.set(p.rot.x, p.rot.y, p.rot.z);
    const life = p.life / p.maxLife;
    const scale = fade ? p.size * Math.max(0.15, Math.min(1, life * 1.6)) : p.size;
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    // Sparks cool as they die.
    mesh.setColorAt(i, fade ? color.copy(p.color).multiplyScalar(Math.max(0.2, life)) : p.color);
  }
  // Collapse the leftovers so they draw nothing.
  dummy.scale.set(0, 0, 0);
  dummy.updateMatrix();
  for (let i = count; i < max; i++) mesh.setMatrixAt(i, dummy.matrix);

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.visible = count > 0;
}

/** Confetti and fireworks, driven by the director's effect system. */
export function Effects({ fx }: { fx: Fx }) {
  const { confettiMesh, sparkMesh, dustMesh, dummy, scratch } = useMemo(() => {
    // Thin rectangles tumble like paper.
    const confettiGeo = new BoxGeometry(1, 0.12, 0.55);
    const confettiMat = new MeshBasicMaterial({ toneMapped: false });
    const confetti = new InstancedMesh(confettiGeo, confettiMat, MAX_CONFETTI);
    confetti.frustumCulled = false;
    confetti.visible = false;

    const sparkGeo = new IcosahedronGeometry(0.9, 0);
    const sparkMat = new MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const sparks = new InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    sparks.frustumCulled = false;
    sparks.visible = false;

    // Dirt is lit, not glowing, so it sits in the scene rather than on top of
    // it - and it is the one effect that has to look like it belongs on the
    // ground.
    const dustGeo = new IcosahedronGeometry(0.62, 0);
    const dustMat = new MeshLambertMaterial({ transparent: true, opacity: 0.72, depthWrite: false });
    const dust = new InstancedMesh(dustGeo, dustMat, MAX_DUST);
    dust.frustumCulled = false;
    dust.visible = false;

    return {
      confettiMesh: confetti,
      sparkMesh: sparks,
      dustMesh: dust,
      dummy: new Object3D(),
      scratch: new Color(),
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const mesh of [confettiMesh, sparkMesh, dustMesh]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
        mesh.dispose();
      }
    };
  }, [confettiMesh, sparkMesh, dustMesh]);

  useFrame(() => {
    fx.update();
    writeInstances(confettiMesh, fx.confetti, dummy, scratch, MAX_CONFETTI, false);
    writeInstances(sparkMesh, fx.sparks, dummy, scratch, MAX_SPARKS, true);
    writeInstances(dustMesh, fx.dust, dummy, scratch, MAX_DUST, true);
  });

  return (
    <>
      <primitive object={confettiMesh} />
      <primitive object={sparkMesh} />
      <primitive object={dustMesh} />
    </>
  );
}
