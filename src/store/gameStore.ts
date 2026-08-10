"use client";

import { create } from "zustand";
import { Director } from "@/lib/anim/director";
import { sfx } from "@/lib/audio/sfx";
import { extractEvents, seedCursor } from "@/lib/game/events";
import { buildHistory, buildSnapshot, inningLabel, ordinalFor } from "@/lib/game/normalize";
import {
  EMPTY_CURSOR,
  type FeedCursor,
  type GameSnapshot,
  type HistoryEntry,
} from "@/lib/game/types";
import type { MlbLiveFeed } from "@/lib/mlb/types";

export type ConnectionState = "connecting" | "live" | "polling" | "error";

interface GameStore {
  director: Director;
  /** What the HUD shows - trails the feed until animations finish. */
  snapshot: GameSnapshot | null;
  pending: GameSnapshot | null;
  /** Everything that has happened, oldest first. */
  history: HistoryEntry[];
  pendingHistory: HistoryEntry[] | null;
  cursor: FeedCursor;
  connection: ConnectionState;
  error: string | null;
  lastUpdate: number;

  reset(): void;
  ingest(feed: MlbLiveFeed): void;
  failed(message: string): void;
  /** Promote pending state once the animation queue has drained. */
  settle(): void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  director: new Director(),
  snapshot: null,
  pending: null,
  history: [],
  pendingHistory: null,
  cursor: EMPTY_CURSOR,
  connection: "connecting",
  error: null,
  lastUpdate: 0,

  reset() {
    const director = new Director();
    // Advance the scoreboard in step with the animation, not with the feed.
    director.onCount = (count) =>
      set((state) =>
        state.snapshot
          ? { snapshot: { ...state.snapshot, count: { ...state.snapshot.count, ...count } } }
          : {},
      );
    director.onSound = (name, intensity) => sfx.play(name, { intensity });
    director.onPlayResolved = (result) =>
      set((state) => {
        if (!state.snapshot) return {};
        const entry: HistoryEntry = {
          id: `${result.atBatIndex}`,
          inning: result.inning,
          isTopInning: result.isTopInning,
          half: inningLabel(result.inning, result.isTopInning),
          event: result.event,
          description: result.description,
          isScoring: result.isScoringPlay,
          score: result.scoreAfter,
        };
        const history = state.history.some((h) => h.id === entry.id)
          ? state.history
          : [...state.history, entry];
        return {
          history,
          snapshot: {
            ...state.snapshot,
            count: { balls: 0, strikes: 0, outs: result.outsAfter },
            score: { ...state.snapshot.score, ...result.scoreAfter },
            lastPlay: result.description || state.snapshot.lastPlay,
            // Show the half-inning the play belongs to, so the scoreboard and
            // the log never describe different parts of the game.
            inning: result.inning || state.snapshot.inning,
            isTopInning: result.inning ? result.isTopInning : state.snapshot.isTopInning,
            inningOrdinal: result.inning
              ? ordinalFor(result.inning)
              : state.snapshot.inningOrdinal,
          },
        };
      });
    set({
      director,
      snapshot: null,
      pending: null,
      history: [],
      pendingHistory: null,
      cursor: EMPTY_CURSOR,
      connection: "connecting",
      error: null,
      lastUpdate: 0,
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
        history: buildHistory(feed),
        pendingHistory: null,
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
        history: buildHistory(feed),
        pendingHistory: null,
        cursor: nextCursor,
        connection: next.status.isLive ? "live" : "polling",
        error: null,
        lastUpdate: Date.now(),
      });
      return;
    }

    set({
      pending: next,
      // Held back with the snapshot so the log never spoils an unplayed animation.
      pendingHistory: buildHistory(feed),
      cursor: nextCursor,
      connection: next.status.isLive ? "live" : "polling",
      error: null,
      lastUpdate: Date.now(),
    });
  },

  settle() {
    const { director, pending, pendingHistory } = get();
    if (!pending || !director.isIdle()) return;
    director.applySnapshot(pending);
    // The feed's log is authoritative and self-heals anything the animation
    // queue had to drop while catching up.
    set({
      snapshot: pending,
      pending: null,
      history: pendingHistory ?? get().history,
      pendingHistory: null,
    });
  },

  failed(message) {
    set({ connection: "error", error: message });
  },
}));
