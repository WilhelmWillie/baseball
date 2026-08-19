import type { MlbLiveFeed } from "@/lib/mlb/types";

/**
 * The on-disk recording format.
 *
 * A recording is a time-indexed sequence of `MlbLiveFeed` values - the same
 * shape the live poller hands to `gameStore.ingest`. Playback is therefore not
 * a second code path: it feeds recorded snapshots into the normalizer the live
 * game already runs through.
 *
 * Frames are stored as one full keyframe followed by RFC-6902 patches. A whole
 * feed is 1.5-4 MB and a game keeps ~600-900 frames; storing them whole runs to
 * gigabytes, while the delta between adjacent pitches is a new play event, a
 * count and a few counters. See `docs/RECORDING.md`.
 */
export const FRAME_FORMAT_VERSION = 1;

/**
 * What a clip *contains*, as a number a cache can see.
 *
 * Distinct from `FRAME_FORMAT_VERSION`, which is how frames are written; this
 * is which frames get in. A finished game's clips are served `immutable`, so
 * without something in the URL to tell two vintages apart, a browser that
 * already fetched one would keep it forever. Bump whenever the answer to "which
 * frames does a clip keep" changes.
 *
 * Lives here rather than in `clip.ts` so the client can read it without pulling
 * the reconstructor - `clip.ts` is server-side and heavy.
 *
 * 2: opens on the decisive pitch rather than the whole plate appearance.
 */
export const CLIP_SHAPE_VERSION = 2;

/** One RFC-6902 operation. Only the subset the recorder emits. */
export interface PatchOp {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

/** Line 0 of the frame stream: a complete feed to patch forward from. */
export interface KeyframeLine {
  v: number;
  gamePk: number;
  kind: "keyframe";
  /** Milliseconds since the first frame. Always 0 for the opening keyframe. */
  t: number;
  feed: MlbLiveFeed;
}

/** Every subsequent line: a patch against the previous frame. */
export interface PatchLine {
  kind: "patch";
  t: number;
  ops: PatchOp[];
}

export type FrameLine = KeyframeLine | PatchLine;

/** How a recording was captured. See `docs/RECORDING.md` for the trade-off. */
export type RecordingSource = "reconstructed" | "timecode";

/** One row of the seek index, in the order frames appear in the stream. */
export interface ManifestFrame {
  /** Index into the frame stream. */
  i: number;
  /** Milliseconds since the first frame. */
  t: number;
  inning: number;
  isTop: boolean;
  /** Where in the half-inning this frame sits, for pacing and step controls. */
  atBatIndex: number;
  /** True when this frame carries a completed play's result. */
  playComplete: boolean;
  scoring: boolean;
  /** True between halves - the window the intermission card holds for. */
  between: boolean;
}

/** A labelled point on the scrub bar. */
export interface ManifestMarker {
  t: number;
  kind: "half" | "scoring";
  label: string;
  score: { home: number; away: number };
}

export interface RecordingTeam {
  id: number;
  abbrev: string;
  name: string;
  score: number;
}

export interface RecordingManifest {
  v: number;
  gamePk: number;
  /** ISO timestamp of when the recording was made, not of the game. */
  recordedAt: string;
  source: RecordingSource;
  game: {
    date: string;
    venue: string;
    home: RecordingTeam;
    away: RecordingTeam;
    /** MLB's own description, e.g. "Regular Season". */
    description?: string;
    /**
     * What to call this recording, when the teams and the date do not say it.
     * "2025 World Series Game 7" is worth more on a card than "2025-11-01".
     */
    label?: string;
    /**
     * Why this game is on the shelf, in a sentence or two.
     *
     * The shelf is curated - a handful of games picked out of a season of
     * thousands - and a scoreline does not carry the reason. "Giants 11,
     * Nationals 10" looks like any other slugfest until you know San Francisco
     * was down eight runs going into the eighth.
     */
    note?: string;
  };
  frameCount: number;
  /** Real elapsed milliseconds from the first frame to the last. */
  durationMs: number;
  frames: ManifestFrame[];
  markers: ManifestMarker[];
}

/** One row of the recorded-games index. */
export interface RecordingIndexEntry {
  gamePk: number;
  date: string;
  venue: string;
  /** Mirrors `manifest.game.label`, so the index alone can name a recording. */
  label?: string;
  /** Mirrors `manifest.game.note`, so the shelf can say why without a fetch. */
  note?: string;
  home: RecordingTeam;
  away: RecordingTeam;
  frameCount: number;
  durationMs: number;
  source: RecordingSource;
  recordedAt: string;
}

export const MANIFEST_FILE = "manifest.json";
export const FRAMES_FILE = "frames.ndjson.gz";
export const INDEX_FILE = "index.json";

/** Where one game's objects live, under a storage base. */
export function recordingPrefix(gamePk: number): string {
  return `v${FRAME_FORMAT_VERSION}/${gamePk}`;
}

/**
 * What the renderer can actually see, as a comparable string.
 *
 * The recorder keeps a frame only when this changes. Upstream churn the
 * normalizer would never react to - metadata timestamps, stat recalculations -
 * is dropped, which is what keeps a game to hundreds of frames rather than
 * thousands. The fields are exactly the ones `extractEvents` walks and
 * `buildSnapshot` reads off the linescore.
 */
export function frameFingerprint(feed: MlbLiveFeed): string {
  const plays = feed.liveData?.plays?.allPlays ?? [];
  const last = plays[plays.length - 1];
  const line = feed.liveData?.linescore;
  return [
    plays.length,
    last?.playEvents?.length ?? 0,
    last?.about?.isComplete ? 1 : 0,
    line?.currentInning ?? 0,
    line?.isTopInning ? 1 : 0,
    line?.inningState ?? "",
    line?.outs ?? 0,
    line?.balls ?? 0,
    line?.strikes ?? 0,
    line?.teams?.home?.runs ?? 0,
    line?.teams?.away?.runs ?? 0,
    line?.defense?.pitcher?.id ?? 0,
    line?.offense?.batter?.id ?? 0,
    feed.gameData?.status?.codedGameState ?? "",
  ].join("|");
}
