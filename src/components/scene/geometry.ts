import { ExtrudeGeometry, LatheGeometry, Shape, Vector2, type BufferGeometry } from "three";

/**
 * Geometry helpers for the character models.
 *
 * three.js has no rounded box in core, and hard-edged boxes are what make a
 * low-poly figure read as "programmer art". Chamfering the big panels costs a
 * handful of triangles and does most of the work of making these look built
 * rather than assembled from primitives.
 */

function roundedRect(width: number, height: number, radius: number): Shape {
  const x = width / 2;
  const y = height / 2;
  const r = Math.max(0.001, Math.min(radius, x, y));
  const shape = new Shape();
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  return shape;
}

/**
 * A box with every edge chamfered. `radius` is the bevel on all three axes, so
 * the finished size is exactly width x height x depth.
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius = 0.15,
  segments = 2,
): BufferGeometry {
  const r = Math.max(0.001, Math.min(radius, width / 2.05, height / 2.05, depth / 2.05));
  const shape = roundedRect(width - r * 2, height - r * 2, r);
  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - r * 2,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelOffset: 0,
    bevelSegments: segments,
    curveSegments: segments,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/** A rounded box lying flat, useful for visors, plates and brims. */
export function panel(width: number, height: number, depth: number): BufferGeometry {
  return roundedBox(width, height, depth, Math.min(width, height, depth) * 0.35, 2);
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
export function egg(bulge = 0.22, rings = 22, radial = 26): BufferGeometry {
  const points: Vector2[] = [];
  for (let i = 0; i <= rings; i++) {
    // Bottom to top, which is the winding LatheGeometry expects.
    const theta = Math.PI * (1 - i / rings);
    const radius = Math.sin(theta) * (1 + bulge * Math.cos(theta));
    points.push(new Vector2(Math.max(0.0001, radius) * 0.5, Math.cos(theta) * 0.5));
  }
  // Start the revolution at the back of the head. A lathe leaves a crease
  // where it closes - the vertices there are duplicated, so the normals either
  // side of it never average - and the default start puts that crease straight
  // down the middle of the face.
  const geometry = new LatheGeometry(points, radial, Math.PI);
  geometry.computeVertexNormals();
  return geometry;
}
