"use client";

import type { GameSnapshot } from "@/lib/game/types";

/**
 * How much of the scoreboard is showing. `full` is the panel with the last
 * play; `mini` keeps only the score, inning, outs and bases; `hidden` takes it
 * off the screen entirely (the parent puts up a small chip to bring it back).
 */
export type ScoreMode = "full" | "mini" | "hidden";

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-3.5 w-3.5 ${up ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Close() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * The minimize/expand and hide buttons that ride in the scoreboard's corner.
 * The panel itself is `pointer-events-none` so the game shows through it, so
 * these opt back in.
 */
function ScoreControls({
  mode,
  onMode,
}: {
  mode: "full" | "mini";
  onMode: (mode: ScoreMode) => void;
}) {
  const button =
    "flex h-6 w-6 items-center justify-center rounded-full border-2 border-grass-deep/12 bg-card text-bark-soft transition-colors hover:border-grass/60 hover:text-grass-deep";
  return (
    <div className="pointer-events-auto flex items-center gap-1">
      <button
        type="button"
        onClick={() => onMode(mode === "full" ? "mini" : "full")}
        title={mode === "full" ? "Minimize scoreboard" : "Expand scoreboard"}
        aria-label={mode === "full" ? "Minimize scoreboard" : "Expand scoreboard"}
        className={button}
      >
        <Chevron up={mode === "full"} />
      </button>
      <button
        type="button"
        onClick={() => onMode("hidden")}
        title="Hide scoreboard"
        aria-label="Hide scoreboard"
        className={button}
      >
        <Close />
      </button>
    </div>
  );
}

function Diamond({ snapshot }: { snapshot: GameSnapshot }) {
  const on = (base: "first" | "second" | "third") => Boolean(snapshot.runners[base]);
  const cell = (active: boolean) =>
    `h-3 w-3 rotate-45 rounded-[3px] border-2 transition-colors ${
      active ? "border-grass bg-grass" : "border-bark/25 bg-transparent"
    }`;
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
}: {
  abbrev: string;
  color: string;
  runs: number;
  batting: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-5 w-5 rounded-full ring-2 ring-card"
        style={{ backgroundColor: color }}
      />
      <span
        className={`w-11 font-display text-base font-extrabold leading-none ${
          batting ? "text-bark" : "text-bark-soft"
        }`}
      >
        {abbrev}
      </span>
      <span
        className={`w-7 text-right font-display text-xl font-extrabold leading-none ${
          batting ? "text-grass-deep" : "text-bark-soft"
        }`}
      >
        {runs}
      </span>
      <span className={`text-[10px] ${batting ? "text-grass" : "text-transparent"}`}>●</span>
    </div>
  );
}

/** The tight team line used in the minimized bar: dot, abbrev, runs. */
function MiniTeam({
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
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-card"
        style={{ backgroundColor: color }}
      />
      <span
        className={`w-8 font-display text-sm font-extrabold leading-none ${
          batting ? "text-bark" : "text-bark-soft"
        }`}
      >
        {abbrev}
      </span>
      <span
        className={`w-5 text-right font-display text-base font-extrabold leading-none ${
          batting ? "text-grass-deep" : "text-bark-soft"
        }`}
      >
        {runs}
      </span>
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

export function Scorebug({
  snapshot,
  mode = "full",
  onMode,
}: {
  snapshot: GameSnapshot;
  mode?: "full" | "mini";
  /** Change how much of the scoreboard is showing. */
  onMode?: (mode: ScoreMode) => void;
}) {
  const { teams, score, count, batter, defense, conditions } = snapshot;
  const batterLine = batterSummary(snapshot.batterStats);
  const pitcherLine = pitcherSummary(snapshot.pitcherStats);
  const arrow = snapshot.isTopInning ? "▲" : "▼";
  const controls = onMode ? <ScoreControls mode={mode} onMode={onMode} /> : null;

  // Just the score, inning, outs and bases - a single band that gets out of the
  // way of the game, which is what a tall phone in the middle of a play wants.
  if (mode === "mini") {
    return (
      <div className="select-none">
        <div className="pointer-events-none flex w-full items-center gap-2.5 rounded-2xl border-2 border-grass-deep/12 bg-card/95 px-3 py-2 backdrop-blur-[2px] lip-float sm:w-auto">
          <div className="flex flex-col gap-1">
            <MiniTeam
              abbrev={teams.away.abbrev}
              color={teams.away.palette.primary}
              runs={score.away}
              batting={snapshot.battingSide === "away"}
            />
            <MiniTeam
              abbrev={teams.home.abbrev}
              color={teams.home.palette.primary}
              runs={score.home}
              batting={snapshot.battingSide === "home"}
            />
          </div>
          <div className="h-8 w-px shrink-0 bg-grass-deep/12" />
          <div className="rounded-full bg-grass-mist px-2 py-0.5 text-[11px] font-bold text-grass-deep">
            {arrow} {snapshot.inningOrdinal}
          </div>
          <Diamond snapshot={snapshot} />
          <Outs count={count.outs} />
          {controls && <div className="ml-auto pl-1 sm:ml-1">{controls}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="select-none">
      <div className="pointer-events-none w-full rounded-2xl border-2 border-grass-deep/12 bg-card/95 p-3 backdrop-blur-[2px] lip-float sm:w-[300px]">
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
            <div className="flex items-center gap-1.5">
              <div className="rounded-full bg-grass-mist px-2 py-0.5 text-[11px] font-bold text-grass-deep">
                {arrow} {snapshot.inningOrdinal}
              </div>
              {controls}
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
    </div>
  );
}
