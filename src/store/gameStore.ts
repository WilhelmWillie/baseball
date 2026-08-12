"use client";

import { create } from "zustand";
import { Director } from "@/lib/anim/director";
import { DEFAULT_CAMERA_VIEW, rememberCameraView, type CameraView } from "@/lib/anim/views";
import {
  DEFAULT_SCOREBOARD_MODE,
  rememberScoreboardMode,
  type ScoreboardMode,
} from "@/lib/hud/scoreboard";
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
  /** Which camera the viewer is watching through. Survives a game change. */
  cameraView: CameraView;
  /** How much of the scoreboard is on screen. Also survives a game change. */
  scoreboardMode: ScoreboardMode;

  reset(): void;
  ingest(feed: MlbLiveFeed): void;
  failed(message: string): void;
  setCameraView(view: CameraView): void;
  setScoreboardMode(mode: ScoreboardMode): void;
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
  cameraView: DEFAULT_CAMERA_VIEW,
  scoreboardMode: DEFAULT_SCOREBOARD_MODE,

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
    // Fired as the sides actually change over on the field, part-way through
    // the intermission. Everything here is state the change-over settles by
    // itself; the play log is left alone, because the feed may already have
    // moved on to plays the animation has not reached yet.
    director.onInningChange = (event) =>
      set((state) => {
        if (!state.snapshot) return {};
        const ahead = state.director.pendingSnapshot;
        return {
          snapshot: {
            ...state.snapshot,
            // Whoever the feed says is up now that the inning has turned. It
            // is the same state the field was just rebuilt from, so the
            // scoreboard and the park name the same nine.
            ...(ahead
              ? {
                  batter: ahead.batter,
                  onDeck: ahead.onDeck,
                  defense: ahead.defense,
                  batterStats: ahead.batterStats,
                  pitcherStats: ahead.pitcherStats,
                }
              : {}),
            inning: event.inning,
            isTopInning: event.isTopInning,
            inningOrdinal: ordinalFor(event.inning),
            battingSide: event.isTopInning ? "away" : "home",
            fieldingSide: event.isTopInning ? "home" : "away",
            count: { balls: 0, strikes: 0, outs: 0 },
            runners: {},
          },
        };
      });
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
    // The newest state, handed to the director whether or not it is allowed to
    // show it yet: the side change needs to know who is coming on before the
    // snapshot it comes from is promoted.
    director.pendingSnapshot = next;

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

    // A held pitch means the feed has moved on but the animation has not been
    // allowed to start yet. Promoting the snapshot here would put the result on
    // the scoreboard before anyone has seen the pitch, so it waits with it.
    if (director.isIdle() && events.length === 0 && !nextCursor.hold) {
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
    const { director, pending, pendingHistory, cursor } = get();
    if (!pending || !director.isIdle()) return;
    // Idle only because a pitch is being held back - do not let the world skip
    // ahead to a play it is about to animate.
    if (cursor.hold) return;
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

  setCameraView(view) {
    // Deliberately outside `reset()`: a seat is a preference, not game state.
    set({ cameraView: view });
    rememberCameraView(view);
  },

  setScoreboardMode(mode) {
    // A preference like the seat, and kept for the same reason.
    set({ scoreboardMode: mode });
    rememberScoreboardMode(mode);
  },
}));
