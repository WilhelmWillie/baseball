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
