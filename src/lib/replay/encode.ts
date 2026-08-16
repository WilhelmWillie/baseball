import { applyPatch, compare, type Operation } from "fast-json-patch";
import { inningLabel } from "@/lib/game/normalize";
import type { MlbLiveFeed } from "@/lib/mlb/types";
import {
  FRAME_FORMAT_VERSION,
  frameFingerprint,
  type FrameLine,
  type ManifestFrame,
  type ManifestMarker,
  type PatchOp,
  type RecordingManifest,
  type RecordingSource,
  type RecordingTeam,
} from "./format";
import type { RecordedFrame } from "./reconstruct";

/**
 * Turning a reconstructed frame sequence into the stored format: drop frames
 * the renderer would not react to, then encode the rest as one keyframe plus
 * RFC-6902 patches.
 */

/** Drop frames whose fingerprint matches the one before them. */
export function dedupeFrames(frames: RecordedFrame[]): RecordedFrame[] {
  const kept: RecordedFrame[] = [];
  let previous: string | null = null;
  for (const frame of frames) {
    const print = frameFingerprint(frame.feed);
    if (print === previous) continue;
    previous = print;
    kept.push(frame);
  }
  return kept;
}

type JsonFeed = Record<string, unknown>;

/**
 * The feed as it will exist once written and read back.
 *
 * Patches have to describe the difference between two *stored* documents, not
 * two in-memory ones. `JSON.stringify` drops keys whose value is `undefined`,
 * and a reconstructed feed has several - a play's cleared `endTime`, the
 * `decisions` block before the game ends. Diffing the in-memory objects would
 * emit operations against keys that do not survive serialization, and those
 * patches would fail to apply on load.
 */
function normalize(feed: MlbLiveFeed): JsonFeed {
  return JSON.parse(JSON.stringify(feed)) as JsonFeed;
}

export function encodeFrames(gamePk: number, frames: RecordedFrame[]): FrameLine[] {
  if (frames.length === 0) return [];
  let previous = normalize(frames[0].feed);
  const lines: FrameLine[] = [
    {
      v: FRAME_FORMAT_VERSION,
      gamePk,
      kind: "keyframe",
      t: 0,
      feed: previous as unknown as MlbLiveFeed,
    },
  ];
  for (let i = 1; i < frames.length; i++) {
    const current = normalize(frames[i].feed);
    lines.push({
      kind: "patch",
      t: frames[i].t - frames[0].t,
      ops: compare(previous, current) as PatchOp[],
    });
    previous = current;
  }
  return lines;
}

/**
 * Replay the encoded stream and check it rebuilds the frames it came from.
 *
 * The recorder runs this over its own output before writing, so a recording is
 * never published on the strength of the frames in memory alone - only on the
 * bytes that will actually be read back.
 */
export function verifyEncoding(lines: FrameLine[], frames: RecordedFrame[]): string[] {
  const errors: string[] = [];
  if (lines.length !== frames.length) {
    errors.push(`Encoded ${lines.length} lines for ${frames.length} frames`);
    return errors;
  }
  const head = lines[0];
  if (head.kind !== "keyframe") {
    errors.push("First line is not a keyframe");
    return errors;
  }

  // Round-trip through JSON so the check runs against stored bytes, and mutate
  // one document forward rather than keeping every frame alive at once.
  const document = JSON.parse(JSON.stringify(head.feed)) as JsonFeed;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) {
      if (line.kind !== "patch") {
        errors.push(`Line ${i} is not a patch`);
        return errors;
      }
      try {
        // Clone the operations before applying them. `applyPatch` inserts
        // `op.value` by reference, so a later patch mutating that subtree would
        // reach back into the caller's own operations - the very ones the
        // recorder is about to serialize.
        const ops = JSON.parse(JSON.stringify(line.ops)) as Operation[];
        applyPatch(document, ops, false, true);
      } catch (error) {
        errors.push(
          `Patch ${i} failed to apply: ` +
            (error instanceof Error ? error.message : String(error)),
        );
        return errors;
      }
    }
    const rebuilt = frameFingerprint(document as unknown as MlbLiveFeed);
    const expected = frameFingerprint(frames[i].feed);
    if (rebuilt !== expected) {
      errors.push(`Frame ${i} rebuilds as "${rebuilt}", expected "${expected}"`);
      return errors;
    }
  }
  return errors;
}

