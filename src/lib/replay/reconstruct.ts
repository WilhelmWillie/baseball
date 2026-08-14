import {
  POSITION_ABBREV,
  POSITION_CODE_TO_KEY,
  type PositionKey,
} from "@/lib/field/geometry";
import { ordinalFor } from "@/lib/game/normalize";
import type { TeamSide } from "@/lib/game/types";
import type {
  MlbBoxscoreTeam,
  MlbLinescore,
  MlbLiveFeed,
  MlbPersonRef,
  MlbPlay,
  MlbPlayEvent,
  MlbPosition,
} from "@/lib/mlb/types";

/**
 * Tier 1 recording: rebuild a game's feed stream from its final feed.
 *
 * A completed GUMBO document already contains the whole game *and its timing* -
 * every `playEvents[].startTime` and `about.startTime`/`endTime` is a real
 * timestamp. So a single request is enough to reconstruct what the feed looked
 * like at every moment of the game, by revealing plays and pitches in order and
 * rolling the linescore back to match.
 *
 * This is the same slicing `lib/sim/feed.ts` performs on its scripted game,
 * applied to real data instead.
 *
 * The one thing that cannot be sliced is the boxscore: MLB publishes it only in
 * its final state, so per-player stat lines read as end-of-game throughout. The
 * linescore is what the renderer actually stands the players on, and that *is*
 * rebuilt exactly - defense, batter, runners, count, score, outs - so nothing on
 * the field is wrong, only the numbers beside a name. See `docs/RECORDING.md`.
 */

/** How long after its last pitch MLB publishes a play's result. */
const RESULT_LAG_MS = 1500;
/** How soon after the last out of a half the feed moves to the break. */
const BREAK_LEAD_MS = 1000;
/** Frames must advance, so a non-monotonic upstream timestamp cannot stall. */
const MIN_STEP_MS = 200;
/** Used when a play event carries no timestamp of its own. */
const FALLBACK_STEP_MS = 1000;

export interface FrameMeta {
  inning: number;
  isTop: boolean;
  atBatIndex: number;
  playComplete: boolean;
  scoring: boolean;
  between: boolean;
}

export interface RecordedFrame {
  /** Milliseconds since the first frame. */
  t: number;
  feed: MlbLiveFeed;
  meta: FrameMeta;
}

type BaseRefs = { first?: MlbPersonRef; second?: MlbPersonRef; third?: MlbPersonRef };
type DefenseRefs = Partial<Record<PositionKey, MlbPersonRef>>;

const HIT_EVENTS = new Set(["single", "double", "triple", "home_run"]);

const SUBSTITUTION_EVENTS = new Set([
  "defensive_substitution",
  "defensive_switch",
  "pitching_substitution",
]);

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function atBatIndexOf(play: MlbPlay, fallback: number): number {
  return play.about?.atBatIndex ?? play.atBatIndex ?? fallback;
}

function sideOf(play: MlbPlay): { batting: TeamSide; fielding: TeamSide } {
  const isTop = play.about?.isTopInning ?? true;
  return isTop
    ? { batting: "away", fielding: "home" }
    : { batting: "home", fielding: "away" };
}

/**
 * Which club each player belongs to. Substitutions are applied to the
 * substitute's own side rather than to whichever side happened to be fielding,
 * so a double switch announced at a half-inning boundary lands on the right
 * team.
 */
function buildSideIndex(feed: MlbLiveFeed): Map<number, TeamSide> {
  const sides = new Map<number, TeamSide>();
  const teams: Array<[TeamSide, MlbBoxscoreTeam | undefined]> = [
    ["home", feed.liveData?.boxscore?.teams?.home],
    ["away", feed.liveData?.boxscore?.teams?.away],
  ];
  for (const [side, team] of teams) {
    for (const entry of Object.values(team?.players ?? {})) {
      if (entry.person?.id != null) sides.set(entry.person.id, side);
    }
  }
  return sides;
}

const ABBREV_TO_KEY: Record<string, PositionKey> = Object.fromEntries(
  Object.entries(POSITION_ABBREV).map(([key, abbrev]) => [abbrev, key as PositionKey]),
);

/** A defensive slot from whichever of MLB's two spellings the feed carries. */
function positionKeyOf(position: MlbPosition | undefined): PositionKey | undefined {
  if (!position) return undefined;
  const byCode = position.code ? POSITION_CODE_TO_KEY[position.code] : undefined;
  if (byCode) return byCode;
  const abbrev = position.abbreviation?.toUpperCase();
  // DH, PH and PR map to nothing, which is correct - they do not field.
  return abbrev ? ABBREV_TO_KEY[abbrev] : undefined;
}

