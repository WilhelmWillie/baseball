"use client";

import { useEffect } from "react";
import { useGameStore } from "@/store/gameStore";
import { track, type GameMode } from "./events";

/**
 * Measures how long a viewer actually watches a game and reports it as
 * `game_watch_ended`. Because "watching" here is a live 3D render rather than a
 * video, the duration is derived from engagement: it counts foreground time
 * only, pausing while the tab is hidden (the same signal `useLiveFeed` pauses
 * polling on) and resuming when it returns.
 *
 * The total is flushed both when the tab goes hidden - the dependable signal on
 * mobile, where an unmount or an unload beacon is easily lost when the tab is
 * swiped away - and when the viewer navigates away and this unmounts. A long
 * watch can therefore report more than once with a growing duration; take the
 * largest `durationSeconds` per game as the watch length.
 */
export function useWatchTimer(gamePk: string, mode: GameMode) {
  useEffect(() => {
    let accumulatedMs = 0;
    let segmentStart: number | null =
      typeof document === "undefined" || document.visibilityState === "visible"
        ? Date.now()
        : null;

    const durationSeconds = () => {
      const live = segmentStart !== null ? Date.now() - segmentStart : 0;
      return Math.round((accumulatedMs + live) / 1000);
    };

    const flush = () => {
      const seconds = durationSeconds();
      if (seconds <= 0) return;
      track("game_watch_ended", {
        gamePk,
        mode,
        durationSeconds: seconds,
        reachedFinal: useGameStore.getState().snapshot?.status.isFinal ?? false,
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (segmentStart !== null) {
          accumulatedMs += Date.now() - segmentStart;
          segmentStart = null;
        }
        flush();
      } else if (segmentStart === null) {
        segmentStart = Date.now();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (segmentStart !== null) {
        accumulatedMs += Date.now() - segmentStart;
        segmentStart = null;
      }
      flush();
    };
  }, [gamePk, mode]);
}