export function serializeFrames(lines: FrameLine[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

/** MLB's single-letter game types, spelled out. */
const GAME_TYPES: Record<string, string> = {
  R: "Regular Season",
  S: "Spring Training",
  E: "Exhibition",
  A: "All-Star Game",
  F: "Wild Card",
  D: "Division Series",
  L: "League Championship Series",
  W: "World Series",
};

function teamOf(feed: MlbLiveFeed, side: "home" | "away"): RecordingTeam {
  const team = feed.gameData?.teams?.[side];
  return {
    id: team?.id ?? -1,
    abbrev: team?.abbreviation ?? side.toUpperCase(),
    name: team?.name ?? team?.teamName ?? side,
    score: feed.liveData?.linescore?.teams?.[side]?.runs ?? 0,
  };
}

/**
 * The seek index and the scrub bar's labels.
 *
 * Markers are half-inning boundaries and scoring plays - the two granularities
 * the timeline offers. A half marker is placed on the first frame of each half
 * rather than on the break before it, so seeking to "Top 7" lands on baseball
 * rather than on an empty park.
 */
export function buildManifest(options: {
  final: MlbLiveFeed;
  frames: RecordedFrame[];
  source: RecordingSource;
  label?: string;
}): RecordingManifest {
  const { final, frames, source, label } = options;
  const gamePk = final.gamePk ?? final.gameData?.game?.pk ?? 0;
  const base = frames[0]?.t ?? 0;

  const manifestFrames: ManifestFrame[] = frames.map((frame, i) => ({
    i,
    t: frame.t - base,
    inning: frame.meta.inning,
    isTop: frame.meta.isTop,
    atBatIndex: frame.meta.atBatIndex,
    playComplete: frame.meta.playComplete,
    scoring: frame.meta.scoring,
    between: frame.meta.between,
  }));

  const markers: ManifestMarker[] = [];
  let seenHalf = "";
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const linescore = frame.feed.liveData?.linescore;
    const score = {
      home: linescore?.teams?.home?.runs ?? 0,
      away: linescore?.teams?.away?.runs ?? 0,
    };
    const half = `${frame.meta.inning}-${frame.meta.isTop}`;
    if (!frame.meta.between && half !== seenHalf) {
      seenHalf = half;
      markers.push({
        t: frame.t - base,
        kind: "half",
        label: inningLabel(frame.meta.inning, frame.meta.isTop),
        score,
      });
    }
    if (frame.meta.scoring) {
      const play = frame.feed.liveData?.plays?.currentPlay;
      markers.push({
        t: frame.t - base,
        kind: "scoring",
        label: play?.result?.description ?? play?.result?.event ?? "Run scores",
        score,
      });
    }
  }

  const last = frames[frames.length - 1]?.feed ?? final;

  return {
    v: FRAME_FORMAT_VERSION,
    gamePk,
    recordedAt: new Date().toISOString(),
    source,
    game: {
      date: final.gameData?.datetime?.officialDate ?? final.gameData?.datetime?.dateTime ?? "",
      venue: final.gameData?.venue?.name ?? "Ballpark",
      home: teamOf(last, "home"),
      away: teamOf(last, "away"),
      description: GAME_TYPES[final.gameData?.game?.type ?? ""] ?? final.gameData?.game?.type,
      label,
    },
    frameCount: frames.length,
    durationMs: (frames[frames.length - 1]?.t ?? 0) - base,
    frames: manifestFrames,
    markers,
  };
}
