"use client";

import { useEffect } from "react";
import { useGameStore } from "@/store/gameStore";
import type { MlbLiveFeed } from "@/lib/mlb/types";

const LIVE_INTERVAL = 5000;
const IDLE_INTERVAL = 15000;
/**
 * While a pitch is held waiting on its result, the field is standing still and
 * every poll is a chance to release it - so chase the result rather than
 * waiting out the normal interval. Bounded by the hold timeout in `events.ts`,
 * this costs a few extra requests at the end of an at-bat and nothing else.
 */
const CHASE_INTERVAL = 1500;

/**
 * A hidden tab pauses the animation engine (it runs off `requestAnimationFrame`)
 * while polling keeps filling the queue, so returning to a tab that was away for
 * more than a moment means a backlog to replay. Past this long hidden, cut
 * straight to the live edge instead of animating through everything missed; a
 * short blip stays under it and replays normally.
 */
const RESYNC_AFTER_HIDDEN_MS = 10000;

/**
 * Polls the live feed. The spec's V0 guidance is plain polling, so that is what
 * this does - the interval tightens while the game is actually in progress.
 */
export function useLiveFeed(
  gamePk: string,
  /** Off while a recording is driving the store instead. */
  enabled = true,
) {
  const ingest = useGameStore((s) => s.ingest);
  const seek = useGameStore((s) => s.seek);
  const failed = useGameStore((s) => s.failed);
  const reset = useGameStore((s) => s.reset);

  useEffect(() => {
    if (!enabled) return;
    reset();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    // When the fetched feed should cut straight to the live edge rather than
    // animate through the backlog - set on returning from a long time hidden.
    const poll = async (resync = false) => {
      try {
        const res = await fetch(`/api/game/${gamePk}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Feed responded ${res.status}`);
        const feed = (await res.json()) as MlbLiveFeed & { error?: string };
        if (feed.error) throw new Error(feed.error);
        if (cancelled) return;
        failures = 0;
        if (resync) seek(feed);
        else ingest(feed);
      } catch (error) {
        if (cancelled) return;
        failures += 1;
        if (failures >= 2) {
          failed(error instanceof Error ? error.message : "Feed unavailable");
        }
      } finally {
        if (cancelled) return;
        const { snapshot, cursor } = useGameStore.getState();
        const base = cursor.hold
          ? CHASE_INTERVAL
          : snapshot?.status.isLive
            ? LIVE_INTERVAL
            : IDLE_INTERVAL;
        // Back off when the feed is unhappy.
        const delay = base * Math.min(4, 1 + failures);
        timer = setTimeout(poll, delay);
      }
    };

    poll();

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      // Back in view: catch up now rather than waiting out the throttled timer.
      // If the tab was hidden long enough for a backlog to build, cut to the
      // live edge instead of replaying everything the animation queue missed.
      const away = hiddenAt == null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      clearTimeout(timer);
      poll(away > RESYNC_AFTER_HIDDEN_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gamePk, enabled, ingest, seek, failed, reset]);
}
