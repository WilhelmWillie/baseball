import type { ManifestFrame, ManifestMarker, RecordingManifest } from "./format";

/**
 * Turning a recording's real timing into something watchable.
 *
 * Recordings store only real time. A nine-inning game is a little over three
 * hours, and most of that is a pitcher standing on the mound: ~20s between
 * pitches, longer between at-bats, minutes for a pitching change. Playback
 * therefore builds a second time base at load, clamping every gap to a ceiling.
 * Nothing is baked into the file, so the policy can change without re-recording
 * and the true timing is always one remap away.
 */

export interface PacingPolicy {
  /** Between pitches within an at-bat. */
  pitchGapMs: number;
  /** From a completed play to whatever comes next. */
  playGapMs: number;
  /** Across the half-inning break, which the intermission card holds through. */
  breakGapMs: number;
}

/**
 * Ceilings are set from what the director actually needs, with headroom.
 *
 * A pitch compiles to `plateTime + tail` - about 2.1s, or 2.9s when a foul
 * extends the tail - so 4s leaves better than a second spare. A play is the
 * expensive one: a home-run trot is four bases at `TROT_PER_BASE`, near 14s
 * before the celebration, which is why that gap keeps 15s. A half-inning break
 * only needs `INNING_BEAM_OUT + INNING_HOLD`, under 3s, but is left long enough
 * for the intermission card to read as a break rather than a stutter.
 *
 * Under-provisioning does not clip an animation - the store holds `pending`
 * until the queue drains - it backs the queue up, and past fourteen events the
 * director starts dropping pitches. The headroom is what keeps it clear.
 */
export const DEFAULT_PACING: PacingPolicy = {
  pitchGapMs: 4000,
  playGapMs: 15000,
  breakGapMs: 15000,
};

function capFor(previous: ManifestFrame, policy: PacingPolicy): number {
  if (previous.between) return policy.breakGapMs;
  if (previous.playComplete) return policy.playGapMs;
  return policy.pitchGapMs;
}

/**
 * Play-time for each frame, in milliseconds.
 *
 * Gaps shorter than their ceiling are left alone, which matters: the ~1.5s
 * between a pitch and its published result is the lag the renderer's hold logic
 * exists to absorb, and compressing it would flatten the thing that makes an
 * at-bat animate as one motion.
 */
export function buildPlayTimeline(
  manifest: RecordingManifest,
  policy: PacingPolicy = DEFAULT_PACING,
): number[] {
  const frames = manifest.frames;
  const times = new Array<number>(frames.length);
  times[0] = 0;
  for (let i = 1; i < frames.length; i++) {
    const real = Math.max(0, frames[i].t - frames[i - 1].t);
    times[i] = times[i - 1] + Math.min(real, capFor(frames[i - 1], policy));
  }
  return times;
}

/** Real recorded time, for the "true timing" toggle. */
export function trueTimeline(manifest: RecordingManifest): number[] {
  const base = manifest.frames[0]?.t ?? 0;
  return manifest.frames.map((frame) => frame.t - base);
}

export function timelineDuration(timeline: number[]): number {
  return timeline[timeline.length - 1] ?? 0;
}

/** The last frame at or before `t`. */
export function frameAtPlayTime(timeline: number[], t: number): number {
  if (timeline.length === 0) return 0;
  let low = 0;
  let high = timeline.length - 1;
  if (t <= timeline[0]) return 0;
  if (t >= timeline[high]) return high;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (timeline[mid] <= t) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Markers carry recorded times; the scrub bar needs them on the same base. */
export function remapMarkers(
  manifest: RecordingManifest,
  timeline: number[],
): ManifestMarker[] {
  const base = manifest.frames[0]?.t ?? 0;
  const realTimes = manifest.frames.map((frame) => frame.t - base);
  return manifest.markers.map((marker) => ({
    ...marker,
    t: timeline[frameAtPlayTime(realTimes, marker.t)] ?? 0,
  }));
}

/** `1:04:12`, or `4:07` for anything under an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
