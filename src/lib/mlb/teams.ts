/**
 * Team identity. The Stats API does not publish club colors, so the palette is
 * kept here, keyed by the stable MLB team id.
 */
export interface TeamPalette {
  abbrev: string;
  /** The color the club reads as from across the park. */
  primary: string;
  /** Trim: cap bill, sleeves, socks, numbers. */
  secondary: string;
}

export const TEAM_PALETTES: Record<number, TeamPalette> = {
  108: { abbrev: "LAA", primary: "#BA0021", secondary: "#003263" },
  109: { abbrev: "AZ", primary: "#A71930", secondary: "#E3D4AD" },
  110: { abbrev: "BAL", primary: "#DF4601", secondary: "#000000" },
  111: { abbrev: "BOS", primary: "#BD3039", secondary: "#0C2340" },
  112: { abbrev: "CHC", primary: "#0E3386", secondary: "#CC3433" },
  113: { abbrev: "CIN", primary: "#C6011F", secondary: "#000000" },
  114: { abbrev: "CLE", primary: "#00385D", secondary: "#E50022" },
  115: { abbrev: "COL", primary: "#33006F", secondary: "#C4CED4" },
  116: { abbrev: "DET", primary: "#0C2340", secondary: "#FA4616" },
  117: { abbrev: "HOU", primary: "#002D62", secondary: "#EB6E1F" },
  118: { abbrev: "KC", primary: "#004687", secondary: "#BD9B60" },
  119: { abbrev: "LAD", primary: "#005A9C", secondary: "#EF3E42" },
  120: { abbrev: "WSH", primary: "#AB0003", secondary: "#14225A" },
  121: { abbrev: "NYM", primary: "#002D72", secondary: "#FF5910" },
  133: { abbrev: "ATH", primary: "#003831", secondary: "#EFB21E" },
  134: { abbrev: "PIT", primary: "#27251F", secondary: "#FDB827" },
  135: { abbrev: "SD", primary: "#2F241D", secondary: "#FFC425" },
  136: { abbrev: "SEA", primary: "#0C2C56", secondary: "#005C5C" },
  137: { abbrev: "SF", primary: "#FD5A1E", secondary: "#27251F" },
  138: { abbrev: "STL", primary: "#C41E3A", secondary: "#0C2340" },
  139: { abbrev: "TB", primary: "#092C5C", secondary: "#8FBCE6" },
  140: { abbrev: "TEX", primary: "#003278", secondary: "#C0111F" },
  141: { abbrev: "TOR", primary: "#134A8E", secondary: "#E8291C" },
  142: { abbrev: "MIN", primary: "#002B5C", secondary: "#D31145" },
  143: { abbrev: "PHI", primary: "#E81828", secondary: "#002D72" },
  144: { abbrev: "ATL", primary: "#13274F", secondary: "#CE1141" },
  145: { abbrev: "CWS", primary: "#27251F", secondary: "#C4CED4" },
  146: { abbrev: "MIA", primary: "#00A3E0", secondary: "#EF3340" },
  147: { abbrev: "NYY", primary: "#0C2340", secondary: "#C4CED4" },
  158: { abbrev: "MIL", primary: "#12284B", secondary: "#FFC52F" },
};

const FALLBACK: TeamPalette = { abbrev: "MLB", primary: "#41546B", secondary: "#C4CED4" };

export function paletteFor(teamId: number | undefined, abbrev?: string): TeamPalette {
  const found = teamId != null ? TEAM_PALETTES[teamId] : undefined;
  if (found) return found;
  return abbrev ? { ...FALLBACK, abbrev } : FALLBACK;
}

/** Full uniform used by the player models. */
export interface Uniform {
  jersey: string;
  pants: string;
  cap: string;
  trim: string;
  helmet: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Rough perceptual distance, good enough to catch two clubs in the same color. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const rMean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db,
  );
}

const HOME_PANTS = "#EFEFE9";
const AWAY_PANTS = "#B7BCC2";

/**
 * Build both clubs' uniforms at once so we can resolve the case where the two
 * primaries are too close to tell apart (Astros navy vs. Yankees navy) by
 * dropping the visiting club onto its secondary.
 */
export function buildUniforms(home: TeamPalette, away: TeamPalette): {
  home: Uniform;
  away: Uniform;
} {
  let awayJersey = away.primary;
  let awayTrim = away.secondary;
  if (colorDistance(home.primary, away.primary) < 120) {
    // Too close to read at a glance - flip the visitors onto their trim color.
    if (colorDistance(home.primary, away.secondary) > 120) {
      awayJersey = away.secondary;
      awayTrim = away.primary;
    } else {
      awayJersey = AWAY_PANTS;
      awayTrim = away.primary;
    }
  }

  return {
    home: {
      jersey: home.primary,
      pants: HOME_PANTS,
      cap: home.primary,
      trim: home.secondary,
      helmet: home.primary,
    },
    away: {
      jersey: awayJersey,
      pants: AWAY_PANTS,
      cap: away.primary,
      trim: awayTrim,
      helmet: away.primary,
    },
  };
}
