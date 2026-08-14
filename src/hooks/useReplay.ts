"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "@/store/gameStore";
import type { RecordingManifest } from "@/lib/replay/format";
import { loadRecording, type RecordingPlayer } from "@/lib/replay/source";
import {
  buildPlayTimeline,
  frameAtPlayTime,
  timelineDuration,
  trueTimeline,
} from "@/lib/replay/timeline";

/**
 * Plays a recorded game into the store.
 *
 * The mirror of `useLiveFeed`: same destination, different clock. Where the
 * poller asks the network what is true now, this walks a recording on a virtual
 * clock. Both end at the same `ingest`, so everything downstream - the cursor,
 * the hold, the director queue, the snapshot-promotion rule - runs exactly as
 * it does on a live game.
 */

export type ReplayStatus = "loading" | "ready" | "error";

export interface ReplayControls {
  status: ReplayStatus;
  error: string | null;
  manifest: RecordingManifest | null;
  playing: boolean;
  /** Position on the active time base, in milliseconds. */
  playT: number;
  durationMs: number;
  speed: number;
  trueTiming: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  setSpeed(speed: number): void;
  setTrueTiming(on: boolean): void;
}

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

/**
 * How often the playhead is published to React.
 *
 * The clock itself advances every animation frame, but the readout only shows
 * seconds and the scrub bar is hundreds of pixels wide. Re-rendering the HUD
 * sixty times a second to move either would be pure waste.
 */
const PUBLISH_EVERY_MS = 250;

export function useReplay(
  gamePk: string,
  enabled: boolean,
  startSeconds = 0,
): ReplayControls {
  const ingest = useGameStore((s) => s.ingest);
  const seekStore = useGameStore((s) => s.seek);
  const reset = useGameStore((s) => s.reset);

  const [player, setPlayer] = useState<RecordingPlayer | null>(null);
  const [status, setStatus] = useState<ReplayStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [trueTiming, setTrueTiming] = useState(false);
  const [playT, setPlayT] = useState(0);

  const manifest = player?.manifest ?? null;

  const timeline = useMemo(() => {
    if (!manifest) return [] as number[];
    return trueTiming ? trueTimeline(manifest) : buildPlayTimeline(manifest);
  }, [manifest, trueTiming]);

  const durationMs = useMemo(() => timelineDuration(timeline), [timeline]);

  // The clock lives in refs: it moves every animation frame, and only its
  // rounded position ever reaches React.
  const clock = useRef(0);
  const frame = useRef(-1);
  const published = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    reset();
    loadRecording(gamePk)
      .then((loaded) => {
        if (cancelled) return;
        setPlayer(loaded);
        setError(null);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not load the recording");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [gamePk, enabled, reset]);

  /** Put the world at `t` immediately, as a cut. */
  const seek = useCallback(
    (t: number) => {
      if (!player || timeline.length === 0) return;
      const clamped = Math.max(0, Math.min(t, timelineDuration(timeline)));
      const index = frameAtPlayTime(timeline, clamped);
      clock.current = clamped;
      frame.current = index;
      published.current = clamped;
      setPlayT(clamped);
      seekStore(player.feedAt(index));
    },
    [player, timeline, seekStore],
  );

  // Opening position, and holding place when the time base changes underneath
  // us. `?at=` deep-links into the game; otherwise it opens on the first pitch.
  const opened = useRef<RecordingPlayer | null>(null);
  useEffect(() => {
    if (!player || timeline.length === 0) return;
    if (opened.current !== player) {
      opened.current = player;
      seek(startSeconds * 1000);
      return;
    }
    // True timing was toggled: keep pointing at the same frame, not the same
    // millisecond, so the playhead does not jump to a different moment.
    const at = timeline[Math.max(0, frame.current)] ?? 0;
    clock.current = at;
    published.current = at;
    setPlayT(at);
  }, [player, timeline, startSeconds, seek]);

  // The clock. Wall-clock deltas rather than accumulated frame time, matching
  // the director's convention: a slow or backgrounded tab costs smoothness, not
  // sync. The delta is clamped so returning to a hidden tab does not
  // fast-forward through half the game.
  useEffect(() => {
    if (!enabled || !player || timeline.length === 0) return;
    const end = timelineDuration(timeline);
    let raf = 0;
    let previous = performance.now();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const delta = Math.min(now - previous, 250);
      previous = now;
      if (!playingRef.current) return;

      const next = Math.min(clock.current + delta * speedRef.current, end);
      clock.current = next;

      const index = frameAtPlayTime(timeline, next);
      if (index !== frame.current) {
        frame.current = index;
        // One ingest with the frame the clock has reached, rather than one per
        // frame stepped over. That is precisely a slow poller, which is what
        // `extractEvents` is built to absorb: it walks the cursor forward and
        // emits everything new in a single pass.
        ingest(player.feedAt(index));
      }

      if (Math.abs(next - published.current) >= PUBLISH_EVERY_MS || next >= end) {
        published.current = next;
        setPlayT(next);
      }
      if (next >= end) setPlaying(false);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, player, timeline, ingest]);

  return {
    status,
    error,
    manifest,
    playing,
    playT,
    durationMs,
    speed,
    trueTiming,
    play: useCallback(() => setPlaying(true), []),
    pause: useCallback(() => setPlaying(false), []),
    toggle: useCallback(() => setPlaying((on) => !on), []),
    seek,
    setSpeed,
    setTrueTiming,
  };
}
