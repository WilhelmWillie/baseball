"use client";

import type { GameSnapshot } from "@/lib/game/types";

function Diamond({ snapshot }: { snapshot: GameSnapshot }) {
  const on = (base: "first" | "second" | "third") => Boolean(snapshot.runners[base]);
  const cell = (active: boolean) =>
    `h-3 w-3 rotate-45 border-2 ${active ? "border-amber-300 bg-amber-300" : "border-white/35 bg-transparent"}`;
  return (
    <div className="relative h-10 w-10 shrink-0">
      <div className={`absolute left-1/2 top-0 -translate-x-1/2 ${cell(on("second"))}`} />
      <div className={`absolute right-0 top-1/2 -translate-y-1/2 ${cell(on("first"))}`} />
      <div className={`absolute left-0 top-1/2 -translate-y-1/2 ${cell(on("third"))}`} />
    </div>
  );
}

function Outs({ count }: { count: number }) {
  return (
    <div className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 ${i < count ? "bg-red-400" : "bg-white/25"}`}
        />
      ))}
    </div>
  );
}

function TeamRow({
  abbrev,
  color,
  runs,
  batting,
}: {
  abbrev: string;
  color: string;
  runs: number;
  batting: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-4 w-4 border border-black/40"
        style={{ backgroundColor: color }}
      />
      <span className={`w-11 text-sm tracking-widest ${batting ? "text-white" : "text-white/65"}`}>
        {abbrev}
      </span>
      <span className={`w-7 text-right text-lg leading-none ${batting ? "text-white" : "text-white/70"}`}>
        {runs}
      </span>
      {batting && <span className="text-[10px] text-amber-300">●</span>}
    </div>
  );
}

export function Scorebug({ snapshot }: { snapshot: GameSnapshot }) {
  const { teams, score, count, batter, defense } = snapshot;
  const arrow = snapshot.isTopInning ? "▲" : "▼";

  return (
    <div className="pointer-events-none select-none font-mono">
      <div className="w-[280px] border-2 border-black/60 bg-slate-950/80 p-3 shadow-[4px_4px_0_rgba(0,0,0,0.45)] backdrop-blur-[2px]">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <TeamRow
              abbrev={teams.away.abbrev}
              color={teams.away.palette.primary}
              runs={score.away}
              batting={snapshot.battingSide === "away"}
            />
            <TeamRow
              abbrev={teams.home.abbrev}
              color={teams.home.palette.primary}
              runs={score.home}
              batting={snapshot.battingSide === "home"}
            />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="text-xs tracking-widest text-amber-300">
              {arrow} {snapshot.inningOrdinal}
            </div>
            <div className="flex items-center gap-2">
              <Diamond snapshot={snapshot} />
              <div className="flex flex-col items-end gap-1">
                <span className="text-sm text-white">
                  {count.balls}-{count.strikes}
                </span>
                <Outs count={count.outs} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-0.5 border-t border-white/15 pt-2 text-[11px] leading-relaxed">
          <div className="flex justify-between gap-2">
            <span className="text-white/45">AB</span>
            <span className="truncate text-white">{batter?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-white/45">P</span>
            <span className="truncate text-white/80">{defense.pitcher?.name ?? "—"}</span>
          </div>
        </div>
      </div>

      {snapshot.lastPlay && (
        <div className="mt-2 w-[280px] border-2 border-black/60 bg-slate-950/70 px-3 py-2 text-[11px] leading-snug text-white/75 backdrop-blur-[2px]">
          {snapshot.lastPlay}
        </div>
      )}
    </div>
  );
}
