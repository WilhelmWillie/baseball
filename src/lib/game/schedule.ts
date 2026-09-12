import { paletteFor, type TeamPalette } from "@/lib/mlb/teams";
import type { MlbScheduleGame } from "@/lib/mlb/types";
import { isFinalStatus, isLiveStatus } from "@/lib/mlb/client";
import type { RecordingIndexEntry } from "@/lib/replay/format";

export interface GameSummary {
  gamePk: number;
  state: "live" | "upcoming" | "final";
  statusText: string;
  startTime: string | null;
  venue: string;
  home: { id: number; name: string; abbrev: string; score: number | null; record?: string; palette: TeamPalette };
  away: { id: number; name: string; abbrev: string; score: number | null; record?: string; palette: TeamPalette };
  inning: number | null;
  inningOrdinal: string | null;
  isTopInning: boolean | null;
  outs: number | null;
  /** A finished game we recorded. Watchable however long ago it was played. */
  isReplay?: boolean;
  /** Why a recording is on the shelf. Only recordings carry one. */
  note?: string;
}

type ScheduleTeamEntry = NonNullable<NonNullable<MlbScheduleGame["teams"]>["home"]>;

function summarizeTeam(entry: ScheduleTeamEntry | undefined) {
  const team = entry?.team;
  const palette = paletteFor(team?.id, team?.abbreviation);
  const record = entry?.leagueRecord?.wins != null
    ? `${entry.leagueRecord.wins}-${entry.leagueRecord.losses}`
    : undefined;
  return {
    id: team?.id ?? -1,
    name: team?.teamName ?? team?.name ?? "TBD",
    abbrev: team?.abbreviation ?? palette.abbrev,
    score: entry?.score ?? null,
    record,
    palette,
  };
}

/**
 * A recorded game as the home page's card wants it. Club colours come from the
 * same `paletteFor` the live schedule uses, keyed off the ids the recorder
 * stored, so a recording looks like any other game on the shelf.
 */
export function summarizeRecording(entry: RecordingIndexEntry): GameSummary {
  const side = (team: RecordingIndexEntry["home"]) => ({
    id: team.id,
    name: team.name,
    abbrev: team.abbrev,
    score: team.score,
    palette: paletteFor(team.id, team.abbrev),
  });
  return {
    gamePk: entry.gamePk,
    state: "final",
    // A label earns its place over the date: "2025 World Series Game 7" says
    // more about why a recording is on the shelf than "2025-11-01" does.
    statusText: entry.label ?? entry.date,
    startTime: entry.date,
    venue: entry.venue,
    home: side(entry.home),
    away: side(entry.away),
    inning: null,
    inningOrdinal: null,
    isTopInning: null,
    outs: null,
    isReplay: true,
    note: entry.note,
  };
}

export function summarizeGame(game: MlbScheduleGame): GameSummary {
  const live = isLiveStatus(game);
  const final = isFinalStatus(game);
  const linescore = game.linescore;
  return {
    gamePk: game.gamePk,
    state: live ? "live" : final ? "final" : "upcoming",
    statusText: game.status?.detailedState ?? "Scheduled",
    startTime: game.gameDate ?? null,
    venue: game.venue?.name ?? "",
    home: summarizeTeam(game.teams?.home),
    away: summarizeTeam(game.teams?.away),
    inning: linescore?.currentInning ?? null,
    inningOrdinal: linescore?.currentInningOrdinal ?? null,
    isTopInning: linescore?.isTopInning ?? null,
    outs: linescore?.outs ?? null,
  };
}

/**
 * How far back the season browser goes.
 *
 * Every game MLB has finished is watchable, so the only real bound is where the
 * season starts - spring training is played and published like anything else,
 * but it is not what "the 2026 season" means to anyone. The upper bound is
 * today, in Eastern, because that is MLB's own schedule day and there is
 * nothing to watch beyond it.
 *
 * One constant rather than a year picker: a second season is a different
 * feature, and this is the line it would have to cross.
 */
export const SEASON_OPENING_DAY = "2026-03-25";

/** A schedule day, or null if it is not one we would show. */
export function seasonDate(raw: string | undefined, today: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  if (Number.isNaN(Date.parse(raw))) return null;
  if (raw < SEASON_OPENING_DAY || raw > today) return null;
  return raw;
}

/** A calendar day, moved. Anchored at noon UTC so a DST shift cannot land short. */
export function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The day either side of this one, or null where the season ends. */
export function neighborDays(
  date: string,
  today: string,
): { previous: string | null; next: string | null } {
  const previous = shiftDay(date, -1);
  const next = shiftDay(date, 1);
  return {
    previous: previous >= SEASON_OPENING_DAY ? previous : null,
    next: next <= today ? next : null,
  };
}

/**
 * One card per game.
 *
 * A postponement and the day the game was made up share a `gamePk`, so a window
 * that spans both dates lists the same game twice - once as a game that will
 * never be played, once as the one that was. Keep whichever entry has more
 * baseball in it.
 */
export function dedupeGames(games: GameSummary[]): GameSummary[] {
  const rank = { live: 0, final: 1, upcoming: 2 } as const;
  const best = new Map<number, GameSummary>();
  for (const game of games) {
    const seen = best.get(game.gamePk);
    if (!seen || rank[game.state] < rank[seen.state]) best.set(game.gamePk, game);
  }
  return [...best.values()];
}

/** Live games first, then games about to start, then finals. */
export function sortGames(games: GameSummary[]): GameSummary[] {
  const rank = { live: 0, upcoming: 1, final: 2 } as const;
  return [...games].sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    const at = a.startTime ? Date.parse(a.startTime) : 0;
    const bt = b.startTime ? Date.parse(b.startTime) : 0;
    return at - bt;
  });
}
