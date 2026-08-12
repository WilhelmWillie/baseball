import {
  WALL_HEIGHT,
  fieldRadius,
  wallDistance,
} from "./geometry";

/**
 * Everything vertical in the park - wall, seating bowl, crowd, light towers,
 * scoreboard - as a flat list of boxes drawn in a single InstancedMesh.
 *
 * The playing surface itself is not here: it is built from shaped geometry in
 * `surfaces.ts` so the ground reads as a field rather than a grid of cubes.
 */
export interface Block {
  /** Center position in world space. */
  p: [number, number, number];
  /** Full size on each axis. */
  s: [number, number, number];
  /** Hex color. */
  c: string;
  /** Rotation about Y, radians. */
  r?: number;
  /** Lamp faces, drawn separately so they can be switched on after dark. */
  glow?: boolean;
}

/**
 * A toy park rather than a televised one: grass a shade sweeter than real
 * turf, dirt the colour of a sandpit, and cream stonework instead of the grey
 * concrete a real bowl is poured from. It is the same paper/grass/dirt palette
 * the interface uses, mixed for daylight.
 */
export const COLORS = {
  grass: "#5aa851",
  grassStripe: "#4d9848",
  foulGrass: "#4f9a4a",
  dirt: "#c68a53",
  moundDirt: "#cf9660",
  track: "#c09263",
  chalk: "#fbf6ea",
  base: "#fffcf5",
  wall: "#2f6b46",
  wallPad: "#27573a",
  wallCap: "#f0e0c0",
  pole: "#f6d97a",
  concrete: "#f0e3cb",
  concreteDark: "#dfceb0",
  seat: "#4fa07c",
  seatAlt: "#43906e",
  tower: "#e2d5bd",
  lamp: "#fff6c9",
  scoreboard: "#6b503a",
  scoreboardFace: "#43331f",
};

/**
 * What the crowd is wearing. Mostly the home club's colours, because that is
 * what a home crowd looks like, with a visible minority in the visitors' and
 * the rest in neutral street clothes so the bowl does not read as a solid
 * block of one hue.
 */
export interface CrowdPalette {
  home: [string, string];
  away: [string, string];
}

const NEUTRAL_CROWD = ["#f3e7d2", "#e6b183", "#cfd8c3", "#8b6d52", "#b8c7d6", "#f7cfc0"];

/**
 * Picks a shirt. `roll` is the same stable noise the seat placement uses, so
 * the same fan is the same colour every rebuild.
 */
function crowdShirt(roll: number, palette: CrowdPalette): string {
  if (roll < 0.5) return palette.home[0];
  if (roll < 0.66) return palette.home[1];
  if (roll < 0.78) return roll < 0.74 ? palette.away[0] : palette.away[1];
  return NEUTRAL_CROWD[Math.floor(((roll - 0.78) / 0.22) * NEUTRAL_CROWD.length) % NEUTRAL_CROWD.length];
}

