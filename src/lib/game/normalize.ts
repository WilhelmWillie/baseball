import {
  POSITION_KEYS,
  type PositionKey,
} from "@/lib/field/geometry";
import { readConditions } from "@/lib/field/sky";
import { buildUniforms, paletteFor } from "@/lib/mlb/teams";
import type {
  MlbBoxscoreTeam,
  MlbLiveFeed,
  MlbPersonRef,
  MlbPlayer,
  MlbTeam,
} from "@/lib/mlb/types";
import type {
  BatterLine,
  BatterStatLine,
  PitcherStatLine,
  GameSnapshot,
  HistoryEntry,
  PitcherLine,
  PlayerRef,
  TeamBoxscore,
  TeamInfo,
  TeamSide,
} from "./types";

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  // Keep suffixes attached ("Tatis Jr.") but drop the given name.
  const tail = parts.slice(1).join(" ");
  return tail.length > 14 ? parts[parts.length - 1] : tail;
}

function handOf(code?: string): "R" | "L" | undefined {
  if (code === "R" || code === "L") return code;
  // Switch hitters resolve per-matchup; the play data tells us which side.
  return undefined;
}

export interface PlayerIndex {
  byId: Map<number, PlayerRef>;
  sideOf: (id: number) => TeamSide | undefined;
}

function teamInfo(team: MlbTeam | undefined, side: TeamSide): TeamInfo {
  const id = team?.id ?? -1;
  const palette = paletteFor(id, team?.abbreviation);
  const record = team?.record?.wins != null ? `${team.record.wins}-${team.record.losses}` : undefined;
  return {
    id,
    name: team?.teamName ?? team?.clubName ?? team?.name ?? (side === "home" ? "Home" : "Away"),
    abbrev: team?.abbreviation ?? palette.abbrev,
    palette,
    // Filled in by buildSnapshot once both clubs are known.
    uniform: { jersey: "#888", pants: "#ccc", cap: "#888", trim: "#fff", helmet: "#888" },
    record,
  };
}

function buildPlayerIndex(feed: MlbLiveFeed): PlayerIndex {
  const byId = new Map<number, PlayerRef>();
  const sides = new Map<number, TeamSide>();

  const box = feed.liveData?.boxscore?.teams;
  const sideRosters: Array<[TeamSide, MlbBoxscoreTeam | undefined]> = [
    ["home", box?.home],
    ["away", box?.away],
  ];
  const jerseyById = new Map<number, string>();
  const positionById = new Map<number, string>();
  for (const [side, roster] of sideRosters) {
    for (const entry of Object.values(roster?.players ?? {})) {
      const id = entry.person?.id;
      if (id == null) continue;
      sides.set(id, side);
      if (entry.jerseyNumber) jerseyById.set(id, entry.jerseyNumber);
      if (entry.position?.abbreviation) positionById.set(id, entry.position.abbreviation);
    }
  }

  const players: Record<string, MlbPlayer> = feed.gameData?.players ?? {};
  for (const player of Object.values(players)) {
    if (player?.id == null) continue;
    byId.set(player.id, {
      id: player.id,
      name: player.fullName ?? "Unknown",
      shortName: player.boxscoreName ?? lastName(player.fullName ?? "Unknown"),
      number: jerseyById.get(player.id) ?? player.primaryNumber,
      position: positionById.get(player.id) ?? player.primaryPosition?.abbreviation,
      batSide: handOf(player.batSide?.code),
      pitchHand: handOf(player.pitchHand?.code),
      side: sides.get(player.id) ?? "home",
    });
  }

  return { byId, sideOf: (id) => sides.get(id) };
}

function resolve(index: PlayerIndex, ref: MlbPersonRef | undefined): PlayerRef | null {
  if (!ref?.id) return null;
  const found = index.byId.get(ref.id);
  if (found) return found;
  return {
    id: ref.id,
    name: ref.fullName ?? "Unknown",
    shortName: lastName(ref.fullName ?? "Unknown"),
    side: index.sideOf(ref.id) ?? "home",
  };
}

function rosterList(
  index: PlayerIndex,
  roster: MlbBoxscoreTeam | undefined,
  ids: number[] | undefined,
): PlayerRef[] {
  if (!ids?.length) return [];
  const out: PlayerRef[] = [];
  for (const id of ids) {
    const entry = roster?.players?.[`ID${id}`];
    const ref = resolve(index, entry?.person ?? { id, fullName: `#${id}` });
    if (ref) out.push(ref);
  }
  return out;
}

const ORDINALS = [
  "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th",
  "10th", "11th", "12th", "13th", "14th", "15th", "16th", "17th", "18th",
];

export function ordinalFor(inning: number): string {
  return ORDINALS[inning - 1] ?? `${inning}th`;
}

export function inningLabel(inning: number, isTopInning: boolean): string {
  const ordinal = ORDINALS[inning - 1] ?? `${inning}th`;
  return `${isTopInning ? "Top" : "Bot"} ${ordinal}`;
}

