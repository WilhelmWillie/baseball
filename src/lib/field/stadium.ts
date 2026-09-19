import { fieldRadius, wallDistance } from "./geometry";

export const FOUL_ANGLE = Math.PI / 4;
export const FULL_ARC: [number, number] = [-Math.PI, Math.PI];
export const INFIELD_ARCS: [number, number][] = [[-Math.PI, -FOUL_ANGLE], [FOUL_ANGLE, Math.PI]];
export const DUGOUT_ARCS: [number, number][] = [[-1.55, -1.17], [1.17, 1.55]];
export const AISLES = Array.from({ length: 24 }, (_, i) => -Math.PI + i * Math.PI / 12);
export const SEAT_PITCH = 8.6;
/** How wide one chair is. `park.ts` builds the seats themselves to it. */
export const SEAT_WIDTH = 5.7;

export type Profile = (theta: number) => number;
export interface Terrace {
  id: string;
  row: number;
  deck: "field" | "lower" | "upper" | "bleacher";
  arcs: [number, number][];
  radius: Profile;
  height: number;
  depth: number;
}

/** Keep the left foul-pole join continuous despite the asymmetric outfield. */
export function stadiumEdge(theta: number): number {
  const extra = theta < -FOUL_ANGLE
    ? (wallDistance(-FOUL_ANGLE) - wallDistance(FOUL_ANGLE)) * Math.exp(-8 * (-theta - FOUL_ANGLE))
    : 0;
  return fieldRadius(theta) + extra;
}

// The same setback all around avoids a kink at either foul pole and leaves
// room for the field boxes between the padded wall and the lower bowl.
export const lowerRadius: Profile = (theta) => stadiumEdge(theta) + 20;
export const upperRadius: Profile = (theta) => stadiumEdge(theta) + 95;
export const outerRadius: Profile = (theta) => stadiumEdge(theta) + 151;
export const roofHeight = 86;

export const TERRACES: Terrace[] = [
  ...Array.from({ length: 4 }, (_, row): Terrace => ({
    id: `field-${row}`, row, deck: "field", arcs: INFIELD_ARCS,
    radius: (theta) => stadiumEdge(theta) + 3 + row * 3.4,
    height: 4.4 + row * 1.7, depth: 3.4,
  })),
  ...Array.from({ length: 12 }, (_, row): Terrace => ({
    id: `lower-${row}`, row, deck: "lower", arcs: [FULL_ARC],
    radius: (theta) => lowerRadius(theta) + row * 5.2,
    height: 3.4 + row * 2.05, depth: 5.2,
  })),
  ...Array.from({ length: 4 }, (_, row): Terrace => ({
    id: `bleacher-${row}`, row: row + 12, deck: "bleacher", arcs: [[-FOUL_ANGLE, FOUL_ANGLE]],
    radius: (theta) => lowerRadius(theta) + (row + 12) * 5.2,
    height: 3.4 + (row + 12) * 2.05, depth: 5.2,
  })),
  ...Array.from({ length: 9 }, (_, row): Terrace => ({
    id: `upper-${row}`, row, deck: "upper", arcs: INFIELD_ARCS,
    radius: (theta) => upperRadius(theta) + row * 5.6,
    height: 44 + row * 2.6, depth: 5.6,
  })),
];

/**
 * The dugouts, in radial offsets from the field outline and in feet off the
 * grass. They fill the whole footprint of the field boxes, whose four rows are
 * dropped across these arcs, and they are a closed box rather than a roof on
 * legs: floor, back, ends and roof, so no camera ever finds a way in under one.
 *
 * `ceiling` is set by the figures rather than by the deck. A fan is a shade
 * under fifteen feet tall here, so a roof flush with the back of the deck would
 * come to a player's waist; this one lands just under the seat backs on the row
 * behind, which is where a real dugout roof sits and which keeps the bowl's
 * silhouette unbroken across the gap.
 */
export const DUGOUT = {
  /** Behind the wall coping, which reaches 1.9. */
  front: 1.9,
  /** The back of the field boxes: row 3's tread ends here. */
  back: 14.9,
  /** How proud of the grass the floor slab sits. */
  floor: 1.6,
  /** Underside of the roof, and the top of the opening onto the field. */
  soffit: 11.2,
  /** Top of the roof, a touch below the seat backs on the row behind. */
  ceiling: 12.9,
  /** Flush with the front face of the padded wall. */
  lip: -0.9,
  /** How thick the end walls are, in radians of the arc they close. */
  end: 0.012,
};

/**
 * Whether an angle falls in a dugout. `margin` widens the arcs by that many
 * radians at either end, which is how a *seat* asks the question: a chair is
 * placed by its centre but is nearly six feet wide, and one whose centre clears
 * the dugout by a hair still has half of itself buried in the end wall.
 */
export function onDugout(theta: number, margin = 0): boolean {
  return DUGOUT_ARCS.some(([a, b]) => theta > a - margin && theta < b + margin);
}

/** Unit tangent of the actual outline, rather than of an imaginary circle. */
export function terraceTangent(radius: Profile, theta: number): [number, number] {
  const d = 0.0001;
  const a = theta - d;
  const b = theta + d;
  const x = Math.sin(b) * radius(b) - Math.sin(a) * radius(a);
  const z = -Math.cos(b) * radius(b) + Math.cos(a) * radius(a);
  const length = Math.hypot(x, z);
  return [x / length, z / length];
}

/** Aisles keep the same angle through both decks and widen toward the back. */
export function aisleHalfWidth(theta: number): number {
  const d = 0.001;
  const speed = Math.hypot(
    Math.sin(theta + d) * lowerRadius(theta + d) - Math.sin(theta - d) * lowerRadius(theta - d),
    -Math.cos(theta + d) * lowerRadius(theta + d) + Math.cos(theta - d) * lowerRadius(theta - d),
  ) / (2 * d);
  return 4 / speed;
}

export function inAisle(theta: number): boolean {
  return AISLES.some((a) => {
    const distance = Math.abs(Math.atan2(Math.sin(theta - a), Math.cos(theta - a)));
    return distance < aisleHalfWidth(a) + 0.012;
  });
}

/** Arc-length spacing keeps seats separated even along the long foul lines. */
export function terraceSeats(terrace: Terrace): { theta: number; x: number; z: number; yaw: number }[] {
  const seats = [];
  for (const [from, to] of terrace.arcs) {
    const steps = Math.ceil((to - from) * 180);
    let walked = 0;
    let next = SEAT_PITCH / 2;
    let lastX = Math.sin(from) * terrace.radius(from);
    let lastZ = -Math.cos(from) * terrace.radius(from);
    for (let i = 1; i <= steps; i++) {
      const theta = from + (i / steps) * (to - from);
      const x = Math.sin(theta) * terrace.radius(theta);
      const z = -Math.cos(theta) * terrace.radius(theta);
      const length = Math.hypot(x - lastX, z - lastZ);
      while (next <= walked + length) {
        const fraction = (next - walked) / length;
        const at = theta - (1 - fraction) * (to - from) / steps;
        const [tx, tz] = terraceTangent(terrace.radius, at);
        const clearance = SEAT_WIDTH / 2 / terrace.radius(at);
        if (!inAisle(at) && !(terrace.deck === "field" && onDugout(at, clearance))) {
          seats.push({ theta: at, x: lastX + (x - lastX) * fraction, z: lastZ + (z - lastZ) * fraction, yaw: Math.atan2(-tz, tx) });
        }
        next += SEAT_PITCH;
      }
      walked += length;
      lastX = x;
      lastZ = z;
    }
  }
  return seats;
}
