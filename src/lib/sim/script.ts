/**
 * A scripted demo game.
 *
 * The simulator emits a feed with the exact shape of MLB's GUMBO response, so
 * the demo exercises the real normalization and animation path end to end. It
 * is also what makes the app usable when nothing is live.
 */

export type PitchCode =
  | "B" // ball
  | "C" // called strike
  | "S" // swinging strike
  | "F" // foul
  | "X"; // in play

export type ScriptedResult =
  | "strikeout_swinging"
  | "strikeout_looking"
  | "walk"
  | "single"
  | "double"
  | "triple"
  | "home_run"
  | "flyout"
  | "groundout"
  | "lineout"
  | "double_play"
  | "sac_fly"
  | "error";

export interface ScriptedAtBat {
  result: ScriptedResult;
  /** Spray angle in degrees: negative = left field, positive = right field. */
  angle: number;
  /** Carry distance in feet. */
  distance: number;
  launchAngle?: number;
  launchSpeed?: number;
  /** A base stolen before this at-bat resolves. */
  steal?: "second" | "third";
  pitches?: PitchCode[];
}

const PITCHES_FOR: Record<ScriptedResult, PitchCode[]> = {
  strikeout_swinging: ["B", "C", "F", "S"],
  strikeout_looking: ["C", "B", "F", "C"],
  walk: ["B", "C", "B", "B", "B"],
  single: ["C", "B", "X"],
  double: ["B", "F", "X"],
  triple: ["C", "X"],
  home_run: ["B", "C", "F", "X"],
  flyout: ["C", "X"],
  groundout: ["B", "F", "X"],
  lineout: ["X"],
  double_play: ["C", "B", "X"],
  sac_fly: ["B", "C", "X"],
  error: ["C", "X"],
};

export function pitchesFor(atBat: ScriptedAtBat): PitchCode[] {
  return atBat.pitches ?? PITCHES_FOR[atBat.result];
}

export const IN_PLAY_RESULTS: ScriptedResult[] = [
  "single",
  "double",
  "triple",
  "home_run",
  "flyout",
  "groundout",
  "lineout",
  "double_play",
  "sac_fly",
  "error",
];

/**
 * Ordered to show off the animation vocabulary quickly: a strikeout, traffic on
 * the bases, a double that scores a run, a steal, a double play and a homer all
 * land inside the first few minutes.
 */
export const SCRIPT: ScriptedAtBat[] = [
  { result: "strikeout_looking", angle: 0, distance: 0 },
  { result: "single", angle: -28, distance: 172, launchAngle: 12, launchSpeed: 98.4 },
  { result: "double", angle: -36, distance: 331, launchAngle: 22, launchSpeed: 103.1, steal: "second" },
  { result: "flyout", angle: 20, distance: 288, launchAngle: 38, launchSpeed: 91.2 },
  { result: "home_run", angle: 30, distance: 421, launchAngle: 29, launchSpeed: 109.7 },
  { result: "groundout", angle: -14, distance: 78, launchAngle: -6, launchSpeed: 84.5 },

  { result: "walk", angle: 0, distance: 0 },
  { result: "double_play", angle: -12, distance: 96, launchAngle: -2, launchSpeed: 88.9 },
  { result: "strikeout_swinging", angle: 0, distance: 0 },

  { result: "single", angle: 34, distance: 158, launchAngle: 9, launchSpeed: 95.0 },
  { result: "single", angle: -40, distance: 190, launchAngle: 14, launchSpeed: 99.6 },
  { result: "sac_fly", angle: 8, distance: 302, launchAngle: 34, launchSpeed: 93.8 },
  { result: "triple", angle: 41, distance: 348, launchAngle: 19, launchSpeed: 106.2 },
  { result: "lineout", angle: -5, distance: 214, launchAngle: 15, launchSpeed: 101.4 },

  { result: "error", angle: -30, distance: 118, launchAngle: 4, launchSpeed: 90.3 },
  { result: "walk", angle: 0, distance: 0 },
  { result: "home_run", angle: -22, distance: 438, launchAngle: 27, launchSpeed: 112.5 },
  { result: "strikeout_swinging", angle: 0, distance: 0 },
  { result: "groundout", angle: 24, distance: 84, launchAngle: -12, launchSpeed: 79.8 },
  { result: "flyout", angle: -18, distance: 271, launchAngle: 41, launchSpeed: 88.1 },
];

export interface SimRosterEntry {
  id: number;
  fullName: string;
  number: string;
  position: string;
  batSide: "R" | "L";
  pitchHand: "R" | "L";
}

function roster(
  idBase: number,
  names: string[],
  positions: string[],
): SimRosterEntry[] {
  return names.map((fullName, i) => ({
    id: idBase + i,
    fullName,
    number: String(((i * 7 + 3) % 60) + 1),
    position: positions[i] ?? "PH",
    batSide: i % 3 === 0 ? "L" : "R",
    pitchHand: i % 2 === 0 ? "R" : "L",
  }));
}

const FIELD_POSITIONS = ["CF", "SS", "RF", "1B", "3B", "LF", "C", "2B", "P"];
const BENCH_POSITIONS = ["C", "IF", "OF", "IF", "OF"];
const PEN_POSITIONS = ["P", "P", "P", "P", "P"];

/** Fictional players - the demo never claims to be a real game. */
export const AWAY_ROSTER = roster(
  900001,
  [
    "Mateo Rivas",
    "Desmond Park",
    "Iker Salgado",
    "Bo Whitaker",
    "Nikolai Frost",
    "Ravi Chandra",
    "Ollie Bergstrom",
    "Kenji Watanabe",
    "Cal Mendoza",
    "Theo Ruiz",
    "Sam Okonkwo",
    "Wes Lindqvist",
    "Dario Belmonte",
    "Nate Ferris",
    "Aurelio Vance",
    "Kit Delacroix",
    "Marlon Pike",
    "Emil Nakamura",
    "Rafe Sandoval",
  ],
  [...FIELD_POSITIONS, ...BENCH_POSITIONS, ...PEN_POSITIONS],
);

export const HOME_ROSTER = roster(
  910001,
  [
    "Junior Alcantara",
    "Pete Hollis",
    "Sanjay Varma",
    "Bram Vogel",
    "Tobias Lund",
    "Cesar Ibarra",
    "Miles Ashford",
    "Yusuf Demir",
    "Grant Coyle",
    "Ezra Blackwood",
    "Nico Trevino",
    "Hank Mbeki",
    "Silas Whitmore",
    "Roy Castellan",
    "Dane Kowalski",
    "Ivo Pashkov",
    "Lucas Fontaine",
    "Omar Haddad",
    "Trey Bellinger",
  ],
  [...FIELD_POSITIONS, ...BENCH_POSITIONS, ...PEN_POSITIONS],
);

/** Giants at Dodgers - two clubs with strongly contrasting colors. */
export const AWAY_TEAM = { id: 137, name: "San Francisco Giants", teamName: "Giants", abbreviation: "SF" };
export const HOME_TEAM = { id: 119, name: "Los Angeles Dodgers", teamName: "Dodgers", abbreviation: "LAD" };
