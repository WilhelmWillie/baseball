"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, MeshBasicMaterial, SRGBColorSpace } from "three";
import { DUGOUT, stadiumEdge, type Profile } from "@/lib/field/stadium";

interface Sign {
  theta: number;
  radius: Profile;
  y: number;
  width: number;
  height: number;
  text: string;
}

/** One cell of the atlas, and how much of it the quad is allowed to sample. */
const CELL_W = 1024;
const CELL_H = 128;
const INSET = 6;

/** One atlas and one draw for the pair of dugout signs. */
export function StadiumSigns() {
  const { geometry, material, texture } = useMemo(() => {
    // Sat on the dugout fascia, a shade proud of it so the two never z-fight.
    const face = DUGOUT.lip - 0.15;
    const y = DUGOUT.soffit + 0.6;
    const signs: Sign[] = [-1, 1].map((side) => ({
      theta: side * 1.36,
      radius: (t) => stadiumEdge(t) + face,
      y,
      width: 24,
      height: 1.05,
      text: side < 0 ? "VISITORS" : "HOME",
    }));

    // One sign per row, and no painted backing: the lettering is laid straight
    // onto the fascia. A plate of its own would be lit flat while the wood
    // behind it is shaded, and the two never match at any hour of the day.
    const canvas = document.createElement("canvas");
    canvas.width = CELL_W;
    canvas.height = CELL_H * signs.length;
    const ctx = canvas.getContext("2d")!;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const [i, sign] of signs.entries()) {
      const cy = i * CELL_H;
      ctx.fillStyle = "#fff1d3";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${CELL_H * 0.55}px sans-serif`;
      ctx.fillText(sign.text, CELL_W / 2, cy + CELL_H / 2, CELL_W * 0.8);
      const start = positions.length / 3;
      const steps = 16;
      const d = 0.001;
      const speed = Math.hypot(
        Math.sin(sign.theta + d) * sign.radius(sign.theta + d) - Math.sin(sign.theta - d) * sign.radius(sign.theta - d),
        -Math.cos(sign.theta + d) * sign.radius(sign.theta + d) + Math.cos(sign.theta - d) * sign.radius(sign.theta - d),
      ) / (2 * d);
      for (let j = 0; j <= steps; j++) {
        const u = j / steps;
        const at = sign.theta + (u - 0.5) * sign.width / speed;
        const px = Math.sin(at) * sign.radius(at);
        const pz = -Math.cos(at) * sign.radius(at);
        for (const v of [0, 1]) {
          positions.push(px, sign.y + (v - 0.5) * sign.height, pz);
          uvs.push((u * (CELL_W - INSET * 2) + INSET) / canvas.width,
            1 - (cy + (1 - v) * (CELL_H - INSET * 2) + INSET) / canvas.height);
        }
        if (j < steps) {
          const n = start + j * 2;
          indices.push(n, n + 2, n + 3, n, n + 3, n + 1);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new MeshBasicMaterial({
      map: texture, transparent: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    return { geometry, material, texture };
  }, []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); texture.dispose(); }, [geometry, material, texture]);
  return <mesh geometry={geometry} material={material} />;
}