/**
 * Box score lines. Batters follow the batting order the feed publishes;
 * pitchers follow the order they appeared.
 */
function buildBoxscore(
  index: PlayerIndex,
  roster: MlbBoxscoreTeam | undefined,
  decisions: Record<number, "W" | "L" | "S">,
): TeamBoxscore {
  const players = roster?.players ?? {};
  const orderIds = roster?.battingOrder?.length ? roster.battingOrder : roster?.batters ?? [];

  const batters: BatterLine[] = [];
  for (const id of orderIds) {
    const entry = players[`ID${id}`];
    const batting = entry?.stats?.batting;
    if (!entry) continue;
    batters.push({
      id,
      name: index.byId.get(id)?.name ?? entry.person?.fullName ?? `#${id}`,
      position: entry.position?.abbreviation ?? "",
      ab: batting?.atBats ?? 0,
      r: batting?.runs ?? 0,
      h: batting?.hits ?? 0,
      rbi: batting?.rbi ?? 0,
      bb: batting?.baseOnBalls ?? 0,
      k: batting?.strikeOuts ?? 0,
      avg: entry.seasonStats?.batting?.avg ?? "—",
    });
  }

  const pitchers: PitcherLine[] = [];
  for (const id of roster?.pitchers ?? []) {
    const entry = players[`ID${id}`];
    const pitching = entry?.stats?.pitching;
    if (!entry) continue;
    pitchers.push({
      id,
      name: index.byId.get(id)?.name ?? entry.person?.fullName ?? `#${id}`,
      ip: pitching?.inningsPitched ?? "0.0",
      h: pitching?.hits ?? 0,
      r: pitching?.runs ?? 0,
      er: pitching?.earnedRuns ?? 0,
      bb: pitching?.baseOnBalls ?? 0,
      k: pitching?.strikeOuts ?? 0,
      era: entry.seasonStats?.pitching?.era ?? "—",
      decision: decisions[id],
    });
  }

  return { batters, pitchers };
}

/** Seed the play log from the plays the feed has already published. */
export function buildHistory(feed: MlbLiveFeed): HistoryEntry[] {
  const plays = feed.liveData?.plays?.allPlays ?? [];
  const entries: HistoryEntry[] = [];
  for (const play of plays) {
    if (!play.about?.isComplete || !play.result?.description) continue;
    const inning = play.about.inning ?? 0;
    const isTopInning = play.about.isTopInning ?? true;
    entries.push({
      id: `${play.about.atBatIndex ?? entries.length}`,
      inning,
      isTopInning,
      half: inningLabel(inning, isTopInning),
      event: play.result.event ?? "Play",
      description: play.result.description,
      isScoring: Boolean(play.about.isScoringPlay),
      score: {
        home: play.result.homeScore ?? 0,
        away: play.result.awayScore ?? 0,
      },
    });
  }
  return entries;
}

/** Today's line plus the season average for whoever is at the plate. */
function batterStatLine(
  team: MlbBoxscoreTeam | undefined,
  playerId: number | undefined,
): BatterStatLine | null {
  if (!team || !playerId) return null;
  const entry = team.players?.[`ID${playerId}`];
  if (!entry) return null;
  const today = entry.stats?.batting ?? {};
  return {
    avg: entry.seasonStats?.batting?.avg ?? null,
    atBats: today.atBats ?? 0,
    hits: today.hits ?? 0,
    rbi: today.rbi ?? 0,
    walks: today.baseOnBalls ?? 0,
    strikeouts: today.strikeOuts ?? 0,
    homeRuns: today.homeRuns ?? 0,
  };
}

/** What the pitcher has thrown today, pitch count first. */
function pitcherStatLine(
  team: MlbBoxscoreTeam | undefined,
  playerId: number | undefined,
): PitcherStatLine | null {
  if (!team || !playerId) return null;
  const entry = team.players?.[`ID${playerId}`];
  if (!entry) return null;
  const today = entry.stats?.pitching ?? {};
  return {
    // The feed uses either name for the pitch count depending on the endpoint.
    pitches: today.numberOfPitches ?? today.pitchesThrown ?? 0,
    inningsPitched: today.inningsPitched ?? null,
    strikeouts: today.strikeOuts ?? 0,
    hits: today.hits ?? 0,
    earnedRuns: today.earnedRuns ?? 0,
    era: entry.seasonStats?.pitching?.era ?? null,
  };
}

