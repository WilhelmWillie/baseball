import { cache } from "react";
import { summarizeGame, type GameSummary } from "@/lib/game/schedule";
import { inningLabel } from "@/lib/game/normalize";
import { fetchPlayByPlay, fetchScheduleGame } from "@/lib/mlb/client";
import type { MlbPlay } from "@/lib/mlb/types";

/**
 * One plate appearance, as something to put on a share card.
 *
 * Both share surfaces - the link that resumes a recorded game at an at-bat, and
 * the clip page that plays one in isolation - describe the same thing, so they
 * read it from here rather than each picking the feed apart their own way.
 *
 * A plate appearance is addressed by `(gamePk, atBatIndex)`: MLB's own
 * numbering, which is also what `HistoryEntry.id` carries and what
 * `AtBat.atBatIndex` indexes by. It never changes and MLB keeps finished games
 * indefinitely, so a link minted today still resolves years from now with
 * nothing stored on our side.
 */
export interface AtBatCard {
  gamePk: number;
  atBatIndex: number;
  inning: number;
  isTop: boolean;
  /** "Top 6th". */
  half: string;
  batter: string;
  pitcher: string;
  /** MLB's short name for the outcome, e.g. "Home Run". */
  event: string;
  /** The full sentence, e.g. "Shohei Ohtani homers (3) on a fly ball…". */
  description: string;
  isScoring: boolean;
  isComplete: boolean;
  /**
   * The score either side of the play.
   *
   * The two cards want different ones. A link that resumes the game at this
   * at-bat is describing a situation someone is about to drop into, so it shows
   * `before` - and as a bonus does not spoil the result. A clip is describing
   * what the play produced, so it shows `after`.
   */
  scoreBefore: { home: number; away: number };
  scoreAfter: { home: number; away: number };
  /** Statcast, when the ball was put in play. Worth its space on a home run. */
  hit: { exitVelo?: number; distance?: number; launchAngle?: number } | null;
  /** Teams, colours, venue - everything the card needs that is not the play. */
  game: GameSummary;
}

function indexOf(play: MlbPlay, fallback: number): number {
  return play.about?.atBatIndex ?? play.atBatIndex ?? fallback;
}

/** Statcast off the last batted ball of the plate appearance, if there was one. */
function hitDataOf(play: MlbPlay): AtBatCard["hit"] {
  const events = play.playEvents ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const data = events[i].hitData;
    if (!data) continue;
    if (data.launchSpeed == null && data.totalDistance == null) continue;
    return {
      exitVelo: data.launchSpeed,
      distance: data.totalDistance,
      launchAngle: data.launchAngle,
    };
  }
  return null;
}

async function load(gamePk: number, atBatIndex: number): Promise<AtBatCard | null> {
  if (!Number.isInteger(gamePk) || gamePk <= 0) return null;
  if (!Number.isInteger(atBatIndex) || atBatIndex < 0) return null;

  // Two independent reads: the plays, and the schedule entry that names the
  // clubs and paints them. Neither is worth waiting on the other for.
  const [plays, scheduled] = await Promise.all([
    fetchPlayByPlay(gamePk).then((pbp) => pbp.allPlays ?? []),
    fetchScheduleGame(gamePk),
  ]);
  if (!scheduled) return null;

  const at = plays.findIndex((play, i) => indexOf(play, i) === atBatIndex);
  if (at < 0) return null;
  const play = plays[at];

  // Scores on a play are cumulative game totals as of its end, so the state
  // before this one is simply where the previous play left off.
  const previous = plays[at - 1];
  const inning = play.about?.inning ?? 0;
  const isTop = play.about?.isTopInning ?? true;

  return {
    gamePk,
    atBatIndex,
    inning,
    isTop,
    half: inningLabel(inning, isTop),
    batter: play.matchup?.batter?.fullName ?? "At the plate",
    pitcher: play.matchup?.pitcher?.fullName ?? "On the mound",
    event: play.result?.event ?? "At-bat",
    description: play.result?.description ?? "",
    isScoring: Boolean(play.about?.isScoringPlay),
    isComplete: Boolean(play.about?.isComplete),
    scoreBefore: {
      home: previous?.result?.homeScore ?? 0,
      away: previous?.result?.awayScore ?? 0,
    },
    scoreAfter: {
      home: play.result?.homeScore ?? previous?.result?.homeScore ?? 0,
      away: play.result?.awayScore ?? previous?.result?.awayScore ?? 0,
    },
    hit: hitDataOf(play),
    game: summarizeGame(scheduled),
  };
}

/**
 * Memoized for the length of one request, so a page and its `generateMetadata`
 * - which run separately and want the same at-bat - read the feed once.
 */
export const fetchAtBatCard = cache(load);

/**
 * The card, or nothing, without ever throwing.
 *
 * A share card is not worth failing a request over: an OG route that throws
 * hands a scraper an error where a generic ballpark card would have done.
 *
 * For *pages* this is the wrong trade - swallowing an upstream hiccup turns a
 * shared link into a permanent-looking 404. Pages call `fetchAtBatCard` and let
 * it throw; only the image routes come through here.
 */
export async function tryAtBatCard(
  gamePk: number,
  atBatIndex: number,
): Promise<AtBatCard | null> {
  try {
    return await fetchAtBatCard(gamePk, atBatIndex);
  } catch {
    return null;
  }
}

/** "108 mph · 442 ft" - the numbers people quote, in the order they quote them. */
export function hitLine(hit: AtBatCard["hit"]): string | null {
  if (!hit) return null;
  const parts: string[] = [];
  if (hit.exitVelo != null) parts.push(`${Math.round(hit.exitVelo)} mph`);
  if (hit.distance != null) parts.push(`${Math.round(hit.distance)} ft`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "LAD 3, TOR 2" - away first, the way a scoreboard reads. */
export function scoreLine(card: AtBatCard, score: { home: number; away: number }): string {
  return `${card.game.away.abbrev} ${score.away}, ${card.game.home.abbrev} ${score.home}`;
}
