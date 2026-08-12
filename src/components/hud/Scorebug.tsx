"use client";

import type { ScoreboardMode } from "@/lib/hud/scoreboard";
import type { GameSnapshot } from "@/lib/game/types";

function Diamond({ snapshot, compact = false }: { snapshot: GameSnapshot; compact?: boolean }) {
  const on = (base: "first" | "second" | "third") => Boolean(snapshot.runners[base]);
  const cell = (active: boolean) =>
    `${compact ? "h-2.5 w-2.5" : "h-3 w-3"} rotate-45 rounded-[3px] border-2 transition-colors ${
      active ? "border-grass bg-grass" : "border-bark/25 bg-transparent"
    }`;
  return (
    <div className={`relative shrink-0 ${compact ? "h-8 w-8" : "h-10 w-10"}`}>
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
          className={`h-2.5 w-2.5 rounded-full ${i < count ? "bg-clay" : "bg-bark/15"}`}
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
  compact = false,
}: {
  abbrev: string;
  color: string;
  runs: number;
  batting: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center ${compact ? "gap-1.5" : "gap-2"}`}>
      <span
        className={`inline-block rounded-full ring-2 ring-card ${compact ? "h-3.5 w-3.5" : "h-5 w-5"}`}
        style={{ backgroundColor: color }}
      />
      <span
        className={`font-display font-extrabold leading-none ${
          compact ? "w-9 text-xs" : "w-11 text-base"
        } ${batting ? "text-bark" : "text-bark-soft"}`}
      >
        {abbrev}
      </span>
      <span
        className={`text-right font-display font-extrabold leading-none ${
          compact ? "w-5 text-base" : "w-7 text-xl"
        } ${batting ? "text-grass-deep" : "text-bark-soft"}`}
      >
        {runs}
      </span>
      {!compact && (
        <span className={`text-[10px] ${batting ? "text-grass" : "text-transparent"}`}>●</span>
      )}
    </div>
  );
}

/**
 * The control that folds the panel down. It cycles rather than toggles, so the
 * whole range is reachable from the panel itself; hidden is the one state it
 * cannot come back from, which is what the picker in the controls is for.
 */
function CollapseButton({ mode, onCycle }: { mode: ScoreboardMode; onCycle: () => void }) {
  const minimizing = mode === "full";
  return (
    <button
      type="button"
      onClick={onCycle}
      title={minimizing ? "Minimize the scoreboard" : "Hide the scoreboard"}
      aria-label={minimizing ? "Minimize the scoreboard" : "Hide the scoreboard"}
      className="pointer-events-auto absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-grass-deep/15 bg-card text-[11px] font-extrabold leading-none text-bark-soft transition-colors hover:border-grass/60 hover:text-grass-deep lip-float"
    >
      {minimizing ? "–" : "×"}
    </button>
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

export function Scorebug({
  snapshot,
  mode,
  onCycle,
}: {
  snapshot: GameSnapshot;
  /** `hidden` never reaches here - the viewer stops rendering the panel. */
  mode: Exclude<ScoreboardMode, "hidden">;
  onCycle: () => void;
}) {
  const { teams, score, count, batter, defense, conditions } = snapshot;
  const batterLine = batterSummary(snapshot.batterStats);
  const pitcherLine = pitcherSummary(snapshot.pitcherStats);
  const arrow = snapshot.isTopInning ? "▲" : "▼";

  // Minimized: the four things you cannot follow a game without - who is
  // winning, which half of which inning it is, how many are out and who is on.
  // Everything else on the full card is context, and context is what someone
  // folding the panel down is asking to be rid of.
  if (mode === "mini") {
    return (
      <div className="relative w-fit select-none">
        <div className="pointer-events-none flex items-center gap-2.5 rounded-2xl border-2 border-grass-deep/12 bg-card/95 py-2 pl-3 pr-3.5 backdrop-blur-[2px] lip-float">
          <div className="space-y-1">
            <TeamRow
              compact
              abbrev={teams.away.abbrev}
              color={teams.away.palette.primary}
              runs={score.away}
              batting={snapshot.battingSide === "away"}
            />
            <TeamRow
              compact
              abbrev={teams.home.abbrev}
              color={teams.home.palette.primary}
              runs={score.home}
              batting={snapshot.battingSide === "home"}
            />
          </div>
          <div className="h-9 w-0.5 rounded-full bg-grass-deep/10" />
          <div className="flex flex-col items-center gap-1.5">
            <div className="rounded-full bg-grass-mist px-2 py-0.5 text-[10px] font-bold leading-none text-grass-deep">
              {arrow} {snapshot.inningOrdinal}
            </div>
            <Outs count={count.outs} />
          </div>
          <Diamond snapshot={snapshot} compact />
        </div>
        <CollapseButton mode={mode} onCycle={onCycle} />
      </div>
    );
  }

  return (
    <div className="relative select-none sm:w-[300px]">
      <div className="pointer-events-none w-full rounded-2xl border-2 border-grass-deep/12 bg-card/95 p-3 backdrop-blur-[2px] lip-float">
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
            <div className="rounded-full bg-grass-mist px-2 py-0.5 text-[11px] font-bold text-grass-deep">
              {arrow} {snapshot.inningOrdinal}
            </div>
            <div className="flex items-center gap-2">
              <Diamond snapshot={snapshot} />
              <div className="flex flex-col items-end gap-1">
                <span className="font-display text-base font-extrabold leading-none text-bark">
                  {count.balls}-{count.strikes}
                </span>
                <Outs count={count.outs} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2.5 space-y-1.5 border-t-2 border-dashed border-grass-deep/12 pt-2 text-[11px] leading-snug">
          <div>
            <div className="flex justify-between gap-2">
              <span className="font-bold text-bark-soft">At bat</span>
              <span className="truncate font-semibold text-bark">{batter?.name ?? "—"}</span>
            </div>
            {(batterLine || snapshot.batterStats?.avg) && (
              <div className="flex justify-between gap-2 text-[10px] text-bark-soft">
                <span>{snapshot.batterStats?.avg ?? ""}</span>
                <span className="truncate">{batterLine}</span>
              </div>
            )}
          </div>
          <div>
            <div className="flex justify-between gap-2">
              <span className="font-bold text-bark-soft">Pitching</span>
              <span className="truncate font-semibold text-bark">
                {defense.pitcher?.name ?? "—"}
              </span>
            </div>
            {pitcherLine && (
              <div className="flex justify-between gap-2 text-[10px] text-bark-soft">
                <span>{snapshot.pitcherStats?.era ? `${snapshot.pitcherStats.era} ERA` : ""}</span>
                <span className="truncate">{pitcherLine}</span>
              </div>
            )}
          </div>
        </div>

        {/* What the park is like - and what lit the scene. Dropped on a phone,
            where the screen is better spent on the game than on the weather. */}
        <div className="mt-2 hidden items-center gap-2 border-t-2 border-dashed border-grass-deep/12 pt-2 text-[10px] text-bark-soft sm:flex">
          <span className="font-bold text-bark">{conditions.condition}</span>
          {conditions.temp && <span>{conditions.temp}°</span>}
          {conditions.windLabel && <span className="truncate">{conditions.windLabel}</span>}
        </div>
      </div>
      <CollapseButton mode={mode} onCycle={onCycle} />
    </div>
  );
}
