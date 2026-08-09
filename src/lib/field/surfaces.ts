import { Path, Shape, Vector2 } from "three";
import {
  HALF_DIAG,
  INFIELD_ARC_RADIUS,
  MOUND_DEPTH,
  WARNING_TRACK,
  fieldRadius,
  wallDistance,
} from "./geometry";

/**
 * The playing surface as a handful of flat shapes rather than a grid of blocks.
 *
 * Shapes are authored in field space - x is lateral (positive toward right
 * field), y is depth (positive toward center) - and the meshes that use them
 * are rotated -90 degrees about X, which maps shape (x, y) onto world
 * (x, 0, -y). That is exactly the convention in `geometry.ts`.
 */

function boundaryPoint(theta: number, inset = 0): Vector2 {
  const r = Math.max(4, fieldRadius(theta) - inset);
  return new Vector2(Math.sin(theta) * r, Math.cos(theta) * r);
}

/** Samples the outer edge of the playing surface, all the way around. */
function boundaryPoints(inset = 0, steps = 220): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i < steps; i++) {
    const theta = -Math.PI + (i / steps) * Math.PI * 2;
    points.push(boundaryPoint(theta, inset));
  }
  return points;
}

/** Whole playing surface, used as the base grass layer. */
export function fieldShape(): Shape {
  return new Shape(boundaryPoints());
}

/** The two wedges of foul ground, drawn a shade darker than fair territory. */
export function foulShapes(): Shape[] {
  const quarter = Math.PI / 4;
  const build = (from: number, to: number): Shape => {
    const points: Vector2[] = [new Vector2(0, 0)];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      points.push(boundaryPoint(from + ((to - from) * i) / steps));
    }
    return new Shape(points);
  };
  return [build(quarter, Math.PI), build(-quarter, -Math.PI)];
}

/** Warning track: a ring just inside the outer edge. */
export function warningTrackShape(): Shape {
  const shape = new Shape(boundaryPoints());
  const hole = new Path(boundaryPoints(WARNING_TRACK));
  shape.holes.push(hole);
  return shape;
}

/**
 * Distance from home, down a foul line, at which the infield arc meets it.
 * The arc is centred on the mound, so this is a circle/line intersection.
 */
function arcMeetsFoulLine(): number {
  // Point on the line is (u, u) in field space; solve |(u, u) - (0, MOUND)| = R.
  const m = MOUND_DEPTH;
  const r = INFIELD_ARC_RADIUS;
  // 2u^2 - 2mu + m^2 - r^2 = 0
  const a = 2;
  const b = -2 * m;
  const c = m * m - r * r;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/**
 * Infield dirt: the arc from foul line to foul line, with the grass diamond
 * punched out of the middle.
 */
export function infieldShape(): Shape {
  const u = arcMeetsFoulLine();
  const edge = new Vector2(u, u);
  // Angle of that corner as seen from the centre of the mound.
  const spread = Math.atan2(edge.x, edge.y - MOUND_DEPTH);

  const points: Vector2[] = [new Vector2(-edge.x, edge.y)];
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const phi = -spread + ((spread * 2) * i) / steps;
    points.push(
      new Vector2(
        Math.sin(phi) * INFIELD_ARC_RADIUS,
        MOUND_DEPTH + Math.cos(phi) * INFIELD_ARC_RADIUS,
      ),
    );
  }
  points.push(new Vector2(0, 0));

  const shape = new Shape(points);

  // The grass diamond, inset from the base paths.
  const inset = HALF_DIAG - 6.5;
  shape.holes.push(
    new Path([
      new Vector2(0, HALF_DIAG - inset),
      new Vector2(inset, HALF_DIAG),
      new Vector2(0, HALF_DIAG + inset),
      new Vector2(-inset, HALF_DIAG),
    ]),
  );

  return shape;
}

/** Dirt circle around home plate. */
export function homeCircleShape(radius = 13): Shape {
  const shape = new Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

/** Where the outfield wall runs, sampled from foul pole to foul pole. */
export function wallPoints(steps = 96): Vector2[] {
  const points: Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = -Math.PI / 4 + (i / steps) * (Math.PI / 2);
    const r = wallDistance(theta);
    points.push(new Vector2(Math.sin(theta) * r, Math.cos(theta) * r));
  }
  return points;
}

export { boundaryPoint, boundaryPoints };
