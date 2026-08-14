"use client";

import { useEffect, useRef } from "react";
import { useGameStore } from "@/store/gameStore";
import type { MlbLiveFeed } from "@/lib/mlb/types";

const LIVE_INTERVAL = 5000;
const IDLE_INTERVAL = 15000;
const DEMO_INTERVAL = 1800;
/**
 * While a struck ball is waiting on its result, the field is standing still and
 * every poll is a chance to release it - so chase the result rather than
 * waiting out the normal interval. This costs a few extra requests at the end
 * of an at-bat and nothing else.
 *
 * Two things wait on a result and both have to be chased: the normalizer's hold
 * (`HOLD_TIMEOUT_MS` in `events.ts`) and, once that expires, the director's
 * grace window (`FUSE_GRACE_MS`). Keying this off the hold alone dropped the
 * loop back to the 5s live interval for the whole of the second phase, and a
 * grace window that no fresh read lands inside cannot fuse anything.
 */
const CHASE_INTERVAL = 1500;

/**
 * Polls the live feed. The spec's V0 guidance is plain polling, so that is what
 * this does - the interval tightens while the game is actually in progress.
 */
export function useLiveFeed(gamePk: string, isDemo: boolean, demoOffset = 0, demoQuery = "") {
  const ingest = useGameStore((s) => s.ingest);
  const failed = useGameStore((s) => s.failed);
  const reset = useGameStore((s) => s.reset);
  const demoStart = useRef<number>(0);

  useEffect(() => {
    reset();
    demoStart.current = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const url = isDemo
          ? `/api/game/demo?t=${(demoOffset + (Date.now() - demoStart.current) / 1000).toFixed(1)}${demoQuery}`
          : `/api/game/${gamePk}`;
        const res = await fetch(url, { cache: "no-store" });
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
        const { snapshot, cursor, director } = useGameStore.getState();
        const base = cursor.hold || director.awaitingResult
          ? CHASE_INTERVAL
          : isDemo
            ? DEMO_INTERVAL
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
  }, [gamePk, isDemo, demoOffset, demoQuery, ingest, failed, reset]);
}