/** Deterministic noise so the park looks identical on every render. */
function noise(x: number, z: number, salt = 0): number {
  const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 3.719) * 43758.5453;
  return v - Math.floor(v);
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) * (1 + amount));
  const g = clamp(((n >> 8) & 255) * (1 + amount));
  const b = clamp((n & 255) * (1 + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Yaw for a block sitting at spray angle `theta`. Field depth maps to -Z, so
 * negating theta puts the block's width along the arc and its depth along the
 * radius.
 */
/**
 * A spectator. Not a box any more - `components/scene/Crowd.tsx` draws these
 * as little figures with a head and shoulders, which is why the model carries
 * a skin tone and a phase as well as a shirt.
 *
 * The park is built in feet like everything else, but the *people* in it are
 * drawn to the same cartoon scale the players are: a fan a real five feet tall
 * would be three pixels of colour from a camera in centre field, and three
 * thousand of those read as television static rather than as a crowd.
 */
export interface Fan {
  /** Base of the figure, in world space. */
  p: [number, number, number];
  /** Facing, radians about Y. Everyone looks in at the field. */
  yaw: number;
  shirt: string;
  skin: string;
  hair: string;
  /**
   * Drawn with hair down past the ears rather than a cropped cap. It is the
   * only thing that reads as a woman on a figure this size and this simple -
   * there is no room for a face, and a body is a capsule - and the crowd is
   * split half and half on it.
   */
  longHair: boolean;
  /** Overall size multiplier, so a crowd is not one person repeated. */
  scale: number;
  /** Where in its idle cycle this one starts, 0..1. */
  phase: number;
}

/** Roughly how much of a row one fan takes up, shoulder to shoulder. */
const CROWD_PITCH = 7.4;

/**
 * Height of a seated fan at scale 1, measured from the seat rather than the
 * ground. Matched to the *players*, not to a real seated person: the figures on
 * the field stand about fifteen feet tall here - `zoneHeight` maps a real foot
 * onto 2.59 of them - and a crowd drawn to a plausible seated three-and-a-bit
 * feet of that reads as a different species watching from a scale model. These
 * are people the same size as the ones playing.
 */
export const FAN_HEIGHT = 14.5;

/**
 * Only every nth row is sold. At this size a fan is seven rows tall and the
 * bowl steps up two feet a row, so seating all of them buries everyone behind
 * the first: heads on shoulders on heads with no daylight anywhere. Skipping
 * rows is what buys the rise back, and nothing shows through the gap because the
 * row in front is much taller than the steps behind it.
 *
 * This is the cost of the size, and it is the right trade: a stand of a few
 * hundred people you can see is a crowd, and a stand of four thousand you
 * cannot is a texture.
 */
const ROW_STRIDE = 3;

/**
 * Row blocks are cut deeper than the gap between rows on purpose. Boxes that
 * interpenetrate look solid; boxes whose faces land on exactly the same plane
 * flicker, and a bowl of 3,000 of them flickers everywhere at once.
 */
const ROW_SPACING = 5.2;
const ROW_DEPTH = 5.6;
const FOUL_ROW_SPACING = 3.4;
const FOUL_ROW_DEPTH = 3.8;

function yawAt(theta: number): number {
  return -theta;
}

function outfieldWall(blocks: Block[]) {
  const steps = 150;
  for (let i = 0; i <= steps; i++) {
    const theta = -Math.PI / 4 + (i / steps) * (Math.PI / 2);
    const r = wallDistance(theta);
    const width = ((Math.PI / 2) * r) / steps + 0.8;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;

    blocks.push({
      p: [x, WALL_HEIGHT / 2, z],
      s: [width, WALL_HEIGHT, 2.2],
      c: shade(COLORS.wall, (noise(x, z, 2) - 0.5) * 0.06),
      r: yawAt(theta),
    });
    // Padding seam and the yellow line along the top.
    blocks.push({
      p: [x, WALL_HEIGHT * 0.52, z - Math.cos(theta) * 0.1],
      s: [width, 0.35, 2.5],
      c: COLORS.wallPad,
      r: yawAt(theta),
    });
    blocks.push({
      p: [x, WALL_HEIGHT + 0.28, z],
      s: [width, 0.55, 2.6],
      c: COLORS.wallCap,
      r: yawAt(theta),
    });
  }

  for (const side of [-1, 1]) {
    const theta = (side * Math.PI) / 4;
    const r = wallDistance(theta);
    blocks.push({
      p: [Math.sin(theta) * r, 26, -Math.cos(theta) * r],
      s: [1.4, 52, 1.4],
      c: COLORS.pole,
      r: yawAt(theta),
    });
  }
}

const SKIN_TONES = ["#f2c9a0", "#e0a878", "#c68a5e", "#9a6540", "#6f4526", "#f7ddc0"];
/**
 * Hair, and the odd cap in one of the two clubs' colours. This is doing more
 * work than it looks like it should: a stand full of plain skin-toned spheres
 * reads as beads on a string, and it is the dark tops that turn them into
 * heads.
 */
const HAIR_TONES = ["#2b1d16", "#171313", "#4a2f1d", "#7a4d24", "#c8a35a", "#8e8e93", "#e8e6e1"];

/**
 * Seat a row. `n` is the same stable noise the row itself is shaded from, so a
 * given seat holds the same person on every rebuild; an empty seat here and
 * there is what keeps the bowl from reading as printed wallpaper.
 */
function seatRow(
  fans: Fan[],
  palette: CrowdPalette,
  opts: {
    x: number;
    z: number;
    y: number;
    radius: number;
    slices: number;
    tangentX: number;
    tangentZ: number;
    yaw: number;
    /** Which angular slice of the bowl this row belongs to. */
    slice: number;
    salt: number;
    /** Fraction of seats that go unsold, 0..1. */
    empty: number;
    max: number;
  },
) {
  const { x, z, y, radius, slices, tangentX, tangentZ, yaw, slice, salt, empty, max } = opts;
  // The bowl is sliced by angle, so a row behind the plate spans a couple of
  // feet and one out in the corner spans eight, while a fan is the same five
  // feet wide everywhere. Neither a fixed pitch nor a fixed count works: where
  // the slice is narrower than a person, seat only every nth slice and let the
  // ones between go by; where it is wider, fit two and spread them across it.
  const arc = (Math.PI * 2 * radius) / slices;
  const stride = Math.max(1, Math.round(CROWD_PITCH / arc));
  if (slice % stride !== 0) return;
  const n = noise(x, z, salt);
  if (n < empty) return;
  const seats = Math.max(1, Math.min(max, Math.round(arc / CROWD_PITCH)));
  const pitch = arc / seats;
  for (let s = 0; s < seats; s++) {
    const offset = (s - (seats - 1) / 2) * pitch;
    const roll = noise(x + s * 3.1, z, salt + s);
    const hat = noise(x, z + s * 2.7, salt + 31);
    const longHair = noise(x + s * 1.7, z + s, salt + 47) < 0.5;
    // A club cap goes over cropped hair only - it is the same dome geometry,
    // just painted, and there is nowhere to put it on the long-haired half.
    const capped = !longHair && hat < 0.34;
    fans.push({
      p: [x + tangentX * offset, y, z + tangentZ * offset],
      yaw,
      shirt: crowdShirt(roll, palette),
      skin: SKIN_TONES[Math.floor(roll * 97) % SKIN_TONES.length],
      // The capped ones sprinkle club colour through the bowl at head height as
      // well as at shirt height.
      hair: capped
        ? palette.home[hat < 0.24 ? 0 : 1]
        : HAIR_TONES[Math.floor(hat * 89) % HAIR_TONES.length],
      longHair,
      scale: 0.88 + noise(x, z + s * 5.3, salt + 11) * 0.26,
      phase: noise(x + s, z, salt + 23),
    });
  }
}

/**
 * How much taller the bowl stands behind home plate, 0..1. Flat out in the
 * outfield bleachers, easing up from the foul poles to a peak dead behind the
 * plate - a real park's upper deck is stacked over the infield, not out past
 * the wall.
 */
function backstopRise(theta: number): number {
  const abs = Math.abs(theta);
  const start = Math.PI / 4; // foul poles
  if (abs <= start) return 0;
  const t = (abs - start) / (Math.PI - start);
  return t * t * (3 - 2 * t); // smoothstep
}

/** Extra rows stacked on top of the base bowl height, at full rise. */
const BACKSTOP_EXTRA_ROWS = 10;
/** Extra facade height at the very top of the bowl, at full rise. */
const BACKSTOP_EXTRA_FACADE = 26;

/** A raked seating bowl: many shallow steps rather than a few tall blocks. */
function stands(blocks: Block[], fans: Fan[], palette: CrowdPalette) {
  const slices = 210;
  for (let i = 0; i < slices; i++) {
    const theta = (i / slices) * Math.PI * 2 - Math.PI;
    const base = fieldRadius(theta);
    const yaw = yawAt(theta);
    const tangentX = Math.cos(theta);
    const tangentZ = Math.sin(theta);
    const rise = backstopRise(theta);
    const rows = 16 + Math.round(rise * BACKSTOP_EXTRA_ROWS);

    for (let row = 0; row < rows; row++) {
      const r = base + (Math.abs(theta) < Math.PI / 4 ? 7 : 20) + row * ROW_SPACING;
      const height = 3.4 + row * 2.05;
      const width = ((Math.PI * 2 * r) / slices) * 1.08;
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;

      blocks.push({
        p: [x, height / 2, z],
        s: [width, height, ROW_DEPTH],
        c: shade(row % 2 === 0 ? COLORS.concrete : COLORS.concreteDark, (noise(x, z, row) - 0.5) * 0.05),
        r: yaw,
      });
      blocks.push({
        p: [x, height + 0.3, z],
        s: [width, 0.7, ROW_DEPTH],
        c: row % 3 === 0 ? COLORS.seatAlt : COLORS.seat,
        r: yaw,
      });

      // Spectators sit in discrete seats. How many fit is a function of the
      // arc this slice actually spans - a fixed count crammed into a narrow
      // slice near the plate is what used to make the crowd intersect itself.
      if (row % ROW_STRIDE === 0) {
        seatRow(fans, palette, {
          x,
          z,
          y: height + 0.6,
          radius: r,
          slices,
          tangentX,
          tangentZ,
          yaw,
          slice: i,
          salt: row,
          empty: 0.08,
          max: 2,
        });
      }
    }

    // Facade above the top row, to close off the sky line. Rises with the
    // bowl so it still reads as a cap on the stands rather than a fixed
    // fence floating above a taller top row behind the plate.
    const rTop = base + (Math.abs(theta) < Math.PI / 4 ? 7 : 20) + rows * ROW_SPACING;
    const widthTop = ((Math.PI * 2 * rTop) / slices) * 1.08;
    const facadeHeight = 40 + Math.round(rise * BACKSTOP_EXTRA_FACADE);
    blocks.push({
      p: [Math.sin(theta) * rTop, facadeHeight / 2, -Math.cos(theta) * rTop],
      s: [widthTop, facadeHeight, 3],
      c: shade(COLORS.concreteDark, (noise(theta * 40, 0, 9) - 0.5) * 0.06),
      r: yaw,
    });
  }
}

/**
 * Field-level seating down the lines: a low wall at the edge of the playing
 * surface with a few rows of bleachers stepping up behind it, so the foul
 * corners are populated instead of trailing off into empty grass.
 */
function foulLineSeats(blocks: Block[], fans: Fan[], palette: CrowdPalette) {
  const slices = 150;
  const quarter = Math.PI / 4;

  for (let i = 0; i < slices; i++) {
    const theta = (i / slices) * Math.PI * 2 - Math.PI;
    if (Math.abs(theta) < quarter) continue; // Fair territory has the wall.

    const edge = fieldRadius(theta);
    const yaw = yawAt(theta);
    const tangentX = Math.cos(theta);
    const tangentZ = Math.sin(theta);

    // Low wall right at the boundary, with a padded cap.
    const wallWidth = ((Math.PI * 2 * edge) / slices) * 1.1;
    const wx = Math.sin(theta) * edge;
    const wz = -Math.cos(theta) * edge;
    blocks.push({ p: [wx, 2, wz], s: [wallWidth, 4, 1.6], c: COLORS.wall, r: yaw });
    blocks.push({
      p: [wx, 4.15, wz],
      s: [wallWidth, 0.45, 2],
      c: COLORS.wallCap,
      r: yaw,
    });

    // Four shallow bleacher rows behind it.
    for (let row = 0; row < 4; row++) {
      const r = edge + 3 + row * FOUL_ROW_SPACING;
      const height = 4.4 + row * 1.7;
      const width = ((Math.PI * 2 * r) / slices) * 1.1;
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;

      blocks.push({
        p: [x, height / 2, z],
        s: [width, height, FOUL_ROW_DEPTH],
        c: shade(COLORS.concrete, (noise(x, z, 30 + row) - 0.5) * 0.06),
        r: yaw,
      });
      blocks.push({
        p: [x, height + 0.25, z],
        s: [width, 0.6, FOUL_ROW_DEPTH],
        c: row % 2 === 0 ? COLORS.seat : COLORS.seatAlt,
        r: yaw,
      });

      if (row % ROW_STRIDE === 0) {
        seatRow(fans, palette, {
          x,
          z,
          y: height + 0.5,
          radius: r,
          slices,
          tangentX,
          tangentZ,
          yaw,
          slice: i,
          salt: 40 + row,
          empty: 0.12,
          max: 1,
        });
      }
    }
  }
}

/**
 * Where the light towers stand. Exported so the night lighting rig can hang
 * real lights on the towers you can actually see, rather than approximating
 * them from somewhere else.
 */
export const TOWER_ANGLES = [-74, -40, 40, 74];
export const TOWER_LAMP_HEIGHT = 114;

export function towerPosition(deg: number): [number, number, number] {
  const theta = (deg * Math.PI) / 180;
  const r = fieldRadius(theta) + 96;
  return [Math.sin(theta) * r, TOWER_LAMP_HEIGHT, -Math.cos(theta) * r];
}

function lightTowers(blocks: Block[]) {
  // None near dead center: a tower there sits in the broadcast sight line.
  for (const deg of TOWER_ANGLES) {
    const theta = (deg * Math.PI) / 180;
    const r = fieldRadius(theta) + 96;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;
    const yaw = yawAt(theta);
    const tangentX = Math.cos(theta);
    const tangentZ = Math.sin(theta);

    blocks.push({ p: [x, 56, z], s: [3.4, 112, 3.4], c: COLORS.tower, r: yaw });
    blocks.push({ p: [x, 114, z], s: [30, 8, 3], c: COLORS.tower, r: yaw });
    for (let i = -3; i <= 3; i++) {
      blocks.push({
        p: [x + tangentX * i * 4.4, 114, z + tangentZ * i * 4.4],
        s: [3.4, 5.4, 1.4],
        c: COLORS.lamp,
        r: yaw,
        glow: true,
      });
    }
  }
}

const SKYLINE_COLORS = ["#f2e4cb", "#e7d3b1", "#dde6d1", "#f0d3bb", "#dde3ef"];
/** Every building wears a roof, in one of a handful of friendly colours. */
const ROOF_COLORS = ["#c4614a", "#4f8f7d", "#8a6a4e", "#d09a4c", "#7d8fb5"];
/** Daylight glass, not lit windows - this is an afternoon game. */
const WINDOW_GLASS = "#fff2d4";

/**
 * A town beyond the park. Buildings sit on a wide arc well outside the bowl,
 * with the far ring paler than the near one so the depth reads as haze rather
 * than as a flat wall of boxes.
 */
function skyline(blocks: Block[]) {
  const rings = [
    { radius: 880, count: 42, minHeight: 60, maxHeight: 150, haze: 0.08 },
    { radius: 1120, count: 34, minHeight: 55, maxHeight: 180, haze: 0.24 },
    { radius: 1420, count: 26, minHeight: 45, maxHeight: 140, haze: 0.4 },
  ];

  for (const [ringIndex, ring] of rings.entries()) {
    for (let i = 0; i < ring.count; i++) {
      // Skip the wedge directly behind home plate - nothing looks at it.
      const theta = -Math.PI * 0.78 + (i / (ring.count - 1)) * Math.PI * 1.56;
      const jitter = noise(i * 3.7, ringIndex * 11, 21);
      const r = ring.radius + (jitter - 0.5) * 90;
      const height =
        ring.minHeight + noise(i * 5.1, ringIndex * 7, 22) * (ring.maxHeight - ring.minHeight);
      const width = 46 + noise(i * 2.3, ringIndex * 5, 23) * 62;
      const depth = 44 + noise(i * 6.9, ringIndex * 3, 24) * 44;
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;
      const yaw = yawAt(theta) + (jitter - 0.5) * 0.3;

      const base = SKYLINE_COLORS[Math.floor(jitter * SKYLINE_COLORS.length)];
      // Distant buildings wash out toward the sky.
      const body = shade(base, ring.haze * 0.9 + (noise(x, z, 25) - 0.5) * 0.08);

      blocks.push({ p: [x, height / 2, z], s: [width, height, depth], c: body, r: yaw });

      // A roof, overhanging a little the way a toy house's does.
      const roof = shade(
        ROOF_COLORS[Math.floor(noise(i * 4.3, ringIndex * 9, 26) * ROOF_COLORS.length)],
        ring.haze * 0.7,
      );
      blocks.push({
        p: [x, height + 6, z],
        s: [width + 9, 12, depth + 9],
        c: roof,
        r: yaw,
      });

      // Setback tier and a chimney on the taller ones.
      if (height > 125) {
        blocks.push({
          p: [x, height + 30, z],
          s: [width * 0.55, 36, depth * 0.55],
          c: shade(body, 0.05),
          r: yaw,
        });
        blocks.push({
          p: [x, height + 52, z],
          s: [width * 0.6, 10, depth * 0.6],
          c: roof,
          r: yaw,
        });
      }

      // Bands of glass on the nearest ring only - any more and the skyline
      // starts competing with the game for attention.
      if (ringIndex === 0) {
        const rows = Math.max(2, Math.floor(height / 34));
        for (let cy = 0; cy < rows; cy++) {
          if (noise(i * 9.1, cy * 2.7, ringIndex) < 0.45) continue;
          blocks.push({
            p: [x, 22 + (cy / (rows - 1 || 1)) * (height - 40), z],
            s: [width * 0.82, 7, depth + 1.5],
            c: shade(WINDOW_GLASS, -ring.haze * 0.5),
            r: yaw,
          });
        }
      }
    }
  }
}

/**
 * A wooden scoreboard standing over the batter's eye, high enough to clear the
 * facade behind it. The digits are decorative - the real count is on the HUD -
 * but a park without a board out there does not look like a park.
 */
function scoreboard(blocks: Block[]) {
  const z = -(fieldRadius(0) + 74);
  const width = 150;
  const height = 44;
  const base = 52;

  for (const dx of [-56, 56]) {
    blocks.push({ p: [dx, base / 2, z], s: [7, base, 7], c: COLORS.scoreboard });
  }
  blocks.push({ p: [0, base + height / 2, z], s: [width, height, 5], c: COLORS.scoreboard });
  blocks.push({
    p: [0, base + height / 2, z + 3],
    s: [width - 14, height - 12, 2],
    c: COLORS.scoreboardFace,
  });
  // Two rows of lit digits, one per club.
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 9; i++) {
      blocks.push({
        p: [-width / 2 + 20 + i * 14.5, base + height / 2 + (row === 0 ? 7 : -7), z + 4.6],
        s: [6.5, 8, 1],
        c: row === 0 ? "#f6e7c6" : "#e8d3a6",
      });
    }
  }
  // Shingled roof, overhanging the way the houses beyond it do.
  blocks.push({ p: [0, base + height + 5, z], s: [width + 12, 9, 11], c: "#c4614a" });
}

