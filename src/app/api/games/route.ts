import { NextResponse } from "next/server";
import { easternDate, fetchSchedule } from "@/lib/mlb/client";
import {
  dedupeGames,
  seasonDate,
  summarizeGame,
  sortGames,
  type GameSummary,
} from "@/lib/game/schedule";

export const dynamic = "force-dynamic";

/**
 * A day's games.
 *
 * With no `?date`, today's slate plus anything still being played from
 * yesterday - what the home page opens on. With one, that day exactly, which is
 * how the season browser walks back through games that have already been
 * played. A date outside the season is not an error worth failing over; it is
 * simply a day with no games.
 */
export async function GET(request: Request) {
  const today = easternDate();
  const asked = new URL(request.url).searchParams.get("date") ?? undefined;
  const date = seasonDate(asked, today);
  const oneDay = asked !== undefined;

  if (oneDay && date === null) {
    return NextResponse.json(
      { date: asked, games: [] as GameSummary[], liveCount: 0, error: "That date is not in the season." },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const day = date ?? today;
  const yesterday = easternDate(-1);

  try {
    const raw = await fetchSchedule(oneDay ? day : yesterday, day);
    const games = sortGames(dedupeGames(raw.map(summarizeGame))).filter((game) => {
      // On the home page, keep yesterday's games only while they are still
      // being played. A day of its own shows everything it held.
      if (!oneDay && game.startTime && game.startTime.slice(0, 10) === yesterday) {
        return game.state === "live";
      }
      return true;
    });

    return NextResponse.json(
      {
        date: day,
        games,
        liveCount: games.filter((g) => g.state === "live").length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        date: day,
        games: [] as GameSummary[],
        liveCount: 0,
        error: `Could not reach the MLB Stats API: ${message}`,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
