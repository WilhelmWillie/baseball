"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, Color, Float32BufferAttribute, MeshLambertMaterial } from "three";
import {
  AISLES, DUGOUT, DUGOUT_ARCS, FOUL_ANGLE, INFIELD_ARCS, TERRACES,
  aisleHalfWidth, lowerRadius, outerRadius, roofHeight, stadiumEdge, upperRadius,
  type Profile,
} from "@/lib/field/stadium";
import { WALL_HEIGHT } from "@/lib/field/geometry";
import { COLORS } from "@/lib/field/park";
import { paintedPark } from "@/lib/field/paint";

/** Sweep a cross-section along the actual field outline, with smooth side normals. */
class StadiumBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  sweep(radius: Profile, profile: [number, number][], arc: [number, number], color: string) {
    const tint = new Color(color);
    const [from, to] = arc;
    if (to <= from) return;
    const segments = Math.max(2, Math.ceil((to - from) * 100));
    for (let edge = 0; edge < profile.length; edge++) {
      const a = profile[edge];
      const b = profile[(edge + 1) % profile.length];
      const dr = b[0] - a[0];
      const dy = b[1] - a[1];
      const start = this.positions.length / 3;
      for (let i = 0; i <= segments; i++) {
        const theta = from + i / segments * (to - from);
        const sin = Math.sin(theta);
        const cos = Math.cos(theta);
        const r = radius(theta);
        const derivative = (radius(theta + 0.0001) - radius(theta - 0.0001)) / 0.0002;
        for (const [offset, height] of [a, b]) {
          this.positions.push(sin * (r + offset), height, -cos * (r + offset));
          // Surface tangent crossed with the cross-section edge. Separate
          // strips preserve crisp tread edges while the curved walls stay smooth.
          const tx = cos * (r + offset) + sin * derivative;
          const tz = sin * (r + offset) - cos * derivative;
          const nx = -tz * dy;
          const ny = (tz * sin + tx * cos) * dr;
          const nz = tx * dy;
          const length = Math.hypot(nx, ny, nz) || 1;
          this.normals.push(nx / length, ny / length, nz / length);
          this.colors.push(tint.r, tint.g, tint.b);
        }
        if (i < segments) {
          const n = start + i * 2;
          this.indices.push(n, n + 2, n + 3, n, n + 3, n + 1);
        }
      }
    }
    // Close exposed ends of partial arcs. These profiles are convex.
    if (to - from < Math.PI * 2 - 0.001) {
      for (const [theta, sign] of [[from, -1], [to, 1]]) {
        const start = this.positions.length / 3;
        const sin = Math.sin(theta);
        const cos = Math.cos(theta);
        for (const [offset, height] of profile) {
          this.positions.push(sin * (radius(theta) + offset), height, -cos * (radius(theta) + offset));
          this.normals.push(cos * sign, 0, sin * sign);
          this.colors.push(tint.r, tint.g, tint.b);
        }
        for (let j = 1; j < profile.length - 1; j++) {
          this.indices.push(start, start + (sign > 0 ? j + 1 : j), start + (sign > 0 ? j : j + 1));
        }
      }
    }
  }

  band(radius: Profile, inner: number, outer: number, bottom: number, top: number, arc: [number, number], color: string) {
    this.sweep(radius, [[inner, bottom], [inner, top], [outer, top], [outer, bottom]], arc, color);
  }

  geometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Remove dugout spans from the field-level seats, leaving their roofs clear. */
function fieldArcs(arc: [number, number]): [number, number][] {
  let parts = [arc];
  for (const [cutA, cutB] of DUGOUT_ARCS) {
    parts = parts.flatMap(([a, b]): [number, number][] => {
      if (cutB <= a || cutA >= b) return [[a, b]];
      return [[a, Math.max(a, cutA)], [Math.min(b, cutB), b]].filter(([x, y]) => y > x) as [number, number][];
    });
  }
  return parts;
}

