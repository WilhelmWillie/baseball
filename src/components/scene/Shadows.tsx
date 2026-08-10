"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  InstancedMesh,
  type Mesh,
  MeshBasicMaterial,
  Object3D,
  SRGBColorSpace,
  type Texture,
} from "three";
import type { Director } from "@/lib/anim/director";
import { fieldRadius } from "@/lib/field/geometry";

/**
 * Grounding.
 *
 * The sun already casts real shadows, but a shadow map alone leaves figures
 * looking like they hover: the darkest part of a contact shadow is the few
 * inches directly under the feet, and that is exactly the detail a 2048px map
 * stretched over a whole ballpark cannot hold. Two cheap passes fix it - a soft
 * blob under everything that touches the ground, and a band of shade around the
 * edge of the field where the bowl leans in over it.
 */

const MAX_BLOBS = 40;
/** Above the chalk layer, below the bases. */
const BLOB_HEIGHT = 0.13;

/** Soft round falloff, darkest in the middle. */
function blobTexture(): Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(0,0,0,0.6)");
  gradient.addColorStop(0.4, "rgba(0,0,0,0.34)");
  gradient.addColorStop(0.75, "rgba(0,0,0,0.1)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function groundMaterial(texture: Texture, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    // Lies flat on the grass without fighting it for depth.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    toneMapped: false,
  });
}

function writeActorBlobs(mesh: InstancedMesh, director: Director, dummy: Object3D) {
  let i = 0;
  for (const actor of director.actors.values()) {
    if (!actor.visible || i >= MAX_BLOBS) continue;
    dummy.position.set(actor.position.x, actor.position.y + BLOB_HEIGHT, actor.position.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(4.4, 4.4, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    i++;
  }
  dummy.scale.set(0, 0, 0);
  dummy.updateMatrix();
  for (let j = i; j < MAX_BLOBS; j++) mesh.setMatrixAt(j, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.visible = i > 0;
}

function writeBallBlob(blob: Mesh | null, material: MeshBasicMaterial, director: Director) {
  if (!blob) return;
  const ball = director.ball;
  const height = Math.max(0, ball.position.y);
  const strength = ball.visible ? Math.max(0, 1 - height / 130) : 0;
  blob.visible = strength > 0.03;
  if (!blob.visible) return;
  blob.position.set(ball.position.x, BLOB_HEIGHT, ball.position.z);
  const radius = 1.4 + height * 0.05;
  blob.scale.set(radius, radius, 1);
  material.opacity = strength * 0.85;
}

/**
 * Contact shadows: one instanced blob per actor, plus one for the ball that
 * spreads and fades with height. A ball high in the air throwing a big faint
 * shadow is the cue that tells you how deep a fly ball really is.
 */
export function ContactShadows({ director }: { director: Director }) {
  const ballRef = useRef<Mesh>(null);

  const { mesh, ballMaterial, dummy, texture } = useMemo(() => {
    const map = blobTexture();
    const instanced = new InstancedMesh(new CircleGeometry(1, 20), groundMaterial(map, 1), MAX_BLOBS);
    instanced.frustumCulled = false;
    instanced.renderOrder = 1;
    return {
      mesh: instanced,
      ballMaterial: groundMaterial(map, 1),
      dummy: new Object3D(),
      texture: map,
    };
  }, []);

  useEffect(() => {
    return () => {
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.geometry.dispose();
      mesh.dispose();
      ballMaterial.dispose();
      texture.dispose();
    };
  }, [mesh, ballMaterial, texture]);

  useFrame(() => {
    writeActorBlobs(mesh, director, dummy);
    writeBallBlob(ballRef.current, ballMaterial, director);
  });

  return (
    <>
      <primitive object={mesh} />
      <mesh ref={ballRef} material={ballMaterial} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[1, 16]} />
      </mesh>
    </>
  );
}

/**
 * A band of shade following the edge of the playing surface. Not real ambient
 * occlusion - it is one transparent ring with a vertex-colour ramp - but it
 * does the same job of stopping the grass from meeting the stands at a hard,
 * evenly-lit seam. It follows `fieldRadius`, so it tightens down the foul lines
 * exactly where the seating does.
 */
export function GroundOcclusion() {
  const { geometry, material } = useMemo(() => {
    const steps = 200;
    // Radial resolution of the falloff. Two rings would give a linear ramp,
    // which spreads the shade evenly over the whole band; a curve keeps the
    // field clean and puts the dark part hard against the wall.
    const rings = 6;
    const overhang = 14;

    const count = (steps + 1) * rings;
    const positions = new Float32Array(count * 3);
    // Four components: three.js reads the fourth as vertex alpha, which is the
    // only way to ramp a transparent material from nothing to full shade.
    const colors = new Float32Array(count * 4);
    const indices: number[] = [];

    for (let i = 0; i <= steps; i++) {
      const theta = -Math.PI + (i / steps) * Math.PI * 2;
      const edge = fieldRadius(theta);
      // Behind the plate the boundary is 60ft away, in centre field it is 400.
      // A fixed reach would swallow the infield at one end of that range.
      const inner = Math.max(6, edge - Math.min(46, edge * 0.32));
      const outer = edge + overhang;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);

      for (let ring = 0; ring < rings; ring++) {
        const t = ring / (rings - 1);
        const r = inner + (outer - inner) * t;
        const o = (i * rings + ring) * 3;
        positions[o] = sin * r;
        positions[o + 1] = 0;
        positions[o + 2] = -cos * r;
        const c = (i * rings + ring) * 4;
        colors[c] = 1;
        colors[c + 1] = 1;
        colors[c + 2] = 1;
        colors[c + 3] = Math.pow(t, 2.4);
      }

      if (i < steps) {
        for (let ring = 0; ring < rings - 1; ring++) {
          const a = i * rings + ring;
          const b = a + rings;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }

    const strip = new BufferGeometry();
    strip.setAttribute("position", new BufferAttribute(positions, 3));
    strip.setAttribute("color", new BufferAttribute(colors, 4));
    strip.setIndex(indices);

    return {
      geometry: strip,
      material: new MeshBasicMaterial({
        color: "#0d1a0c",
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        vertexColors: true,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
      }),
    };
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return <mesh geometry={geometry} material={material} position={[0, 0.1, 0]} renderOrder={0} />;
}
