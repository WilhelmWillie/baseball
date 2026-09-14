import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GameCard } from "@/components/GameCard";
import { SeasonNav } from "@/components/SeasonNav";
import { Ball } from "@/components/brand/Ball";
import { easternDate, fetchSchedule } from "@/lib/mlb/client";
import {
  dedupeGames,
  neighborDays,
  seasonDate,
  sortGames,
  summarizeGame,
  type GameSummary,
} from "@/lib/game/schedule";

/**
 * One day of the season.
 *
 * The other half of "watch any game": every game MLB has finished can be
 * rebuilt from its feed, but nothing points at one until there is a page that
 * lists the day it was played. Server-rendered so a date is a link somebody can
 * send, and so a crawler sees the slate rather than a spinner.
 */
type Params = Promise<{ date: string }>;

/** Fixed to UTC: the string is a calendar day, not a moment. */
function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { date } = await params;
  if (!seasonDate(date, easternDate())) return {};
  const title = `Games on ${dayLabel(date)}`;
  const description = "Every game that day, playable pitch by pitch in a 3D ballpark.";
  return { title, description, openGraph: { title, description } };
}

export default async function GamesOnDatePage({ params }: { params: Params }) {
  const { date: raw } = await params;
  const today = easternDate();
  const date = seasonDate(raw, today);
  if (!date) notFound();

  const { previous, next } = neighborDays(date, today);

  let games: GameSummary[] = [];
  let failed: string | null = null;
  try {
    games = sortGames(dedupeGames((await fetchSchedule(date, date)).map(summarizeGame)));
  } catch (error) {
    failed = error instanceof Error ? error.message : "Could not reach the schedule";
  }

  const watchable = games.filter((game) => game.state === "final" || game.state === "live");

  return (
    <main className="min-h-dvh bg-paper bg-[radial-gradient(circle_at_12%_-8%,var(--color-grass-mist),transparent_60%)]">
      <div className="mx-auto w-full max-w-5xl px-5 pb-20 sm:px-8">
        <nav className="flex items-center justify-between py-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight"
          >
            <Ball className="h-8 w-8" />
            <span className="text-clay">Pocket</span>
            <span className="-ml-1 text-grass-deep">Ballpark</span>
          </Link>
          <Link
            href="/about"
            className="rounded-full bg-grass px-3.5 py-1.5 text-xs font-bold text-card transition-transform lip-sm hover:-translate-y-0.5"
          >
            About
          </Link>
        </nav>

        <header className="pb-8 pt-2">
          <p className="text-sm font-bold uppercase tracking-wide text-bark-soft">
            {date === today ? "Today" : "The 2026 season"}
          </p>
          <h1 className="mt-1 font-display text-3xl font-extrabold leading-tight tracking-tight text-grass-deep sm:text-4xl">
            {dayLabel(date)}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-bark-soft">
            {watchable.length > 0
              ? `${watchable.length} game${watchable.length === 1 ? "" : "s"} to watch. A finished game is rebuilt from MLB's own play-by-play when you open it — nothing was recorded ahead of time.`
              : "Nothing was played here that can be watched."}
          </p>
          <div className="mt-5">
            <SeasonNav date={date} today={today} previous={previous} next={next} />
          </div>
        </header>

        {failed ? (
          <p className="break-all rounded-2xl border-2 border-clay/30 bg-clay-soft/25 p-4 text-xs leading-relaxed text-bark">
            Could not reach the MLB Stats API: {failed}
          </p>
        ) : games.length === 0 ? (
          <div className="rounded-3xl border-2 border-grass-deep/12 bg-card p-6 text-sm leading-relaxed text-bark-soft lip">
            <p className="font-display text-lg font-bold text-bark">No games on this date.</p>
            <p className="mt-1">Try the day before or after — the season does not play every day.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {games.map((game) => (
              <GameCard key={game.gamePk} game={game} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
