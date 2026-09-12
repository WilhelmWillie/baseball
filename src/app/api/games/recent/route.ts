import { NextResponse } from "next/server";
import { easternDate, fetchSchedule } from "@/lib/mlb/client";
import {
  dedupeGames,
  recentFinals,
  RECENT_GAME_LIMIT,
  SEASON_OPENING_DAY,
  shiftDay,
  summarizeGame,
  type GameSummary,
} from "@/lib/game/schedule";

export const dynamic = "force-dynamic";

/**
 * The last games the season played.
 *
 * What the home page leads with: every finished game is rebuilt from its feed
 * when it is opened, so the season is watchable without a library behind it -
 * but nothing says so until the page puts the games themselves in front of
 * somebody. `/api/games` cannot answer this. It reads today, and a morning
 * visitor's "today" has nothing finished in it.
 *
 * Its own route rather than a mode of `/api/games`, because the two want
 * opposite things from the schedule: live scores must be read fresh on every
 * poll, and ten days of settled ones must not be.
 */

/**
 * How far back to look for nine finished games.
 *
 * A full slate is fifteen games, so two days almost always covers it - but the
 * All-Star break is four days with no baseball in them, and a home page that
 * empties out for a week in July is worse than a wider window. Ten days clears
 * the break with room, and costs nothing extra once the answer is memoized.
 */
const WINDOW_DAYS = 10;

/**
 * One answer for everybody, held for a minute.
 *
 * The same ten days of schedule for every visitor, and ~800 KB upstream to
 * rebuild it. `force-dynamic` opts every fetch in this route out of Next's Data
 * Cache, which is why this is a plain memo rather than a revalidate window -
 * the same trade the feed proxy next door makes.
 */
const CACHE_MS = 60_000;
let memo: { at: number; day: string; games: GameSummary[] } | null = null;

export async function GET() {
  const today = easternDate();

  if (memo && memo.day === today && Date.now() - memo.at < CACHE_MS) {
    return NextResponse.json(
      { games: memo.games },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Clamped to the season: the window would otherwise reach into spring
  // training on opening week, which is played and published like anything else
  // but is not what "the 2026 season" means to anyone.
  const from = shiftDay(today, -(WINDOW_DAYS - 1));
  const start = from < SEASON_OPENING_DAY ? SEASON_OPENING_DAY : from;

  try {
    const raw = await fetchSchedule(start, today);
    const games = recentFinals(dedupeGames(raw.map(summarizeGame)), RECENT_GAME_LIMIT);
    memo = { at: Date.now(), day: today, games };
    return NextResponse.json({ games }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Same contract as `/api/games`: never a 500. The home page has a slate and
    // a season browser to render either way, and an empty grid is a smaller
    // failure than a page that does not come back.
    return NextResponse.json(
      {
        games: [] as GameSummary[],
        error: `Could not reach the MLB Stats API: ${message}`,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
