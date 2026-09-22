import type { BaseId, PositionKey } from "@/lib/field/geometry";
import type { Conditions } from "@/lib/field/sky";
import type { TeamPalette, Uniform } from "@/lib/mlb/teams";

export type TeamSide = "home" | "away";

export interface PlayerRef {
  id: number;
  name: string;
  /** Last name only - what we print on a jersey or a small label. */
  shortName: string;
  number?: string;
  position?: string;
  batSide?: "R" | "L";
  pitchHand?: "R" | "L";
  side: TeamSide;
}

export interface TeamInfo {
  id: number;
  name: string;
  abbrev: string;
  palette: TeamPalette;
  uniform: Uniform;
  record?: string;
}

/** One line of a box score. */
export interface BatterLine {
  id: number;
  name: string;
  position: string;
  ab: number;
  r: number;
  h: number;
  rbi: number;
  bb: number;
  k: number;
  avg: string;
}

export interface PitcherLine {
  id: number;
  name: string;
  ip: string;
  h: number;
  r: number;
  er: number;
  bb: number;
  k: number;
  era: string;
  decision?: "W" | "L" | "S";
}

export interface TeamBoxscore {
  batters: BatterLine[];
  pitchers: PitcherLine[];
}

/** What the hitter has done today, and how they are hitting on the season. */
export interface BatterStatLine {
  /** Season average as MLB formats it, e.g. ".287". Absent before a game. */
  avg: string | null;
  atBats: number;
  hits: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  homeRuns: number;
}

/** What the pitcher has thrown today. */
export interface PitcherStatLine {
  pitches: number;
  inningsPitched: string | null;
  strikeouts: number;
  hits: number;
  earnedRuns: number;
  era: string | null;
}

/** An entry in the running play log. */
export interface HistoryEntry {
  id: string;
  inning: number;
  isTopInning: boolean;
  half: string;
  event: string;
  description: string;
  isScoring: boolean;
  score: { home: number; away: number };
}

/**
 * The renderer's view of the world. Derived entirely from the feed; the 3D
 * layer never sees MLB's JSON.
 */
export interface GameSnapshot {
  gamePk: number;
  updatedAt: number;
  status: {
    abstract: string;
    detailed: string;
    isLive: boolean;
    isFinal: boolean;
    isPreview: boolean;
  };
  venue: string;
  /** Time of day and weather at the park, which drive the lighting. */
  conditions: Conditions;
  teams: Record<TeamSide, TeamInfo>;
  score: Record<TeamSide, number>;
  hits: Record<TeamSide, number>;
  errors: Record<TeamSide, number>;
  inning: number;
  inningOrdinal: string;
  isTopInning: boolean;
  inningState: string;
  count: { balls: number; strikes: number; outs: number };
  /** Club currently in the field. */
  fieldingSide: TeamSide;
  battingSide: TeamSide;
  defense: Record<PositionKey, PlayerRef | null>;
  batter: PlayerRef | null;
  /** Line for whoever is at the plate, and for whoever is on the mound. */
  batterStats: BatterStatLine | null;
  pitcherStats: PitcherStatLine | null;
  onDeck: PlayerRef | null;
  runners: Partial<Record<Exclude<BaseId, "home">, PlayerRef>>;
  bench: Record<TeamSide, PlayerRef[]>;
  bullpen: Record<TeamSide, PlayerRef[]>;
  lineScore: Array<{ num: number; home: number | null; away: number | null }>;
  lastPlay: string | null;
  /** The last pitch anybody has seen cross the plate, for the strike-zone box. */
  pitch: TrackedPitch | null;
  boxscore: Record<TeamSide, TeamBoxscore>;
}

/** A runner's journey during one play. */
export interface RunnerMove {
  playerId: number;
  name: string;
  from: BaseId;
  to: BaseId | "out";
  /** Base the runner was retired at, when `to` is "out". */
  outAt?: BaseId;
  isScoring: boolean;
}

export interface BattedBall {
  /** Landing spot / final resting spot, in field feet. */
  lateral: number;
  depth: number;
  distance: number;
  launchAngle?: number;
  launchSpeed?: number;
  trajectory?: "ground_ball" | "line_drive" | "fly_ball" | "popup" | "bunt" | "unknown";
  isHomeRun: boolean;
  isFoul: boolean;
  /** Whichever defender ends up closest to the ball. */
  fielder: PositionKey;
}

