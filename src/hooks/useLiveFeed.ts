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
 * Polls the live feed. The spec's V0 guidance is plain polling, so that is what
 * this does - the interval tightens while the game is actually in progress.
 */
export function useLiveFeed(
  gamePk: string,
  /** Off while a recording is driving the store instead. */
  enabled = true,
) {
  const ingest = useGameStore((s) => s.ingest);
  const failed = useGameStore((s) => s.failed);
  const reset = useGameStore((s) => s.reset);

  useEffect(() => {
    if (!enabled) return;
    reset();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/game/${gamePk}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Feed responded ${res.status}`);
        const feed = (await res.json()) as MlbLiveFeed & { error?: string };
        if (feed.error) throw new Error(feed.error);
        if (cancelled) return;
        failures = 0;
        ingest(feed);
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

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [gamePk, enabled, ingest, failed, reset]);
}
