"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "@/store/gameStore";
import type { RecordingManifest } from "@/lib/replay/format";
import { loadClip, loadRecording, type RecordingPlayer } from "@/lib/replay/source";
import {
  atBatAtFrame,
  beatAfter,
  buildAtBats,
  buildMarkers,
  stepHalfInning as stepHalf,
  REPLAY_BEATS,
  type AtBat,
  type Beats,
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
  /** True once the last frame has been handed to the ballpark. */
  ended: boolean;
  /**
   * True once the last frame has been handed over *and the ballpark has
   * finished playing it*.
   *
   * Not the same moment as `ended`, and the gap between them is most of what
   * anyone came to see: the frame carrying a home run is ingested the instant
   * the pitch is released, and the swing, the flight, the trot and the
   * celebration all happen afterwards. Anything that puts something on screen
   * when a recording finishes wants this one.
   */
  settled: boolean;
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

/**
 * Where the frames come from: a published recording of a whole game, or one
 * plate appearance cut out of a game's feed on demand.
 *
 * The distinction ends at the load. Both arrive as the same format and are
 * played by the same pump below, which is the point - a clip is a very short
 * recording, not a second playback path.
 */
export type ReplaySource = { kind: "recording" } | { kind: "clip"; atBatIndex: number };

export interface ReplayOptions {
  /** Open on this plate appearance, by position in the game. */
  startAtBat?: number;
  /**
   * Open on this plate appearance, by MLB's own index for it. Takes precedence
   * over `startAtBat`, and is what a shared link carries: an ordinal only means
   * anything against the recording it was counted from, while an `atBatIndex`
   * is the play itself.
   */
  startAtBatIndex?: number;
  source?: ReplaySource;
  /** How long to rest between frames. See `REPLAY_BEATS` / `CLIP_BEATS`. */
  beats?: Beats;
}

export function useReplay(
  gamePk: string,
  enabled: boolean,
  options: ReplayOptions = {},
): ReplayControls {
  const {
    startAtBat = 0,
    startAtBatIndex,
    source = { kind: "recording" },
    beats = REPLAY_BEATS,
  } = options;
  const sourceKind = source.kind;
  const clipAtBat = source.kind === "clip" ? source.atBatIndex : -1;

  const ingest = useGameStore((s) => s.ingest);
  const seekStore = useGameStore((s) => s.seek);
  const reset = useGameStore((s) => s.reset);

  const [player, setPlayer] = useState<RecordingPlayer | null>(null);
  const [status, setStatus] = useState<ReplayStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [settled, setSettled] = useState(false);

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
    const loading =
      sourceKind === "clip" ? loadClip(gamePk, clipAtBat) : loadRecording(gamePk);
    loading
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
  }, [gamePk, enabled, reset, sourceKind, clipAtBat]);

  /** Put the world at a frame immediately, as a cut. */
  const seekFrame = useCallback(
    (target: number) => {
      if (!player) return;
      const index = Math.max(0, Math.min(target, player.frameCount - 1));
      position.current = index;
      setFrame(index);
      setSettled(false);
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

  // Opening position. A shared link deep-links to a plate appearance, either by
  // MLB's index for it or by its position in the game.
  const opened = useRef<RecordingPlayer | null>(null);
  useEffect(() => {
    if (!player || atBats.length === 0 || opened.current === player) return;
    opened.current = player;
    // An index the recording does not contain is a link to a play this tape
    // never had; `findIndex` gives -1 and opening at the top beats opening on
    // nothing.
    const target =
      startAtBatIndex == null
        ? startAtBat
        : Math.max(0, atBats.findIndex((a) => a.atBatIndex === startAtBatIndex));
    seekAtBat(target);
  }, [player, atBats, startAtBat, startAtBatIndex, seekAtBat]);

  /**
   * Advance when the ballpark is ready for more, then rest a beat.
   *
   * Two gates, and neither is a schedule. The first is the director: a frame is
   * only handed over once it has nothing left to animate, so a play can never be
   * interrupted by the one behind it. The second is `beatAfter`, a floor on the
   * space between plays - without it the next pitch begins the instant the last
   * one lands, which reads as a highlight reel rather than a game.
   *
   * A held pitch is the one case where the store is deliberately parked -
   * `settle` refuses to promote a snapshot while a pitch waits on its result -
   * and advancing is exactly what releases it, so it neither counts as busy nor
   * earns a rest.
   */
  const idleSince = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || !player) return;
    const frames = player.manifest.frames;
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { director, pending, cursor } = useGameStore.getState();

      // Out of frames. The last one is still being played - a result frame is
      // handed over when the pitch leaves the hand, and everything worth
      // watching happens after that - so the loop stays up until the ballpark
      // goes quiet rather than declaring the recording over on the spot.
      if (position.current >= player.frameCount - 1) {
        if (playingRef.current) setPlaying(false);
        if (director.isIdle() && pending === null) setSettled(true);
        return;
      }

      if (!playingRef.current) return;

      if (!director.isIdle()) {
        idleSince.current = null;
        return;
      }
      // Let `settle` promote the snapshot first, unless a hold is what is
      // keeping it back - then advancing is the only way forward.
      if (pending !== null && cursor.hold === null) return;

      const now = performance.now();
      if (idleSince.current === null) idleSince.current = now;
      if (
        now - idleSince.current <
        beatAfter(frames[position.current], cursor.hold !== null, beats)
      ) {
        return;
      }

      // Never runs past the end: the guard at the top of the tick owns that.
      const next = position.current + 1;
      idleSince.current = null;
      position.current = next;
      setFrame(next);
      ingest(player.feedAt(next));
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, player, ingest, beats]);

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
    settled,
    play: useCallback(() => setPlaying(true), []),
    pause: useCallback(() => setPlaying(false), []),
    toggle: useCallback(() => setPlaying((on) => !on), []),
    seekAtBat,
    stepAtBat,
    stepHalfInning,
  };
}