const LEAF_COLORS = ["#5fa855", "#4e9a4c", "#79b45c", "#3f8f5b", "#8cbb5e"];
const TRUNK_COLOR = "#7a5638";

/**
 * Trees among the houses, tall enough to clear the facade from a seat behind
 * home. Each one is a trunk and three shrinking clumps of leaves, every clump
 * turned a little off the last so no two trees present the same silhouette.
 */
function parkland(blocks: Block[]) {
  const count = 46;
  for (let i = 0; i < count; i++) {
    const theta = -Math.PI * 0.78 + (i / (count - 1)) * Math.PI * 1.56;
    const jitter = noise(i * 8.1, 3, 41);
    const spin = noise(i * 2.9, 7, 42);
    const r = 790 + jitter * 260;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;
    const yaw = yawAt(theta) + (spin - 0.5) * 0.9;
    // Distance haze, same as the buildings behind them.
    const haze = Math.max(0, (r - 860) / 900);
    const leaf = shade(
      LEAF_COLORS[Math.floor(noise(i * 5.7, 11, 43) * LEAF_COLORS.length)],
      haze * 0.5 + (spin - 0.5) * 0.06,
    );
    const scale = 1.05 + jitter * 0.75;

    blocks.push({
      p: [x, 22 * scale, z],
      s: [7 * scale, 44 * scale, 7 * scale],
      c: shade(TRUNK_COLOR, haze * 0.6),
      r: yaw,
    });
    blocks.push({
      p: [x, 58 * scale, z],
      s: [42 * scale, 34 * scale, 42 * scale],
      c: leaf,
      r: yaw,
    });
    blocks.push({
      p: [x, 82 * scale, z],
      s: [30 * scale, 24 * scale, 30 * scale],
      c: shade(leaf, 0.07),
      r: yaw + 0.6,
    });
    blocks.push({
      p: [x, 99 * scale, z],
      s: [17 * scale, 16 * scale, 17 * scale],
      c: shade(leaf, 0.14),
      r: yaw - 0.5,
    });
  }
}