/**
 * The nine who took the field to start the game.
 *
 * A starter's boxscore `battingOrder` is their slot times 100 ("300" is third in
 * the order); substitutes get the same slot plus one ("301"). `allPositions[0]`
 * is where a player first stood. The starting pitcher comes off `pitchers[0]`
 * instead, since under the DH he is not in the batting order at all.
 *
 * Every one of those fields is optional in practice, so this degrades in steps:
 * the published order stands in when starters are not marked, and the player
 * dictionary's primary position stands in when the boxscore carries none. An
 * alignment recovered a step down is off only for a player who moved during the
 * game; no alignment at all would empty the field.
 */
function startingDefense(feed: MlbLiveFeed, side: TeamSide): DefenseRefs {
  const team = feed.liveData?.boxscore?.teams?.[side];
  const players = team?.players ?? {};
  const defense: DefenseRefs = {};

  const assign = (person: MlbPersonRef | undefined, position: MlbPosition | undefined) => {
    const key = positionKeyOf(position);
    if (!key || !person?.id || defense[key]) return;
    defense[key] = person;
  };

  for (const entry of Object.values(players)) {
    if (!entry.battingOrder || !/00$/.test(entry.battingOrder)) continue;
    assign(entry.person, entry.allPositions?.[0] ?? entry.position);
  }

  // Eight, because the pitcher is handled separately and is absent under the DH.
  if (Object.keys(defense).length < 8) {
    for (const id of team?.battingOrder ?? team?.batters ?? []) {
      const entry = players[`ID${id}`];
      assign(
        entry?.person ?? { id, fullName: feed.gameData?.players?.[`ID${id}`]?.fullName ?? `#${id}` },
        entry?.allPositions?.[0] ??
          entry?.position ??
          feed.gameData?.players?.[`ID${id}`]?.primaryPosition,
      );
    }
  }

  const starterId = team?.pitchers?.[0];
  if (starterId != null) {
    const starter = players[`ID${starterId}`]?.person;
    if (starter) defense.pitcher = starter;
  }
  return defense;
}

/** Fold a substitution into a side's alignment. */
function applySubstitution(
  defense: Record<TeamSide, DefenseRefs>,
  sides: Map<number, TeamSide>,
  event: MlbPlayEvent,
): void {
  const eventType = event.details?.eventType;
  if (!eventType || !SUBSTITUTION_EVENTS.has(eventType)) return;
  const player = event.player;
  if (!player?.id) return;
  const side = sides.get(player.id);
  if (!side) return;
  const code = event.position?.code;
  const key = code ? POSITION_CODE_TO_KEY[code] : undefined;
  if (!key) return;
  // The incoming player takes the slot; whoever else held it is displaced,
  // which covers a switch that moves a fielder across the diamond.
  for (const slot of Object.keys(defense[side]) as PositionKey[]) {
    if (defense[side][slot]?.id === player.id) delete defense[side][slot];
  }
  defense[side][key] = player;
}

/** Walk a completed play's runner movements to the base state it leaves behind. */
function advanceBases(bases: BaseRefs, play: MlbPlay): BaseRefs {
  const next: BaseRefs = { ...bases };
  for (const runner of play.runners ?? []) {
    const person = runner.details?.runner;
    if (!person?.id) continue;
    // A runner appears once per movement; clear them out before placing them so
    // an advance never leaves a ghost on the base behind.
    for (const base of ["first", "second", "third"] as const) {
      if (next[base]?.id === person.id) delete next[base];
    }
    if (runner.movement?.isOut) continue;
    switch (runner.movement?.end) {
      case "1B":
        next.first = person;
        break;
      case "2B":
        next.second = person;
        break;
      case "3B":
        next.third = person;
        break;
      // "score" and a null end both leave the bases as they are.
    }
  }
  return next;
}

/**
 * Balls and strikes from the pitches revealed so far.
 *
 * Recounted rather than read off `playEvent.count`, for the same reason
 * `lib/game/events.ts` recounts: the feed's own count field is documented
 * inconsistently, and the animator is driven by the recount.
 */
function countFrom(events: MlbPlayEvent[]): { balls: number; strikes: number } {
  let balls = 0;
  let strikes = 0;
  for (const event of events) {
    if (!event.isPitch) continue;
    const details = event.details;
    if (details?.isInPlay) break;
    if (details?.isBall) {
      balls += 1;
      continue;
    }
    if (details?.isStrike) {
      const isFoul = details.call?.code === "F" || /foul/i.test(details.description ?? "");
      // A foul with two strikes does not add a third.
      if (isFoul && strikes >= 2) continue;
      strikes += 1;
    }
  }
  return { balls: Math.min(balls, 3), strikes: Math.min(strikes, 2) };
}

interface InningLine {
  num: number;
  ordinalNum: string;
  home?: { runs: number };
  away?: { runs: number };
}

