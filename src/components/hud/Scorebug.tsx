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

/** "1-3" today, plus anything worth calling out from it. */
function batterSummary(line: GameSnapshot["batterStats"]): string | null {
  if (!line) return null;
  const extras: string[] = [];
  if (line.homeRuns > 0) extras.push(`${line.homeRuns} HR`);
  if (line.rbi > 0) extras.push(`${line.rbi} RBI`);
  if (line.walks > 0) extras.push(`${line.walks} BB`);
  if (line.strikeouts > 0) extras.push(`${line.strikeouts} K`);
  const today = `${line.hits}-${line.atBats}`;
  return extras.length ? `${today} · ${extras.join(" · ")}` : today;
}

function pitcherSummary(line: GameSnapshot["pitcherStats"]): string | null {
  if (!line) return null;
  const parts = [`${line.pitches} P`];
  if (line.inningsPitched) parts.push(`${line.inningsPitched} IP`);
  if (line.strikeouts > 0) parts.push(`${line.strikeouts} K`);
  return parts.join(" · ");
}

export function Scorebug({ snapshot }: { snapshot: GameSnapshot }) {
  const { teams, score, count, batter, defense, conditions } = snapshot;
  const batterLine = batterSummary(snapshot.batterStats);
  const pitcherLine = pitcherSummary(snapshot.pitcherStats);
  const arrow = snapshot.isTopInning ? "▲" : "▼";

  return (
    <div className="select-none font-mono">
      <div className="pointer-events-none w-[212px] border-2 border-black/60 bg-slate-950/80 p-2 shadow-[4px_4px_0_rgba(0,0,0,0.45)] backdrop-blur-[2px] sm:w-[300px] sm:p-3">
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

        <div className="mt-2 space-y-1 border-t border-white/15 pt-1.5 text-[10px] leading-snug sm:mt-3 sm:space-y-1.5 sm:pt-2 sm:text-[11px]">
          <div>
            <div className="flex justify-between gap-2">
              <span className="text-white/45">AB</span>
              <span className="truncate text-white">{batter?.name ?? "—"}</span>
            </div>
            {(batterLine || snapshot.batterStats?.avg) && (
              <div className="flex justify-between gap-2 text-[10px] text-white/50">
                <span>{snapshot.batterStats?.avg ?? ""}</span>
                <span className="truncate">{batterLine}</span>
              </div>
            )}
          </div>
          <div>
            <div className="flex justify-between gap-2">
              <span className="text-white/45">P</span>
              <span className="truncate text-white/80">{defense.pitcher?.name ?? "—"}</span>
            </div>
            {pitcherLine && (
              <div className="flex justify-between gap-2 text-[10px] text-white/50">
                <span>{snapshot.pitcherStats?.era ? `${snapshot.pitcherStats.era} ERA` : ""}</span>
                <span className="truncate">{pitcherLine}</span>
              </div>
            )}
          </div>
        </div>

        {/* What the park is like - and what lit the scene. Dropped on a phone,
            where the screen is better spent on the game than on the weather. */}
        <div className="mt-2 hidden items-center gap-2 border-t border-white/10 pt-2 text-[10px] tracking-wide text-white/45 sm:flex">
          <span className="text-white/70">{conditions.condition}</span>
          {conditions.temp && <span>{conditions.temp}°</span>}
          {conditions.windLabel && <span className="truncate">{conditions.windLabel}</span>}
        </div>
      </div>
    </div>
  );
}
