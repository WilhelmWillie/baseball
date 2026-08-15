"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "@/store/gameStore";
import type { RecordingManifest } from "@/lib/replay/format";
import { loadRecording, type RecordingPlayer } from "@/lib/replay/source";
import {
  atBatAtFrame,
  buildAtBats,
  buildMarkers,
  stepHalfInning as stepHalf,
  type AtBat,
  type TimelineMarker,
} from "@/lib/replay/timeline";

/**
 * Plays a recorded game into the store, one frame at a time.
 *
 * The mirror of `useLiveFeed`: same destination, no network. What it does *not*
 * have is a clock. An earlier version advanced a virtual clock and pushed
 * whatever frame that clock had reached, which meant a long animation could be
 * interrupted by the next one - a home run's trot and celebration run past four
 * seconds, and MLB's own gap to the next pitch is shorter than that.
 *
 * Instead the recording waits for the ballpark. A frame is handed to `ingest`
 * only once the director has nothing left to animate, so every play gets to
 * finish and the pacing is whatever the animation actually needs. The
 * animations already carry their own trailing hold - `compileResult` keeps 4.2s
 * after a home run "long enough after the call for the beam-out to finish
 * playing" - so nothing extra is needed to stop it feeling rushed.
 */

export type ReplayStatus = "loading" | "ready" | "error";

export interface ReplayControls {
  status: ReplayStatus;
  error: string | null;
  manifest: RecordingManifest | null;
  playing: boolean;
  /** Position in the frame stream. */
  frame: number;
  frameCount: number;
  atBats: AtBat[];
  markers: TimelineMarker[];
  /** Index into `atBats` of the plate appearance on screen. */
  atBat: number;
  /** True once the last frame has been played. */
  ended: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Jump to a plate appearance by index, resetting the world to that moment. */
  seekAtBat(index: number): void;
  /** Step by plate appearance: -1 back, +1 forward. */
  stepAtBat(delta: number): void;
  /** Step by half-inning. */
  stepHalfInning(delta: number): void;
}

export function useReplay(
  gamePk: string,
  enabled: boolean,
  startAtBat = 0,
): ReplayControls {
  const ingest = useGameStore((s) => s.ingest);
  const seekStore = useGameStore((s) => s.seek);
  const reset = useGameStore((s) => s.reset);

  const [player, setPlayer] = useState<RecordingPlayer | null>(null);
  const [status, setStatus] = useState<ReplayStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);

  const manifest = player?.manifest ?? null;
  const atBats = useMemo(() => (manifest ? buildAtBats(manifest) : []), [manifest]);
  const markers = useMemo(() => (manifest ? buildMarkers(manifest) : []), [manifest]);
  const frameCount = player?.frameCount ?? 0;

  const position = useRef(0);
  const playingRef = useRef(true);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

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

  /** Put the world at a frame immediately, as a cut. */
  const seekFrame = useCallback(
    (target: number) => {
      if (!player) return;
      const index = Math.max(0, Math.min(target, player.frameCount - 1));
      position.current = index;
      setFrame(index);
      seekStore(player.feedAt(index));
    },
    [player, seekStore],
  );

  const seekAtBat = useCallback(
    (index: number) => {
      if (atBats.length === 0) return;
      const clamped = Math.max(0, Math.min(index, atBats.length - 1));
      seekFrame(atBats[clamped].frame);
    },
    [atBats, seekFrame],
  );

  // Opening position. `?at=` deep-links to a plate appearance.
  const opened = useRef<RecordingPlayer | null>(null);
  useEffect(() => {
    if (!player || atBats.length === 0 || opened.current === player) return;
    opened.current = player;
    seekAtBat(startAtBat);
  }, [player, atBats, startAtBat, seekAtBat]);

  /**
   * Advance when the ballpark is ready for more.
   *
   * Polled on an animation frame, but nothing here reads the clock: the only
   * question asked is whether the director has drained. A held pitch is the one
   * case where the store is deliberately parked - `settle` refuses to promote a
   * snapshot while a pitch is waiting on its result - and advancing is exactly
   * what releases it, so it does not count as being busy.
   */
  useEffect(() => {
    if (!enabled || !player) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!playingRef.current) return;

      const { director, pending, cursor } = useGameStore.getState();
      if (!director.isIdle()) return;
      if (pending !== null && cursor.hold === null) return;

      const next = position.current + 1;
      if (next >= player.frameCount) {
        setPlaying(false);
        return;
      }
      position.current = next;
      setFrame(next);
      ingest(player.feedAt(next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, player, ingest]);

  const atBat = useMemo(() => atBatAtFrame(atBats, frame), [atBats, frame]);

  const stepAtBat = useCallback(
    (delta: number) => {
      // Stepping back from mid-at-bat restarts the one on screen first, which
      // is what a viewer means by "back" when a play has already run.
      const target = delta < 0 && frame > atBats[atBat]?.frame ? atBat : atBat + delta;
      seekAtBat(target);
    },
    [atBat, atBats, frame, seekAtBat],
  );

  const stepHalfInning = useCallback(
    (delta: number) => seekAtBat(stepHalf(atBats, atBat, delta)),
    [atBats, atBat, seekAtBat],
  );

  return {
    status,
    error,
    manifest,
    playing,
    frame,
    frameCount,
    atBats,
    markers,
    atBat,
    ended: frameCount > 0 && frame >= frameCount - 1,
    play: useCallback(() => setPlaying(true), []),
    pause: useCallback(() => setPlaying(false), []),
    toggle: useCallback(() => setPlaying((on) => !on), []),
    seekAtBat,
    stepAtBat,
    stepHalfInning,
  };
}
