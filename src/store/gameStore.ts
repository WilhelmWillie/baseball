"use client";

import { create } from "zustand";
import { Director } from "@/lib/anim/director";
import { extractEvents, seedCursor } from "@/lib/game/events";
import { buildSnapshot } from "@/lib/game/normalize";
import { EMPTY_CURSOR, type FeedCursor, type GameSnapshot } from "@/lib/game/types";
import type { MlbLiveFeed } from "@/lib/mlb/types";

export type ConnectionState = "connecting" | "live" | "polling" | "error";

interface GameStore {
  director: Director;
  /** What the HUD shows - trails the feed until animations finish. */
  snapshot: GameSnapshot | null;
  pending: GameSnapshot | null;
  cursor: FeedCursor;
  connection: ConnectionState;
  error: string | null;
  lastUpdate: number;
  cameraFree: boolean;

  reset(): void;
  ingest(feed: MlbLiveFeed): void;
  failed(message: string): void;
  /** Promote pending state once the animation queue has drained. */
  settle(): void;
  setCameraFree(free: boolean): void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  director: new Director(),
  snapshot: null,
  pending: null,
  cursor: EMPTY_CURSOR,
  connection: "connecting",
  error: null,
  lastUpdate: 0,
  cameraFree: false,

  reset() {
    const director = new Director();
    // Advance the scoreboard in step with the animation, not with the feed.
    director.onCount = (count) =>
      set((state) =>
        state.snapshot
          ? { snapshot: { ...state.snapshot, count: { ...state.snapshot.count, ...count } } }
          : {},
      );
    director.onPlayResolved = (result) =>
      set((state) =>
        state.snapshot
          ? {
              snapshot: {
                ...state.snapshot,
                count: { balls: 0, strikes: 0, outs: result.outsAfter },
                score: { ...state.snapshot.score, ...result.scoreAfter },
                lastPlay: result.description || state.snapshot.lastPlay,
              },
            }
          : {},
      );
    set({
      director,
      snapshot: null,
      pending: null,
      cursor: EMPTY_CURSOR,
      connection: "connecting",
      error: null,
      lastUpdate: 0,
      cameraFree: false,
    });
  },

  ingest(feed) {
    const { director, snapshot, cursor } = get();
    const next = buildSnapshot(feed);

    if (!snapshot) {
      // First read: jump straight to the live edge, do not replay the game.
      director.applySnapshot(next);
      set({
        snapshot: next,
        pending: null,
        cursor: seedCursor(feed),
        connection: next.status.isLive ? "live" : "polling",
        error: null,
        lastUpdate: Date.now(),
      });
      return;
    }

    const { events, cursor: nextCursor } = extractEvents(feed, cursor);
    if (events.length > 0) director.enqueue(events);

    if (director.isIdle() && events.length === 0) {
      director.applySnapshot(next);
      set({
        snapshot: next,
        pending: null,
        cursor: nextCursor,
        connection: next.status.isLive ? "live" : "polling",
        error: null,
        lastUpdate: Date.now(),
      });
      return;
    }

    set({
      pending: next,
      cursor: nextCursor,
      connection: next.status.isLive ? "live" : "polling",
      error: null,
      lastUpdate: Date.now(),
    });
  },

  settle() {
    const { director, pending } = get();
    if (!pending || !director.isIdle()) return;
    director.applySnapshot(pending);
    set({ snapshot: pending, pending: null });
  },

  failed(message) {
    set({ connection: "error", error: message });
  },

  setCameraFree(free) {
    get().director.setFreeCamera(free);
    set({ cameraFree: free });
  },
}));
