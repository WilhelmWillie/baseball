import { LatheGeometry, Vector2, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Smooth analytic corner normals keep highlights continuous across the shell. */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius = 0.15,
  segments = 4,
): BufferGeometry {
  return new RoundedBoxGeometry(width, height, depth, segments, radius);
}

/** A rounded box lying flat, useful for visors, plates and brims. */
export function panel(width: number, height: number, depth: number): BufferGeometry {
  return roundedBox(width, height, depth, Math.min(width, height, depth) * 0.35, 3);
}

/**
 * An egg: one smooth surface of revolution, a unit across and a unit tall,
 * widest above its middle and tapering to a point at either end.
 *
 * This exists because an alien's head cannot be assembled. Two spheres - a
 * cranium and a jaw - give you a seam across the face exactly where a second
 * mouth would be, and no amount of matching the colours hides it, because the
 * silhouette kinks there too. A lathe has no seam to hide: `bulge` is how far
 * the widest point rides above the equator, which is the whole difference
 * between a head and a ball.
 */
export function egg(bulge = 0.22, rings = 32, radial = 40): BufferGeometry {
  const points: Vector2[] = [];
  for (let i = 0; i <= rings; i++) {
    // Bottom to top, which is the winding LatheGeometry expects.
    const theta = Math.PI * (1 - i / rings);
    const radius = Math.sin(theta) * (1 + bulge * Math.cos(theta));
    points.push(new Vector2(Math.max(0.0001, radius) * 0.5, Math.cos(theta) * 0.5));
  }
  // LatheGeometry provides smooth profile normals, including the closing seam.
  return new LatheGeometry(points, radial, Math.PI);
}
