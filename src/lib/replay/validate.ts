import { extractEvents, seedCursor } from "@/lib/game/events";
import { buildSnapshot } from "@/lib/game/normalize";
import { EMPTY_CURSOR, type FeedCursor, type NormalizedEvent } from "@/lib/game/types";
import type { MlbLiveFeed } from "@/lib/mlb/types";
import type { RecordedFrame } from "./reconstruct";

/**
 * Replay a recording through the real normalizer before trusting it.
 *
 * This is what makes a recording a fixture rather than a pile of JSON. It walks
 * the frames exactly the way `gameStore.ingest` does - seed the cursor off the
 * first frame, then `extractEvents` forward - so anything that would break in
 * the ballpark breaks here first, on the machine that made the file.
 */

/** A gap longer than this means frames are missing, not that play was slow. */
const MAX_GAP_MS = 15 * 60 * 1000;

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    frames: number;
    pitches: number;
    playResults: number;
    actions: number;
    inningChanges: number;
    atBats: number;
  };
  finalScore: { home: number; away: number };
  innings: number;
}

export function validateFrames(
  frames: RecordedFrame[],
  final: MlbLiveFeed,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts = {
    frames: frames.length,
    pitches: 0,
    playResults: 0,
    actions: 0,
    inningChanges: 0,
    atBats: 0,
  };

  if (frames.length === 0) {
    return {
      ok: false,
      errors: ["Recording contains no frames"],
      warnings,
      counts,
      finalScore: { home: 0, away: 0 },
      innings: 0,
    };
  }

  const pitchedAtBats = new Set<number>();
  const resolvedAtBats = new Set<number>();
  let cursor: FeedCursor = EMPTY_CURSOR;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    let events: NormalizedEvent[] = [];
    try {
      // Mirrors the store: the first read seeds the cursor at the live edge
      // rather than replaying everything before it.
      if (i === 0) {
        buildSnapshot(frame.feed);
        cursor = seedCursor(frame.feed);
      } else {
        buildSnapshot(frame.feed);
        const result = extractEvents(frame.feed, cursor);
        events = result.events;
        cursor = result.cursor;
      }
    } catch (error) {
      errors.push(
        `Frame ${i} (t=${frame.t}ms) threw during normalization: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      continue;
    }

    for (const event of events) {
      switch (event.type) {
        case "pitch":
          counts.pitches += 1;
          pitchedAtBats.add(event.atBatIndex);
          break;
        case "play_result":
          counts.playResults += 1;
          resolvedAtBats.add(event.atBatIndex);
          break;
        case "action":
          counts.actions += 1;
          break;
        case "inning_change":
          counts.inningChanges += 1;
          break;
      }
    }

    if (i > 0) {
      const gap = frame.t - frames[i - 1].t;
      if (gap < 0) errors.push(`Frame ${i} goes backwards in time (${gap}ms)`);
      if (gap > MAX_GAP_MS) {
        warnings.push(
          `Frame ${i} sits ${Math.round(gap / 60000)} minutes after the one before it`,
        );
      }
    }
  }

  counts.atBats = pitchedAtBats.size;

  // An at-bat the recording pitched but never resolved would animate as a swing
  // and then nothing. The last one is exempt: the walk ends before its result
  // can be read back.
  const unresolved = [...pitchedAtBats].filter((index) => !resolvedAtBats.has(index));
  const lastAtBat = Math.max(...pitchedAtBats, -1);
  const stranded = unresolved.filter((index) => index !== lastAtBat);
  if (stranded.length > 0) {
    warnings.push(
      `${stranded.length} at-bat(s) pitched but never resolved: ${stranded.slice(0, 8).join(", ")}` +
        (stranded.length > 8 ? " …" : ""),
    );
  }

  const lastSnapshot = buildSnapshot(frames[frames.length - 1].feed);
  const expected = {
    home: final.liveData?.linescore?.teams?.home?.runs ?? 0,
    away: final.liveData?.linescore?.teams?.away?.runs ?? 0,
  };
  if (
    lastSnapshot.score.home !== expected.home ||
    lastSnapshot.score.away !== expected.away
  ) {
    errors.push(
      `Final score mismatch: recording ends ${lastSnapshot.score.away}-${lastSnapshot.score.home}, ` +
        `feed says ${expected.away}-${expected.home}`,
    );
  }
  if (!lastSnapshot.status.isFinal) {
    warnings.push("Last frame does not read as a finished game");
  }
  if (counts.pitches === 0) errors.push("Recording contains no pitches");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts,
    finalScore: lastSnapshot.score,
    innings: lastSnapshot.inning,
  };
}
