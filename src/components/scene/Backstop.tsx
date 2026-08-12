"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  type BufferGeometry,
} from "three";

/**
 * The netting behind home plate.
 *
 * Its job is contrast. Everything a camera out in centre field sees behind the
 * hitter is seating bowl - a few thousand small bright things, all of them
 * moving - and a batter and catcher standing against that read as more of the
 * same. A dark scrim hung across the backstop knocks the whole background down
 * a couple of stops and the two figures in front of it separate immediately.
 *
 * It is placed where a real backstop net is rather than where it would be most
 * convenient, so the cameras behind it - the high shot on the pitcher, the
 * umpire's seat, the wide - would be shooting *through* it. They are not: the
 * net is only drawn for a camera standing on the field side of it, which is the
 * same set of cameras a real net hangs in front of.
 */

/** Distance from the plate, and how far up and around it goes. */
const RADIUS = 46;
const BOTTOM = 0;
const TOP = 42;
/**
 * Ninety degrees each way brings the ends level with the plate, which is as far
 * round as it can go before the net starts cutting across fair ground.
 */
const HALF_ARC = Math.PI * 0.5;
/** How much of each end, and of the top, is spent fading out. */
const FADE_ARC = Math.PI * 0.16;
const FADE_TOP = 12;

/**
 * Cameras at a world z greater than this are behind the net, looking at its
 * back, and get no net at all. The plate is at z = 0 and the net curves away
 * from it toward +z, so the test is just "am I in front of it".
 */
const BEHIND_Z = RADIUS * 0.62;

function show(net: Mesh, visible: boolean) {
  if (net.visible !== visible) net.visible = visible;
}

/**
 * Ramp the net out at its ends and along its top edge.
 *
 * Without this the scrim stops dead, and a straight vertical seam with bright
 * crowd on one side and dark crowd on the other is far more conspicuous than
 * the darkening it was hiding. Alpha rides in the fourth component of the
 * vertex colour, which the material multiplies into its own opacity; the RGB is
 * left at white so the tint stays a property of the material.
 */
function fadeEdges(geometry: BufferGeometry) {
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 4);
  const halfHeight = (TOP - BOTTOM) / 2;
  for (let i = 0; i < position.count; i++) {
    const across = Math.abs(Math.atan2(position.getX(i), position.getZ(i)));
    const fromEnd = HALF_ARC - across;
    const fromTop = halfHeight - position.getY(i);
    const alpha = smooth(fromEnd / FADE_ARC) * smooth(fromTop / FADE_TOP);
    colors[i * 4] = 1;
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = alpha;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 4));
}

function smooth(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

export function Backstop() {
  const mesh = useMemo(() => {
    // thetaStart 0 puts the seam on +z in three.js' cylinder, which is the
    // backstop side of the plate, so the arc only has to be centred on it.
    const geometry = new CylinderGeometry(
      RADIUS,
      RADIUS,
      TOP - BOTTOM,
      64,
      12,
      true,
      -HALF_ARC,
      HALF_ARC * 2,
    );
    fadeEdges(geometry);
    const material = new MeshBasicMaterial({
      color: "#16241f",
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      // Netting is a screen, not a wall: it must not stop anything drawn after
      // it, and it should never carve a hole in the depth buffer.
      depthWrite: false,
      toneMapped: false,
      // The fade lives in the alpha of the vertex colours.
      vertexColors: true,
    });
    const net = new Mesh(geometry, material);
    net.position.set(0, (TOP + BOTTOM) / 2, 0);
    net.renderOrder = 2;
    return net;
  }, []);

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    };
  }, [mesh]);

  useFrame((state) => show(mesh, state.camera.position.z < BEHIND_Z));

  return <primitive object={mesh} />;
}
