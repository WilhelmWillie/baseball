import { inningLabel } from "@/lib/game/normalize";
import type { ManifestFrame, RecordingManifest } from "./format";

/**
 * The shape of a recording, as something to navigate.
 *
 * Playback has no clock. A recording stores real timestamps and they are worth
 * keeping - they are what the game actually did - but replay ignores them
 * entirely, because a clock is what cut the celebrations short: it advanced
 * whether or not the director had finished, and a home-run trot with its
 * four-second hold does not fit in the gap MLB left before the next pitch.
 *
 * So the unit here is the **plate appearance**, not the second. Everything
 * below indexes frames by at-bat and half-inning so the transport can step and
 * scrub in those terms.
 */

/**
 * How long the ballpark rests after finishing an animation, before the next
 * frame is handed over.
 *
 * This is a floor on the space between plays, not a schedule: it can only ever
 * make playback wait longer, never cut an animation short. Without it the next
 * pitch begins the instant the last one lands, which reads as a highlight reel
 * rather than a game — real ones leave about twenty seconds between pitches.
 *
 * A play already carries its own trailing hold inside the animation
 * (`compileResult` keeps 2.4s, or 4.2s on a home run), which is why the beat
 * after one is shorter than the beat after a pitch rather than longer.
 */
export interface Beats {
  pitch: number;
  play: number;
  between: number;
}

export const REPLAY_BEATS: Beats = {
  /**
   * Between pitches of the same plate appearance, and before the first one.
   *
   * The dominant number here: a plate appearance spends most of its time
   * waiting on this, so it is the dial to turn if the pacing is wrong. A real
   * game leaves about twenty seconds, which is far more than is worth watching,
   * but the first two passes at this were still brisk enough to read as a reel.
   */
  pitch: 5000,
  /** After a completed play, on top of the animation's own hold. */
  play: 3000,
  /** Across the half-inning break, so the intermission card can be read. */
  between: 5000,
};

/**
 * How a single play is paced when it is the whole thing being watched.
 *
 * A clip opens on the set frame and someone has followed a link to get there,
 * so the five seconds a game leaves between pitches is dead air rather than
 * atmosphere - they came for the swing. Tightened rather than removed: the gap
 * is what makes a plate appearance read as pitches instead of a stutter, and
 * the animations still finish in their own time either way.
 */
export const CLIP_BEATS: Beats = {
  pitch: 2200,
  play: 1200,
  between: 0,
};

/**
 * The rest owed after the frame currently on screen.
 *
 * A held pitch is the exception: the store is parked waiting on the result, and
 * the whole point of the hold is that the pitch and its outcome animate as one
 * motion. Resting there would pull them apart.
 */
export function beatAfter(
  frame: ManifestFrame | undefined,
  held: boolean,
  beats: Beats = REPLAY_BEATS,
): number {
  if (held) return 0;
  if (!frame) return beats.pitch;
  if (frame.between) return beats.between;
  if (frame.playComplete) return beats.play;
  return beats.pitch;
}

/** One plate appearance, as somewhere you can jump to. */
export interface AtBat {
  /** Where this plate appearance starts, as an index into `manifest.frames`. */
  frame: number;
  /** MLB's own index for the at-bat. */
  atBatIndex: number;
  inning: number;
  isTop: boolean;
  /** 1-based position in the game, for "42 of 99". */
  ordinal: number;
  /** True when a run scored on it. */
  scoring: boolean;
}

/** A tick on the scrub bar. */
export interface TimelineMarker {
  frame: number;
  kind: "half" | "scoring";
  label: string;
}

/**
 * Every plate appearance in the game, in order.
 *
 * Between-innings frames belong to no at-bat and are skipped, so seeking never
 * lands on an empty park.
 */
export function buildAtBats(manifest: RecordingManifest): AtBat[] {
  const frames = manifest.frames;
  const atBats: AtBat[] = [];
  let key = "";

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.between) continue;
    const next = `${frame.inning}-${frame.isTop}-${frame.atBatIndex}`;
    if (next === key) {
      if (frame.scoring) atBats[atBats.length - 1].scoring = true;
      continue;
    }
    key = next;
    atBats.push({
      frame: i,
      atBatIndex: frame.atBatIndex,
      inning: frame.inning,
      isTop: frame.isTop,
      ordinal: atBats.length + 1,
      scoring: frame.scoring,
    });
  }
  return atBats;
}

/**
 * Half-inning starts and scoring plays, placed on frames.
 *
 * The recorder writes markers against the same `t` values it writes on frames,
 * so they line up exactly; matching on that is what turns a stored time back
 * into a position.
 */
export function buildMarkers(manifest: RecordingManifest): TimelineMarker[] {
  const byTime = new Map<number, RecordingManifest["markers"]>();
  for (const marker of manifest.markers) {
    const at = byTime.get(marker.t);
    if (at) at.push(marker);
    else byTime.set(marker.t, [marker]);
  }

  const markers: TimelineMarker[] = [];
  manifest.frames.forEach((frame, i) => {
    for (const marker of byTime.get(frame.t) ?? []) {
      markers.push({ frame: i, kind: marker.kind, label: marker.label });
    }
  });
  return markers;
}

/** The at-bat a frame belongs to - the last one starting at or before it. */
export function atBatAtFrame(atBats: AtBat[], frame: number): number {
  if (atBats.length === 0) return 0;
  let low = 0;
  let high = atBats.length - 1;
  if (frame <= atBats[0].frame) return 0;
  if (frame >= atBats[high].frame) return high;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (atBats[mid].frame <= frame) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The first at-bat of the half-inning `delta` half-innings away. */
export function stepHalfInning(atBats: AtBat[], from: number, delta: number): number {
  const here = atBats[from];
  if (!here) return from;
  const sameHalf = (a: AtBat) => a.inning === here.inning && a.isTop === here.isTop;

  if (delta < 0) {
    // Back to the top of this half first; only then to the previous one.
    let start = from;
    while (start > 0 && sameHalf(atBats[start - 1])) start -= 1;
    if (start < from) return start;
    if (start === 0) return 0;
    const previous = atBats[start - 1];
    let back = start - 1;
    while (back > 0 && atBats[back - 1].inning === previous.inning && atBats[back - 1].isTop === previous.isTop) {
      back -= 1;
    }
    return back;
  }

  let forward = from;
  while (forward < atBats.length - 1 && sameHalf(atBats[forward + 1])) forward += 1;
  return Math.min(forward + 1, atBats.length - 1);
}

/** "Top 7th", for the transport's readout. */
export function halfLabel(atBat: AtBat | undefined): string {
  if (!atBat) return "";
  return inningLabel(atBat.inning, atBat.isTop);
}
