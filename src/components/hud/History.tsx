"use client";

import { useMemo, useState } from "react";
import type { GameSnapshot, HistoryEntry } from "@/lib/game/types";

/**
 * The last play, which expands into the full log on hover. Clicking pins it
 * open, since hover is not available on touch.
 *
 * Hover is tracked from pointer events and only for a real mouse: a touch
 * fires an emulated enter that never gets a matching leave, so counting a tap
 * as hovering would hold the log open no matter how often it was tapped shut.
 */
export function History({
  history,
  snapshot,
  gamePk,
}: {
  history: HistoryEntry[];
  snapshot: GameSnapshot;
  /** Which game these plays belong to, so a row can link to its clip. */
  gamePk: string;
}) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;

  // Newest first, grouped by half-inning.
  const groups = useMemo(() => {
    const out: Array<{ half: string; isTopInning: boolean; entries: HistoryEntry[] }> = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      const last = out[out.length - 1];
      if (last && last.half === entry.half) last.entries.push(entry);
      else out.push({ half: entry.half, isTopInning: entry.isTopInning, entries: [entry] });
    }
    return out;
  }, [history]);

  const latest = history[history.length - 1];
  if (!latest && !open) return null;

  return (
    <div
      className="w-full sm:w-[300px]"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHovered(false);
      }}
    >
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        className={`w-full border-2 px-3.5 py-2.5 text-left text-[11px] leading-snug backdrop-blur-[2px] transition-colors lip-float ${
          open
            ? "rounded-t-2xl border-grass/50 bg-card text-bark"
            : "rounded-2xl border-grass-deep/12 bg-card/95 text-bark hover:border-grass/50"
        }`}
      >
        <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-bark-soft">
          <span className="font-display text-xs text-grass-deep">
            {open ? "Game log" : "Last play"}
          </span>
          {/* Hovering is not a thing on a phone, so the hint has to differ. */}
          <span className="hidden font-normal sm:inline">
            {pinned ? "click to close" : open ? "click to pin" : "hover for the log"}
          </span>
          <span className="font-normal sm:hidden">{open ? "tap to close" : "tap for the log"}</span>
        </div>
        {!open && (latest?.description ?? snapshot.lastPlay ?? "—")}
        {open && (
          <span className="text-[10px] text-bark-soft">
            {history.length} {history.length === 1 ? "play" : "plays"} so far
          </span>
        )}
      </button>

      {open && (
        <div className="max-h-[52vh] overflow-y-auto rounded-b-2xl border-2 border-t-0 border-grass/50 bg-card/97 backdrop-blur-[2px] lip-float">
          {groups.length === 0 && (
            <div className="px-3.5 py-4 text-[11px] text-bark-soft">Nothing has happened yet.</div>
          )}
          {groups.map((group) => (
            <div key={group.half}>
              <div className="sticky top-0 flex items-center justify-between bg-grass-mist px-3.5 py-1.5 text-[10px] font-bold text-grass-deep">
                <span>{group.half}</span>
                <span className="text-bark-soft">
                  {snapshot.teams.away.abbrev} {group.entries[0].score.away}–
                  {group.entries[0].score.home} {snapshot.teams.home.abbrev}
                </span>
              </div>
              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-start gap-2 border-b border-bark/8 px-3.5 py-2 text-[11px] leading-snug ${
                    entry.isScoring ? "bg-grass-mist/60 text-bark" : "text-bark-soft"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`mr-1.5 text-[10px] font-bold ${
                        entry.isScoring ? "text-grass" : "text-bark-soft/70"
                      }`}
                    >
                      {entry.event}
                    </span>
                    {entry.description}
                  </span>
                  {/* A plain anchor rather than `next/link`: prefetching a
                      clip would reconstruct the game server-side for every
                      play the log happens to show. The clip replaces this tab
                      and links back to the full game. */}
                  <a
                    href={`/clip/${gamePk}/${entry.id}`}
                    title="Watch just this play"
                    className="mt-px shrink-0 rounded-full border border-grass/40 px-2 py-0.5 text-[10px] font-bold text-grass-deep transition-colors hover:bg-grass hover:text-card"
                  >
                    Clip
                  </a>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