/** Strip a play back to what the feed showed while it was still in progress. */
function inFlight(play: MlbPlay, throughEvent: number): MlbPlay {
  return {
    ...play,
    playEvents: (play.playEvents ?? []).slice(0, throughEvent + 1),
    about: { ...play.about, isComplete: false, endTime: undefined },
    // MLB publishes the outcome a beat after the last pitch; until then the
    // play carries no result and no runner movement.
    result: { type: "atBat" },
    runners: [],
  };
}

export function reconstructFrames(final: MlbLiveFeed): RecordedFrame[] {
  const plays = final.liveData?.plays?.allPlays ?? [];
  if (plays.length === 0) return [];

  const sides = buildSideIndex(final);
  const defense: Record<TeamSide, DefenseRefs> = {
    home: startingDefense(final, "home"),
    away: startingDefense(final, "away"),
  };
  const scheduledInnings = final.liveData?.linescore?.scheduledInnings ?? 9;

  const frames: RecordedFrame[] = [];
  const completed: MlbPlay[] = [];
  const innings: InningLine[] = [];
  const scoringPlays: number[] = [];

  const score = { home: 0, away: 0 };
  const hits = { home: 0, away: 0 };
  const errors = { home: 0, away: 0 };
  let bases: BaseRefs = {};
  let outs = 0;
  let originMs: number | null = null;
  let lastT = -MIN_STEP_MS;

  const push = (absoluteMs: number | null, feed: MlbLiveFeed, meta: FrameMeta) => {
    if (originMs == null) originMs = absoluteMs ?? Date.now();
    const raw = absoluteMs == null ? lastT + FALLBACK_STEP_MS : absoluteMs - originMs;
    const t = Math.max(raw, lastT + MIN_STEP_MS);
    lastT = t;
    frames.push({ t, feed, meta });
  };

  const inningLine = (inning: number): InningLine => {
    let line = innings.find((i) => i.num === inning);
    if (!line) {
      line = { num: inning, ordinalNum: ordinalFor(inning) };
      innings.push(line);
    }
    return line;
  };

  /** The batter due up after this play, within the same half-inning. */
  const onDeckAfter = (index: number): MlbPersonRef | undefined => {
    const here = plays[index]?.about;
    for (let i = index + 1; i < plays.length; i++) {
      const about = plays[i].about;
      if (about?.inning !== here?.inning || about?.isTopInning !== here?.isTopInning) return undefined;
      const batter = plays[i].matchup?.batter;
      if (batter) return batter;
    }
    return undefined;
  };

  const buildFeed = (opts: {
    current: MlbPlay;
    inning: number;
    isTop: boolean;
    inningState: string;
    balls: number;
    strikes: number;
    batter?: MlbPersonRef;
    onDeck?: MlbPersonRef;
    pitcher?: MlbPersonRef;
    fielding: TeamSide;
    isFinal: boolean;
  }): MlbLiveFeed => {
    const alignment: MlbLinescore["defense"] = { ...defense[opts.fielding] };
    if (opts.pitcher) alignment.pitcher = opts.pitcher;

    const linescore: MlbLinescore = {
      currentInning: opts.inning,
      currentInningOrdinal: ordinalFor(opts.inning),
      inningState: opts.inningState,
      inningHalf: opts.isTop ? "Top" : "Bottom",
      isTopInning: opts.isTop,
      scheduledInnings,
      innings: innings.map((line) => ({ ...line })),
      teams: {
        home: { runs: score.home, hits: hits.home, errors: errors.home },
        away: { runs: score.away, hits: hits.away, errors: errors.away },
      },
      defense: alignment,
      offense: {
        batter: opts.batter,
        onDeck: opts.onDeck,
        first: bases.first,
        second: bases.second,
        third: bases.third,
      },
      balls: opts.balls,
      strikes: opts.strikes,
      outs,
    };

    // `current` is either a truncated in-flight play, which is not in
    // `completed` yet, or the play that has just finished, which is. Appending
    // blindly would list that last play twice.
    const isSettled = completed[completed.length - 1] === opts.current;
    const allPlays = isSettled ? [...completed] : [...completed, opts.current];

    return {
      gamePk: final.gamePk,
      metaData: final.metaData,
      gameData: {
        ...final.gameData,
        status: opts.isFinal
          ? final.gameData?.status
          : { abstractGameState: "Live", codedGameState: "I", detailedState: "In Progress" },
      },
      liveData: {
        plays: {
          // Completed plays are shared by reference across every later frame -
          // they never change again, so the patch encoder skips them for free.
          allPlays,
          currentPlay: opts.current,
          scoringPlays: [...scoringPlays],
        },
        linescore,
        boxscore: final.liveData?.boxscore,
        decisions: opts.isFinal ? final.liveData?.decisions : undefined,
      },
    };
  };

  let prevInning = plays[0].about?.inning ?? 1;
  let prevIsTop = plays[0].about?.isTopInning ?? true;
  let lastAbsoluteMs: number | null = null;

  for (let i = 0; i < plays.length; i++) {
    const play = plays[i];
    const inning = play.about?.inning ?? prevInning;
    const isTop = play.about?.isTopInning ?? prevIsTop;
    const { batting, fielding } = sideOf(play);
    const index = atBatIndexOf(play, i);

    // A new half-inning: the feed sits in the break first, with the park empty.
    if (i > 0 && (inning !== prevInning || isTop !== prevIsTop)) {
      const previous = completed[completed.length - 1];
      const breakAt =
        (parseTime(previous?.about?.endTime) ?? lastAbsoluteMs ?? 0) + BREAK_LEAD_MS;
      const closing = previous ?? play;
      // The park stands empty through the break; the bases go with it.
      bases = {};
      push(
        breakAt,
        buildFeed({
          current: closing,
          inning: prevInning,
          // MLB holds `isTopInning` through the middle break and flips it with
          // the bottom half, which is what `deriveGameOver` reads.
          isTop: prevIsTop,
          inningState: prevIsTop ? "Middle" : "End",
          balls: 0,
          strikes: 0,
          pitcher: closing.matchup?.pitcher,
          fielding: prevIsTop ? "home" : "away",
          isFinal: false,
        }),
        {
          inning: prevInning,
          isTop: prevIsTop,
          atBatIndex: atBatIndexOf(closing, i - 1),
          playComplete: false,
          scoring: false,
          between: true,
        },
      );
      outs = 0;
    }

    prevInning = inning;
    prevIsTop = isTop;
    inningLine(inning)[batting] ??= { runs: 0 };

    const events = play.playEvents ?? [];
    for (let j = 0; j < events.length; j++) {
      const event = events[j];
      applySubstitution(defense, sides, event);
      const at = parseTime(event.startTime);
      if (at != null) lastAbsoluteMs = at;
      const revealed = events.slice(0, j + 1);
      push(
        at,
        buildFeed({
          current: inFlight(play, j),
          inning,
          isTop,
          inningState: isTop ? "Top" : "Bottom",
          ...countFrom(revealed),
          batter: play.matchup?.batter,
          onDeck: onDeckAfter(i),
          pitcher: play.matchup?.pitcher,
          fielding,
          isFinal: false,
        }),
        {
          inning,
          isTop,
          atBatIndex: index,
          playComplete: false,
          scoring: false,
          between: false,
        },
      );
    }

    // The result lands a beat after the last pitch. Emitting it as its own frame
    // is what gives the renderer's hold logic something real to absorb: the
    // pitch that ends an at-bat arrives before its outcome, exactly as live.
    const endedAt = parseTime(play.about?.endTime);
    const resultAt: number =
      endedAt != null && lastAbsoluteMs != null && endedAt > lastAbsoluteMs
        ? endedAt
        : (lastAbsoluteMs ?? 0) + RESULT_LAG_MS;
    lastAbsoluteMs = resultAt;

    score.home = play.result?.homeScore ?? score.home;
    score.away = play.result?.awayScore ?? score.away;
    const eventType = play.result?.eventType ?? "";
    if (HIT_EVENTS.has(eventType)) hits[batting] += 1;
    if (eventType === "field_error") errors[fielding] += 1;
    outs = play.count?.outs ?? outs;
    bases = advanceBases(bases, play);
    inningLine(inning)[batting] = { runs: score[batting] - runsBefore(innings, inning, batting) };
    const isScoring = Boolean(play.about?.isScoringPlay);
    if (isScoring) scoringPlays.push(index);
    completed.push(play);

    const isLastPlay = i === plays.length - 1;
    push(
      resultAt,
      buildFeed({
        current: play,
        inning,
        isTop,
        inningState: isTop ? "Top" : "Bottom",
        balls: 0,
        strikes: 0,
        batter: play.matchup?.batter,
        onDeck: onDeckAfter(i),
        pitcher: play.matchup?.pitcher,
        fielding,
        isFinal: isLastPlay,
      }),
      {
        inning,
        isTop,
        atBatIndex: index,
        playComplete: true,
        scoring: isScoring,
        between: false,
      },
    );
  }

  return frames;
}

/**
 * Runs the batting side had scored before the inning in question, so an
 * inning's own line is the difference rather than a running total.
 */
function runsBefore(innings: InningLine[], inning: number, side: TeamSide): number {
  let total = 0;
  for (const line of innings) {
    if (line.num >= inning) continue;
    total += line[side]?.runs ?? 0;
  }
  return total;
}