let cached: { key: string; blocks: Block[]; fans: Fan[] } | null = null;

export const DEFAULT_CROWD: CrowdPalette = {
  home: ["#3f6fb5", "#e0c452"],
  away: ["#c1503f", "#dcdcdc"],
};

/**
 * The whole park, cached by crowd palette - it is a few thousand boxes and a
 * couple of thousand people, and only the shirts change from one game to the
 * next. The structure and the crowd come out of one pass because they are laid
 * out against the same rows; splitting them would mean writing the bowl's
 * geometry down twice.
 */
function build(palette: CrowdPalette): { blocks: Block[]; fans: Fan[] } {
  const key = `${palette.home.join()}|${palette.away.join()}`;
  if (cached && cached.key === key) return cached;
  const blocks: Block[] = [];
  const fans: Fan[] = [];
  outfieldWall(blocks);
  foulLineSeats(blocks, fans, palette);
  stands(blocks, fans, palette);
  lightTowers(blocks);
  scoreboard(blocks);
  skyline(blocks);
  parkland(blocks);
  cached = { key, blocks, fans };
  return cached;
}

export function buildPark(palette: CrowdPalette = DEFAULT_CROWD): Block[] {
  return build(palette).blocks;
}

/** Everyone in the seats. See `components/scene/Crowd.tsx` for the drawing. */
export function buildCrowd(palette: CrowdPalette = DEFAULT_CROWD): Fan[] {
  return build(palette).fans;
}
