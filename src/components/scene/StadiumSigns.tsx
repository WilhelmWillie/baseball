"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, MeshBasicMaterial, SRGBColorSpace } from "three";
import { AISLES, FOUL_ANGLE, stadiumEdge, upperRadius, type Profile } from "@/lib/field/stadium";

interface Sign {
  theta: number;
  radius: Profile;
  y: number;
  width: number;
  height: number;
  text: string;
  background?: string;
}

/** One atlas and one draw for the deck ribbon, section and dugout signs. */
export function StadiumSigns() {
  const { geometry, material, texture } = useMemo(() => {
    const signs: Sign[] = [];
    for (const [i, theta] of AISLES.entries()) {
      if (Math.abs(theta) < FOUL_ANGLE + 0.1) continue;
      signs.push({ theta, radius: (t) => upperRadius(t) - 4.6, y: 41.3, width: 15, height: 4, text: `${201 + i}` });
      const middle = theta + Math.PI / 24;
      if (Math.abs(middle) > FOUL_ANGLE && middle < Math.PI) {
        signs.push({ theta: middle, radius: (t) => upperRadius(t) - 4.6, y: 41.3, width: 28, height: 3.7, text: i % 3 ? "POCKET BALLPARK" : "THE BIG LEAGUES", background: "#244c48" });
      }
    }
    for (const side of [-1, 1]) {
      signs.push({ theta: side * 1.36, radius: (t) => stadiumEdge(t) + 1.9, y: 12.5, width: 20, height: 2, text: side < 0 ? "VISITORS" : "HOME" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d")!;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const [i, sign] of signs.entries()) {
      const cx = (i % 8) * 256;
      const cy = Math.floor(i / 8) * 128;
      ctx.fillStyle = sign.background ?? "#214f47";
      ctx.fillRect(cx, cy, 256, 128);
      ctx.fillStyle = "#fff1d3";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${sign.text.length > 8 ? 24 : 64}px sans-serif`;
      ctx.fillText(sign.text, cx + 128, cy + 65, 236);
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
          uvs.push((cx + u * 252 + 2) / canvas.width, 1 - (cy + (1 - v) * 124 + 2) / canvas.height);
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
    const material = new MeshBasicMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    return { geometry, material, texture };
  }, []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); texture.dispose(); }, [geometry, material, texture]);
  return <mesh geometry={geometry} material={material} />;
}
