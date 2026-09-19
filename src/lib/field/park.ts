import { AISLES, INFIELD_ARCS, SEAT_WIDTH, TERRACES, outerRadius, roofHeight, stadiumEdge, terraceSeats, terraceTangent, upperRadius } from "./stadium";
import {
  fieldRadius,
  wallDistance,
} from "./geometry";

/**
 * Instanced seats, stadium fixtures, and village scenery. The continuous bowl
 * surfaces live in Stadium.tsx and share their layout with the spectators.
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
  /** Shared silhouette; hidden structural pieces keep the inexpensive box. */
  shape?: "box" | "round" | "sphere" | "cylinder" | "roof";
}

/**
 * A toy park rather than a televised one: grass a shade sweeter than real
 * turf, dirt the colour of a sandpit, and cream stonework instead of the grey
 * concrete a real bowl is poured from. It is the same paper/grass/dirt palette
 * the interface uses, mixed for daylight.
 */
export const COLORS = {
  grass: "#79b974",
  grassStripe: "#6dab69",
  foulGrass: "#6ca769",
  dirt: "#d6a575",
  moundDirt: "#deae7c",
  track: "#cba97e",
  chalk: "#fbf6ea",
  base: "#fffcf5",
  wall: "#4d887b",
  wallPad: "#397365",
  wallCap: "#f0e0c0",
  pole: "#f6d97a",
  concrete: "#f0e3cb",
  concreteDark: "#d8b99a",
  seat: "#79b7a2",
  seatAlt: "#64a58e",
  tower: "#e2d5bd",
  lamp: "#fff6c9",
  scoreboard: "#214f47",
  scoreboardFace: "#163a33",
  // The plain the town stands on, and the paved streets running through it. A
  // shade duller and greener than the field's own turf so the ground reads as
  // the world beyond the park rather than more outfield.
  townGround: "#5c9a52",
  street: "#cabc9f",
  streetLine: "#e7dcc4",
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

/** Who a fan is pulling for. Drives both the shirt and how they react. */
export type Allegiance = "home" | "away" | "neutral";

/**
 * Which club a fan is rooting for, from the same stable `roll` the shirt is
 * picked from. The thresholds are the shirt's: it is a home crowd (the first
 * two thirds), a visible away minority, and the rest in street clothes with no
 * dog in the fight. `crowdShirt` reads off this so a fan's colours and their
 * reaction never disagree - a home jersey that groans at a home run would give
 * the whole thing away.
 */
function allegianceFor(roll: number): Allegiance {
  if (roll < 0.66) return "home";
  if (roll < 0.78) return "away";
  return "neutral";
}

/**
 * Picks a shirt. `roll` is the same stable noise the seat placement uses, so
 * the same fan is the same colour every rebuild.
 */
function crowdShirt(roll: number, palette: CrowdPalette): string {
  switch (allegianceFor(roll)) {
    case "home":
      return roll < 0.5 ? palette.home[0] : palette.home[1];
    case "away":
      return roll < 0.74 ? palette.away[0] : palette.away[1];
    default:
      return NEUTRAL_CROWD[
        Math.floor(((roll - 0.78) / 0.22) * NEUTRAL_CROWD.length) % NEUTRAL_CROWD.length
      ];
  }
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
   * Which club they are pulling for. The stands are drawn as a home crowd, but
   * the visitors have a corner too - this is what lets the two halves react in
   * opposite directions to the same play. See `components/scene/Crowd.tsx`.
   */
  allegiance: Allegiance;
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


/**
 * Height of a seated fan at scale 1, measured from the seat rather than the
 * ground. Matched to the *players*, not to a real seated person: the figures on
 * the field stand about fifteen feet tall here - `zoneHeight` maps a real foot
 * onto 2.59 of them - and a crowd drawn to a plausible seated three-and-a-bit
 * feet of that reads as a different species watching from a scale model. These
 * are people the same size as the ones playing.
 */
export const FAN_HEIGHT = 14.5;

function yawAt(theta: number): number {
  return -theta;
}

function foulPoles(blocks: Block[]) {
  for (const side of [-1, 1]) {
    const theta = side * Math.PI / 4;
    const r = wallDistance(theta);
    blocks.push({ p: [Math.sin(theta) * r, 30, -Math.cos(theta) * r], s: [1.3, 60, 1.3], c: COLORS.pole, shape: "cylinder" });
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

/** Seats and spectators use the same arc-length layout as the curved terraces. */
function stands(blocks: Block[], fans: Fan[], palette: CrowdPalette) {
  for (const terrace of TERRACES) {
    // Leave enough vertical space for the deliberately oversized characters.
    if (terrace.row % 3 !== 0) continue;
    for (const [index, seat] of terraceSeats(terrace).entries()) {
      const { x, z, yaw } = seat;
      const y = terrace.height + 0.6;
      const salt = terrace.row + (terrace.deck === "upper" ? 80 : terrace.deck === "field" ? 40 : 0);
      const roll = noise(x, z, salt);
      const hat = noise(x, z, salt + 31);
      const longHair = noise(x, z, salt + 47) < 0.5;
      const capped = !longHair && hat < 0.34;
      const chair = index % 7 === 0 ? "#3c756b" : "#285e55";
      blocks.push({ p: [x, y, z], s: [SEAT_WIDTH, 0.7, 3.8], c: chair, r: yaw, shape: "round" });
      blocks.push({
        p: [x - Math.sin(yaw) * 1.8, y + 2.3, z - Math.cos(yaw) * 1.8],
        s: [SEAT_WIDTH, 4.5, 0.85], c: chair, r: yaw, shape: "round",
      });
      if (noise(x, z, salt + 70) < 0.09) continue;
      fans.push({
        p: [x, y + 0.35, z], yaw,
        shirt: crowdShirt(roll, palette), allegiance: allegianceFor(roll),
        skin: SKIN_TONES[Math.floor(roll * 97) % SKIN_TONES.length],
        hair: capped ? palette.home[hat < 0.24 ? 0 : 1] : HAIR_TONES[Math.floor(hat * 89) % HAIR_TONES.length],
        longHair, scale: 0.88 + noise(x, z, salt + 11) * 0.26,
        phase: noise(x, z, salt + 23),
      });
    }
  }
}

/** Slender steelwork supports the concourse, upper-deck rail and canopy. */
function stadiumDetails(blocks: Block[]) {
  for (const theta of AISLES) {
    if (!INFIELD_ARCS.some(([a, b]) => theta >= a && theta <= b)) continue;
    const r = outerRadius(theta) - 4;
    const [tx, tz] = terraceTangent(outerRadius, theta);
    const yaw = Math.atan2(-tz, tx);
    blocks.push({ p: [Math.sin(theta) * r, 55, -Math.cos(theta) * r], s: [2.2, 63, 2.2], c: "#637b70", shape: "cylinder" });
    const beamR = outerRadius(theta) - 22;
    blocks.push({ p: [Math.sin(theta) * beamR, roofHeight - 1, -Math.cos(theta) * beamR], s: [1.2, 2, 52], c: "#8b9b8e", r: -theta, shape: "round" });
    const facadeR = outerRadius(theta) + 2.2;
    blocks.push({ p: [Math.sin(theta) * facadeR, 39, -Math.cos(theta) * facadeR], s: [3.2, 77, 2.0], c: "#ded5bf", shape: "round", r: yaw });
    const supportR = upperRadius(theta) + 3;
    blocks.push({ p: [Math.sin(theta) * supportR, 32, -Math.cos(theta) * supportR], s: [2.5, 14, 2.5], c: "#b0b8a6", shape: "cylinder" });
    // Rail stanchions face the curved edge, rather than a circular approximation.
    for (const step of [-0.06, 0, 0.06]) {
      const at = theta + step;
      const railR = upperRadius(at) - 3.4;
      blocks.push({ p: [Math.sin(at) * railR, 46.2, -Math.cos(at) * railR], s: [0.45, 4.6, 0.45], c: "#526965", shape: "cylinder", r: yaw });
    }
  }
  // Ribbing on the padded outfield fence is subtle and flush to the continuous wall.
  for (let i = 0; i <= 70; i++) {
    const theta = -Math.PI / 4 + i / 70 * Math.PI / 2;
    const r = stadiumEdge(theta) - 0.67;
    blocks.push({ p: [Math.sin(theta) * r, 4.4, -Math.cos(theta) * r], s: [0.1, 8.1, 0.05], c: "#3d786c", r: -theta });
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
  const r = fieldRadius(theta) + 166;
  return [Math.sin(theta) * r, TOWER_LAMP_HEIGHT, -Math.cos(theta) * r];
}

function lightTowers(blocks: Block[]) {
  // None near dead center: a tower there sits in the broadcast sight line.
  for (const deg of TOWER_ANGLES) {
    const theta = (deg * Math.PI) / 180;
    const r = fieldRadius(theta) + 166;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;
    const yaw = yawAt(theta);
    const tangentX = Math.cos(theta);
    const tangentZ = Math.sin(theta);

    blocks.push({ p: [x, 56, z], s: [3.4, 112, 3.4], c: COLORS.tower, shape: "round", r: yaw });
    blocks.push({ p: [x, 114, z], s: [30, 8, 3], c: COLORS.tower, shape: "round", r: yaw });
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

/** The two rings the town buildings sit inside, for laying ground under them. */
const TOWN_INNER = 520;
const TOWN_OUTER = 1560;
/** The arc the town wraps around the bowl - everything but a wedge behind home. */
const TOWN_ARC = Math.PI * 0.78;

/**
 * The ground the whole town stands on. Without it the outer buildings and trees
 * sit on nothing - boxes pinned to the sky with a ragged rooftop line for a
 * horizon. One broad plane tucked just under everything gives them a floor and
 * turns that edge into ground meeting sky, the way a horizon is supposed to
 * read. It is dropped a hair below the field so it never fights the turf for
 * depth, and it runs out well past the farthest ring so its own far edge is lost
 * behind the buildings rather than cutting across open grass.
 */
function townGround(blocks: Block[]) {
  const size = 5200;
  const thickness = 60;
  blocks.push({
    p: [0, -thickness / 2 - 0.6, 0],
    s: [size, thickness, size],
    c: COLORS.townGround,
  });
}

/**
 * Streets through the town. The buildings are laid out on concentric rings, so
 * the roads follow suit: a few ring roads circling the park between the rings,
 * crossed by radial avenues running out from the stands. Laid flat, a touch
 * above the ground plane so they read as paved rather than z-fighting it. From a
 * seat this is all read at a quarter mile, so it only has to give the town a
 * grain - a suggestion of blocks and thoroughfares - not survive a close look.
 */
function streets(blocks: Block[]) {
  const y = -0.35; // just above townGround's top face at -0.6
  const width = 26; // how wide a street reads from the stands

  // Ring roads, sampled as short tangential segments the way the wall is.
  for (const radius of [660, 1000, 1360]) {
    const steps = Math.max(40, Math.round((Math.PI * 2 * radius) / 60));
    for (let i = 0; i < steps; i++) {
      const theta = (i / steps) * Math.PI * 2 - Math.PI;
      const x = Math.sin(theta) * radius;
      const z = -Math.cos(theta) * radius;
      const seg = (Math.PI * 2 * radius) / steps + 3;
      blocks.push({
        p: [x, y, z],
        s: [seg, 0.5, width],
        c: shade(COLORS.street, (noise(x, z, 51) - 0.5) * 0.05),
        r: yawAt(theta),
      });
    }
  }

  // Radial avenues running out through the rings, on the same arc the buildings
  // wrap around so none strike out across the empty wedge behind the plate.
  const spokes = 13;
  const midR = (TOWN_INNER + TOWN_OUTER) / 2;
  const length = TOWN_OUTER - TOWN_INNER;
  for (let k = 0; k < spokes; k++) {
    const theta = -TOWN_ARC + (k / (spokes - 1)) * TOWN_ARC * 2;
    const x = Math.sin(theta) * midR;
    const z = -Math.cos(theta) * midR;
    blocks.push({
      p: [x, y, z],
      s: [width, 0.5, length],
      c: shade(COLORS.street, (noise(theta * 30, 0, 52) - 0.5) * 0.05),
      r: yawAt(theta),
    });
  }
}

/**
 * A town beyond the park. Buildings sit on a wide arc well outside the bowl,
 * with the far ring paler than the near one so the depth reads as haze rather
 * than as a flat wall of boxes.
 */
function skyline(blocks: Block[]) {
  const rings = [
    { radius: 880, count: 42, minHeight: 48, maxHeight: 108, haze: 0.08 },
    { radius: 1120, count: 34, minHeight: 55, maxHeight: 145, haze: 0.24 },
    { radius: 1420, count: 26, minHeight: 45, maxHeight: 125, haze: 0.4 },
  ];
  for (const [ringIndex, ring] of rings.entries()) {
    for (let i = 0; i < ring.count; i++) {
      const theta = -TOWN_ARC + (i / (ring.count - 1)) * TOWN_ARC * 2;
      const jitter = noise(i * 3.7, ringIndex * 11, 21);
      const r = ring.radius + (jitter - 0.5) * 90;
      const height = ring.minHeight + noise(i * 5.1, ringIndex * 7, 22) * (ring.maxHeight - ring.minHeight);
      const width = 46 + noise(i * 2.3, ringIndex * 5, 23) * 50;
      const depth = 44 + noise(i * 6.9, ringIndex * 3, 24) * 44;
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;
      const yaw = yawAt(theta) + (jitter - 0.5) * 0.3;
      const body = shade(SKYLINE_COLORS[Math.floor(jitter * SKYLINE_COLORS.length)], ring.haze * 0.9);
      const roof = shade(ROOF_COLORS[i % ROOF_COLORS.length], ring.haze * 0.7);
      // Local facade coordinates make every doorway and window face the park.
      const part = (p: Block["p"], size: Block["s"], color: string, shape: Block["shape"] = "round") => {
        blocks.push({ p: [x + p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), p[1], z - p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw)], s: size, c: color, r: yaw, shape });
      };
      part([0, height / 2, 0], [width, height, depth], body);
      part([0, 4, 0], [width + 5, 8, depth + 5], "#d9c5aa");
      part([0, height + 1, 0], [width + 10, 6, depth + 10], "#fff1d7");
      part([0, height + 17, 0], [width + 12, 32, depth + 12], roof, "roof");
      part([width * 0.26, height + 30, -depth * 0.18], [9, 28, 10], body);
      part([width * 0.26, height + 44, -depth * 0.18], [12, 5, 13], roof);
      if (ringIndex === 0) {
        const front = depth / 2;
        part([0, 15, front], [15, 30, 3], "#688c88");
        part([5, 14, front + 2], [2, 2, 2], "#e8c477", "sphere");
        for (const wx of [-width * 0.29, width * 0.29]) {
          for (let wy = 24; wy < height - 10; wy += 31) {
            part([wx, wy, front], [18, 22, 3], "#fff0d6");
            part([wx, wy, front + 2], [12, 16, 2], "#88b9ba");
            part([wx, wy, front + 3.2], [1.4, 16, 1], "#fff0d6");
            part([wx, wy - 12, front + 3], [22, 3, 7], roof);
          }
        }
        // A little striped shop awning and rounded shrubs at the doorstep.
        for (let stripe = -2; stripe <= 2; stripe++) {
          part([stripe * 6, 33, front + 6], [6.2, 4, 15], stripe % 2 ? "#fff0d6" : roof);
        }
        for (const dx of [-width * 0.48, width * 0.48]) {
          part([dx, 7, front + 8], [16, 14, 14], "#77a978", "sphere");
        }
      }
    }
  }
}

/**
 * The board out over the batter's eye. Its woodwork is here with the rest of
 * the park; what is *written* on it is not - the recessed panel is left blank
 * and `components/scene/Scoreboard.tsx` hangs a canvas of the game's actual
 * line score on the front of it. Two rows of decorative digits used to stand
 * in for that, which looked right from a seat and said nothing.
 *
 * Sized to hold nine innings and the R/H/E totals legibly from behind home -
 * a toy park's board, like everything else out there, is drawn for the read
 * rather than to scale.
 */
export const SCOREBOARD = {
  /** Depth of the board's centre plane. Negative Z runs out toward center. */
  z: -(fieldRadius(0) + 74),
  width: 168,
  height: 58,
  /** How tall the posts are, which is where the bottom edge of the board sits. */
  base: 54,
  /** Margin of frame left around the recessed panel, across and up. */
  frameX: 9,
  frameY: 7,
};

/** The recessed panel the line score is painted on, in world space. */
export const SCOREBOARD_FACE = {
  width: SCOREBOARD.width - SCOREBOARD.frameX * 2,
  height: SCOREBOARD.height - SCOREBOARD.frameY * 2,
  y: SCOREBOARD.base + SCOREBOARD.height / 2,
  /** Stood just off the recess, so the panel and the wood never z-fight. */
  z: SCOREBOARD.z + 4.3,
};

function scoreboard(blocks: Block[]) {
  const { z, width, height, base } = SCOREBOARD;

  for (const dx of [-(width / 2 - 22), width / 2 - 22]) {
    blocks.push({ p: [dx, base / 2, z], s: [7, base, 7], c: COLORS.scoreboard });
  }
  blocks.push({ p: [0, base + height / 2, z], s: [width, height, 5], c: COLORS.scoreboard });
  // The recess itself, a shade darker than the frame, so the board still reads
  // as a board in the moment before a game is loaded into it.
  blocks.push({
    p: [0, SCOREBOARD_FACE.y, z + 3],
    s: [SCOREBOARD_FACE.width, SCOREBOARD_FACE.height, 2],
    c: COLORS.scoreboardFace,
  });
  // A flat steel rail top and bottom, and nothing above the panel: the board
  // used to carry an empty cornice up there with nothing written on it.
  blocks.push({ p: [0, base + height + 1, z], s: [width + 5, 2, 8], c: "#d6c69f", shape: "round" });
  blocks.push({ p: [0, base - 1, z], s: [width + 5, 2, 8], c: "#d6c69f", shape: "round" });
}

const LEAF_COLORS = ["#5fa855", "#4e9a4c", "#79b45c", "#3f8f5b", "#8cbb5e"];
const TRUNK_COLOR = "#7a5638";

/** Soft, overlapping crowns and scattered fruit around the village. */
function parkland(blocks: Block[]) {
  for (let i = 0; i < 64; i++) {
    const theta = -TOWN_ARC + (i / 63) * TOWN_ARC * 2;
    const jitter = noise(i * 8.1, 3, 41);
    const r = 750 + jitter * 330;
    const x = Math.sin(theta) * r;
    const z = -Math.cos(theta) * r;
    const scale = 1.1 + jitter * 0.65;
    const leaf = LEAF_COLORS[i % LEAF_COLORS.length];
    blocks.push({ p: [x, 28 * scale, z], s: [9 * scale, 56 * scale, 9 * scale], c: TRUNK_COLOR, shape: "cylinder" });
    // Overlapping round crowns with a broad base and a soft, asymmetric top.
    const crowns = [[0, 67, 0, 57], [-19, 57, 3, 39], [20, 60, -2, 43], [3, 88, -2, 42], [-8, 74, 17, 37]];
    for (const [k, [dx, y, dz, size]] of crowns.entries()) {
      blocks.push({ p: [x + dx * scale, y * scale, z + dz * scale], s: [size * scale, size * scale * 0.9, size * scale], c: shade(leaf, k * 0.025), shape: "sphere" });
    }
    // A handful of fruit makes the nearest trees feel planted and tended.
    if (i % 3 === 0) for (const dx of [-15, 14]) {
      blocks.push({ p: [x + dx * scale, 65 * scale, z + 24 * scale], s: [7 * scale, 8 * scale, 7 * scale], c: "#edb36f", shape: "sphere" });
    }
  }
}

let cached: { key: string; blocks: Block[]; fans: Fan[] } | null = null;

export const DEFAULT_CROWD: CrowdPalette = {
  home: ["#3f6fb5", "#e0c452"],
  away: ["#c1503f", "#dcdcdc"],
};

/**
 * Park instances, cached by crowd palette - a few thousand fixtures and a
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
  foulPoles(blocks);
  stands(blocks, fans, palette);
  stadiumDetails(blocks);
  lightTowers(blocks);
  scoreboard(blocks);
  townGround(blocks);
  streets(blocks);
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