export function buildSnapshot(feed: MlbLiveFeed): GameSnapshot {
  const index = buildPlayerIndex(feed);
  const gameData = feed.gameData;
  const live = feed.liveData;
  const linescore = live?.linescore;

  const home = teamInfo(gameData?.teams?.home, "home");
  const away = teamInfo(gameData?.teams?.away, "away");
  const uniforms = buildUniforms(home.palette, away.palette);
  home.uniform = uniforms.home;
  away.uniform = uniforms.away;

  const abstract = gameData?.status?.abstractGameState ?? "Preview";
  const detailed = gameData?.status?.detailedState ?? abstract;
  const isFinal = abstract === "Final" || /final|game over|completed/i.test(detailed);
  const isLive = abstract === "Live" && !isFinal;

  const isTopInning = linescore?.isTopInning ?? true;
  // In the top half the home club is on defense.
  const fieldingSide: TeamSide = isTopInning ? "home" : "away";
  const battingSide: TeamSide = isTopInning ? "away" : "home";

  const defense = {} as Record<PositionKey, PlayerRef | null>;
  for (const key of POSITION_KEYS) {
    defense[key] = resolve(index, linescore?.defense?.[key]);
  }

  const offense = linescore?.offense;
  const runners: GameSnapshot["runners"] = {};
  const first = resolve(index, offense?.first);
  const second = resolve(index, offense?.second);
  const third = resolve(index, offense?.third);
  if (first) runners.first = first;
  if (second) runners.second = second;
  if (third) runners.third = third;

  const boxHome = live?.boxscore?.teams?.home;
  const boxAway = live?.boxscore?.teams?.away;

  const decisions: Record<number, "W" | "L" | "S"> = {};
  if (live?.decisions?.winner?.id) decisions[live.decisions.winner.id] = "W";
  if (live?.decisions?.loser?.id) decisions[live.decisions.loser.id] = "L";
  if (live?.decisions?.save?.id) decisions[live.decisions.save.id] = "S";

  const allPlays = live?.plays?.allPlays ?? [];
  const lastCompleted = [...allPlays].reverse().find((p) => p.about?.isComplete && p.result?.description);

  const lineScore = (linescore?.innings ?? []).map((inn, i) => ({
    num: inn.num ?? i + 1,
    home: inn.home?.runs ?? null,
    away: inn.away?.runs ?? null,
  }));

  return {
    gamePk: feed.gamePk ?? gameData?.game?.pk ?? 0,
    updatedAt: Date.now(),
    status: {
      abstract,
      detailed,
      isLive,
      isFinal,
      isPreview: abstract === "Preview",
    },
    venue: gameData?.venue?.name ?? "Ballpark",
    conditions: readConditions({
      condition: gameData?.weather?.condition,
      temp: gameData?.weather?.temp,
      wind: gameData?.weather?.wind,
      time: gameData?.datetime?.time,
      ampm: gameData?.datetime?.ampm,
      dateTime: gameData?.datetime?.dateTime,
      venueName: gameData?.venue?.name,
    }),
    teams: { home, away },
    score: {
      home: linescore?.teams?.home?.runs ?? 0,
      away: linescore?.teams?.away?.runs ?? 0,
    },
    hits: {
      home: linescore?.teams?.home?.hits ?? 0,
      away: linescore?.teams?.away?.hits ?? 0,
    },
    errors: {
      home: linescore?.teams?.home?.errors ?? 0,
      away: linescore?.teams?.away?.errors ?? 0,
    },
    inning: linescore?.currentInning ?? 1,
    inningOrdinal: linescore?.currentInningOrdinal ?? "1st",
    isTopInning,
    inningState: linescore?.inningState ?? "Top",
    count: {
      balls: linescore?.balls ?? 0,
      strikes: linescore?.strikes ?? 0,
      outs: linescore?.outs ?? 0,
    },
    fieldingSide,
    battingSide,
    defense,
    batter: resolve(index, offense?.batter ?? linescore?.defense?.batter),
    batterStats: batterStatLine(
      battingSide === "home" ? boxHome : boxAway,
      (offense?.batter ?? linescore?.defense?.batter)?.id,
    ),
    pitcherStats: pitcherStatLine(
      fieldingSide === "home" ? boxHome : boxAway,
      linescore?.defense?.pitcher?.id,
    ),
    onDeck: resolve(index, offense?.onDeck),
    runners,
    bench: {
      home: rosterList(index, boxHome, boxHome?.bench),
      away: rosterList(index, boxAway, boxAway?.bench),
    },
    bullpen: {
      home: rosterList(index, boxHome, boxHome?.bullpen),
      away: rosterList(index, boxAway, boxAway?.bullpen),
    },
    lineScore,
    lastPlay: lastCompleted?.result?.description ?? null,
    boxscore: {
      home: buildBoxscore(index, boxHome, decisions),
      away: buildBoxscore(index, boxAway, decisions),
    },
  };
}

/** Bat side for the current matchup, falling back to the player's listed side. */
export function batSideFor(feed: MlbLiveFeed, fallback: "R" | "L" = "R"): "R" | "L" {
  const code = feed.liveData?.plays?.currentPlay?.matchup?.batSide?.code;
  return code === "L" || code === "R" ? code : fallback;
}