export type PitchOutcome =
  | "ball"
  | "called_strike"
  | "swinging_strike"
  | "foul"
  | "in_play"
  | "hit_by_pitch"
  | "other";

/**
 * The pitch the strike-zone box is drawn around: where it crossed, and how tall
 * the hitter's zone was when it did.
 *
 * Kept separate from `PitchEvent` because the two answer different questions.
 * An event is something that just happened and is animated once; this is a mark
 * that hangs over the plate until the next pitch replaces it, and it has to be
 * there for a feed the viewer joined halfway through, with nothing animated at
 * all. `id` is the event's, so the box can tell a new pitch from the same one
 * read again.
 */
export interface TrackedPitch {
  id: string;
  /**
   * Where it crossed the plate, in feet. `x` is positive toward right field
   * (the catcher's right, which is MLB's own sign); `z` is height off the dirt.
   */
  x: number;
  z: number;
  /** The hitter's zone for this pitch, in feet. MLB measures it per pitch. */
  zone: { top: number; bottom: number };
  /** What it was thrown at, for the chip under the box. */
  speed?: number;
}

export type NormalizedEventType =
  | "pitch"
  | "play_result"
  | "action"
  | "inning_change";

/**
 * The intermediate representation described in the spec. The animation engine
 * consumes only these.
 */
export interface PitchEvent {
  id: string;
  type: "pitch";
  atBatIndex: number;
  eventIndex: number;
  outcome: PitchOutcome;
  pitchType?: string;
  speed?: number;
  /** Where the ball crossed the plate, in feet. */
  plate: { x: number; z: number };
  /**
   * Whether `plate` is a measurement rather than a stand-in. An automatic ball
   * - a pitch-timer violation, a pitch nobody threw - is a pitch in the feed
   * with no coordinates behind it. The animation still has to put the ball
   * somewhere, so `plate` falls back to the middle of the zone; the strike-zone
   * plot leaves an unlocated pitch off rather than drawing a mark down the
   * middle that nobody threw.
   */
  located: boolean;
  strikeZone: { top: number; bottom: number };
  batterId?: number;
  pitcherId?: number;
  batSide: "R" | "L";
  description: string;
  count: { balls: number; strikes: number };
  /** True when the swing put the ball in play - the result event follows. */
  startsPlay: boolean;
}

export interface PlayResultEvent {
  id: string;
  type: "play_result";
  atBatIndex: number;
  inning: number;
  isTopInning: boolean;
  eventType: string;
  event: string;
  description: string;
  /** Tier-1 bucket the animator branches on. */
  kind:
    | "single"
    | "double"
    | "triple"
    | "home_run"
    | "walk"
    | "strikeout"
    | "field_out"
    | "double_play"
    | "error"
    | "hit_by_pitch"
    | "sac_fly"
    | "generic";
  ball?: BattedBall;
  runners: RunnerMove[];
  rbi: number;
  isScoringPlay: boolean;
  outsAfter: number;
  scoreAfter: { home: number; away: number };
}

export interface ActionEvent {
  id: string;
  type: "action";
  atBatIndex: number;
  eventIndex: number;
  eventType: string;
  description: string;
  runners: RunnerMove[];
}

export interface InningChangeEvent {
  id: string;
  type: "inning_change";
  inning: number;
  isTopInning: boolean;
  description: string;
}

export type NormalizedEvent =
  | PitchEvent
  | PlayResultEvent
  | ActionEvent
  | InningChangeEvent;

/** How far through the feed the normalizer has read. */
export interface FeedCursor {
  atBatIndex: number;
  eventIndex: number;
  /** At-bats whose result has already been emitted. */
  completedAtBats: number[];
  inning: number;
  isTopInning: boolean;
  /**
   * A pitch that ended an at-bat but whose result MLB has not published yet.
   * Held back so the pitch and its outcome play as one continuous animation
   * instead of a swing followed by a wait. `since` bounds the wait.
   */
  hold: { id: string; since: number } | null;
}

export const EMPTY_CURSOR: FeedCursor = {
  atBatIndex: -1,
  eventIndex: -1,
  completedAtBats: [],
  inning: 0,
  isTopInning: true,
  hold: null,
};
