"use client";

import { useMemo, useState } from "react";
import type { GameSnapshot, HistoryEntry } from "@/lib/game/types";

/**
 * The last play, which expands into the full log on hover. Clicking pins it
 * open, since hover is not available on touch.
 */
export function History({
  history,
  snapshot,
}: {
  history: HistoryEntry[];
  snapshot: GameSnapshot;
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
      className="w-full font-mono sm:w-[300px]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        className={`w-full border-2 px-3 py-2 text-left text-[11px] leading-snug backdrop-blur-[2px] transition-colors ${
          open
            ? "border-amber-300/70 bg-slate-950/90 text-white"
            : "border-black/60 bg-slate-950/75 text-white/75 hover:border-white/40"
        }`}
      >
        <div className="mb-1 flex items-center justify-between text-[9px] tracking-[0.2em] text-white/40">
          <span>{open ? "GAME LOG" : "LAST PLAY"}</span>
          {/* Hovering is not a thing on a phone, so the hint has to differ. */}
          <span className="hidden sm:inline">
            {pinned ? "CLICK TO CLOSE" : open ? "CLICK TO PIN" : "HOVER FOR LOG"}
          </span>
          <span className="sm:hidden">{open ? "TAP TO CLOSE" : "TAP FOR LOG"}</span>
        </div>
        {!open && (latest?.description ?? snapshot.lastPlay ?? "—")}
        {open && (
          <span className="text-[10px] text-white/45">
            {history.length} {history.length === 1 ? "play" : "plays"}
          </span>
        )}
      </button>

      {open && (
        <div className="max-h-[52vh] overflow-y-auto border-2 border-t-0 border-amber-300/70 bg-slate-950/92 backdrop-blur-[2px]">
          {groups.length === 0 && (
            <div className="px-3 py-4 text-[11px] text-white/45">
              Nothing has happened yet.
            </div>
          )}
          {groups.map((group) => (
            <div key={group.half}>
              <div className="sticky top-0 flex items-center justify-between bg-slate-900/95 px-3 py-1 text-[9px] tracking-[0.2em] text-amber-300">
                <span>{group.half.toUpperCase()}</span>
                <span className="text-white/35">
                  {snapshot.teams.away.abbrev} {group.entries[0].score.away}–
                  {group.entries[0].score.home} {snapshot.teams.home.abbrev}
                </span>
              </div>
              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`border-b border-white/5 px-3 py-1.5 text-[11px] leading-snug ${
                    entry.isScoring ? "bg-amber-300/10 text-amber-100" : "text-white/75"
                  }`}
                >
                  <span
                    className={`mr-1.5 text-[9px] tracking-wider ${
                      entry.isScoring ? "text-amber-300" : "text-white/35"
                    }`}
                  >
                    {entry.event.toUpperCase()}
                  </span>
                  {entry.description}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