function buildStadium(): BufferGeometry {
  const mesh = new StadiumBuilder();
  const concrete = "#d6cebc";
  const rail = "#526965";
  const fascia = "#214f47";

  for (const terrace of TERRACES) {
    for (const arc of terrace.arcs.flatMap((a) => terrace.deck === "field" ? fieldArcs(a) : [a])) {
      // Only the tread and riser are exposed. Adjacent rows share their boundary.
      mesh.band(terrace.radius, -terrace.depth / 2, terrace.depth / 2,
        terrace.height - (terrace.deck === "upper" ? 2.6 : 2.05), terrace.height, arc, concrete);
      // The stair lanes follow exactly the same treads and stay clear of fans.
      for (const theta of AISLES) {
        const half = aisleHalfWidth(theta);
        const lane: [number, number] = [Math.max(arc[0], theta - half), Math.min(arc[1], theta + half)];
        mesh.band(terrace.radius, -terrace.depth / 2, terrace.depth / 2,
          terrace.height + 0.015, terrace.height + 0.05, lane, "#eee6d4");
        // A narrow safety nosing gives the stairs a believable rhythm.
        mesh.band(terrace.radius, -terrace.depth / 2, -terrace.depth / 2 + 0.35,
          terrace.height + 0.05, terrace.height + 0.1, lane, "#ddbf74");
      }
    }
  }

  // A continuous padded field wall and rounded coping, with no overlapping cubes.
  for (const arc of INFIELD_ARCS) {
    mesh.band(stadiumEdge, -0.6, 1.6, 0, 4.3, arc, COLORS.wall);
    mesh.sweep(stadiumEdge, [[-0.9, 4.1], [-0.8, 4.55], [-0.5, 4.75], [1.6, 4.75], [1.9, 4.5], [1.9, 4.1]], arc, "#ddcfae");
  }
  mesh.band(stadiumEdge, -0.65, 1.6, 0, WALL_HEIGHT, [-FOUL_ANGLE, FOUL_ANGLE], COLORS.wall);
  mesh.sweep(stadiumEdge, [[-0.9, WALL_HEIGHT - 0.15], [-0.9, WALL_HEIGHT + 0.2], [-0.6, WALL_HEIGHT + 0.45], [1.7, WALL_HEIGHT + 0.45], [2, WALL_HEIGHT + 0.2], [2, WALL_HEIGHT - 0.15]], [-FOUL_ANGLE, FOUL_ANGLE], "#e9c66a");

  // Open concourse, an overhanging upper deck and its dark ribbon fascia.
  for (const arc of INFIELD_ARCS) {
    mesh.band(lowerRadius, 60, 76, 25, 27, arc, "#d7d2c3");
    mesh.band(upperRadius, -4, 50, 38, 40, arc, concrete);
    mesh.band(upperRadius, -4.5, -2.8, 38, 44.5, arc, fascia);
    mesh.band(upperRadius, -4.7, -2.6, 38, 38.65, arc, "#d2b879");
    mesh.band(outerRadius, -2, 1, 0, 78, arc, "#bda78c");
    mesh.band(outerRadius, -3, 2, 76, 79, arc, "#e3dbc8");
    // Glazed concourse bands and floor ledges on the outside of the stadium.
    for (const y of [20, 49]) {
      mesh.band(outerRadius, 1.15, 1.55, y, y + 12, arc, "#59766f");
      mesh.band(outerRadius, 1, 3, y - 1.5, y, arc, "#e3dbc8");
    }
    // Shallow cantilever roof: a single sweeping shell, set above the top row.
    mesh.sweep(outerRadius, [[-48, roofHeight - 2], [-48, roofHeight], [5, roofHeight + 5], [5, roofHeight + 2]], arc, "#ede7d8");
    mesh.band(outerRadius, -48.4, -47.6, roofHeight - 2.5, roofHeight, arc, fascia);
    // Two slender horizontal rails at the upper-deck front.
    for (const y of [46.2, 48.3]) {
      mesh.band(upperRadius, -3.7, -3.25, y, y + 0.42, arc, rail);
    }
  }
  // Low open bleachers beyond the outfield, keeping the skyline and board visible.
  mesh.band(lowerRadius, 81, 84, 0, 39, [-FOUL_ANGLE, FOUL_ANGLE], "#bda78c");
  mesh.band(lowerRadius, 80, 85, 38, 40, [-FOUL_ANGLE, FOUL_ANGLE], "#e3dbc8");

  // The dugouts, cut into the field boxes rather than stood on top of them.
  // The four seat rows are already missing across these arcs; this fills the
  // hole they leave with a closed recess, so there is no angle that sees under
  // a floating roof or through an open end into the grass behind.
  const { front, back, floor, wall, bench, benchDepth, soffit, ceiling, lip, end } = DUGOUT;
  for (const arc of DUGOUT_ARCS) {
    // Floor, back wall and bench. The inside is far darker than the trim
    // around it: in the roof's own green the whole thing reads as a slab hung
    // on the bowl rather than as the hole in it that a dugout is.
    mesh.band(stadiumEdge, front, back, 0, floor, arc, "#9c937f");
    mesh.band(stadiumEdge, back - wall, back, floor, soffit, arc, "#10302c");
    // Solid from the floor up rather than a plank on legs: there is no light
    // in here to model a shadow under it with, and a floating board is the one
    // thing a camera low enough to see beneath the roof would catch.
    mesh.band(stadiumEdge, back - wall - benchDepth, back - wall, floor, bench, arc, "#b88a5c");
    // The roof, and a pale nosing along its front edge. The nosing stands a
    // little proud of the fascia rather than sharing its plane with it, which
    // leaves the fascia clear for the sign that names the dugout.
    mesh.band(stadiumEdge, lip, back, soffit, ceiling, arc, fascia);
    mesh.band(stadiumEdge, lip - 0.3, lip, ceiling - 0.5, ceiling + 0.1, arc, "#e4d7b8");
    // Both ends close *inside* the arc. Reaching past it would drive a slab
    // through the seat rows next door and leave them z-fighting through it.
    for (const [edge, into] of [[arc[0], 1], [arc[1], -1]] as const) {
      const other = edge + into * end;
      mesh.band(stadiumEdge, front, back, 0, ceiling,
        [Math.min(edge, other), Math.max(edge, other)], "#14352f");
    }
  }
  return mesh.geometry();
}

export function Stadium() {
  const { geometry, material } = useMemo(() => {
    const material = new MeshLambertMaterial({ vertexColors: true });
    paintedPark(material);
    return { geometry: buildStadium(), material };
  }, []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <mesh geometry={geometry} material={material} />;
}
