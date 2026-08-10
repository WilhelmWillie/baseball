import { ExtrudeGeometry, Shape, type BufferGeometry } from "three";

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
