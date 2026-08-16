import { NextResponse } from "next/server";
import { easternDate, fetchSchedule } from "@/lib/mlb/client";
import { summarizeGame, sortGames, type GameSummary } from "@/lib/game/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  const today = easternDate();
  const yesterday = easternDate(-1);

  try {
    const raw = await fetchSchedule(yesterday, today);
    const games = sortGames(raw.map(summarizeGame)).filter((game) => {
      // Keep yesterday's games only while they are still being played.
      if (game.startTime && game.startTime.slice(0, 10) === yesterday) {
        return game.state === "live";
      }
      return true;
    });

    return NextResponse.json(
      {
        date: today,
        games,
        liveCount: games.filter((g) => g.state === "live").length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        date: today,
        games: [] as GameSummary[],
        liveCount: 0,
        error: `Could not reach the MLB Stats API: ${message}`,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
