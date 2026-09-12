"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GameSummary } from "@/lib/game/schedule";
import { Ball } from "@/components/brand/Ball";
import { easternDate } from "@/lib/mlb/client";
import { GameCard } from "@/components/GameCard";

interface SchedulePayload {
  date: string;
  games: GameSummary[];
  liveCount: number;
  error?: string;
}

interface RecentPayload {
  games: GameSummary[];
  error?: string;
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-extrabold text-grass-deep">
      {children}
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-grass-mist px-2 py-0.5 font-sans text-xs font-bold text-grass-deep">
          {count}
        </span>
      )}
    </h2>
  );
}

export function GameList() {
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  // `null` until the answer arrives: an empty grid and a grid that has not
  // loaded look the same, and only one of them is worth a spinner.
  const [recent, setRecent] = useState<GameSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSchedule = async () => {
      try {
        const res = await fetch("/api/games", { cache: "no-store" });
        if (!res.ok) throw new Error(`Schedule responded ${res.status}`);
        const payload = (await res.json()) as SchedulePayload;
        if (cancelled) return;
        setData(payload);
        setFailed(payload.error ?? null);
      } catch (error) {
        if (cancelled) return;
        setFailed(error instanceof Error ? error.message : "Could not load the schedule");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Polled alongside the slate rather than loaded once: a game that ends
    // while the page is open leaves "playing right now", and the grid below is
    // where it has to turn up. Cheap to ask for - the route holds one answer
    // for a minute, so this costs a few hundred bytes, not a schedule read.
    const loadRecent = async () => {
      try {
        const res = await fetch("/api/games/recent", { cache: "no-store" });
        if (!res.ok) throw new Error(`Recent games responded ${res.status}`);
        const payload = (await res.json()) as RecentPayload;
        if (!cancelled) setRecent(payload.games ?? []);
      } catch {
        // An empty grid, but never an emptied one: a poll that fails leaves
        // whatever was already on the page alone.
        if (!cancelled) setRecent((held) => held ?? []);
      }
    };

    const load = () => {
      void loadSchedule();
      void loadRecent();
    };

    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const live = data?.games.filter((g) => g.state === "live") ?? [];
  // Today's finished games are in the season grid below, at the front of it,
  // so what is left of the slate here is what has not been played yet.
  const rest = data?.games.filter((g) => g.state === "upcoming") ?? [];

  return (
    <div>
      {loading && (
        <div className="flex items-center justify-center gap-3 rounded-3xl border-2 border-grass-deep/12 bg-card p-10 text-sm text-bark-soft lip">
          <Ball className="h-6 w-6 animate-[bob_1.6s_ease-in-out_infinite]" />
          Looking up today&apos;s games…
        </div>
      )}

      {!loading && (
        <>
          <section>
            <SectionTitle count={live.length}>Playing right now</SectionTitle>
            {live.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {live.map((game) => (
                  <GameCard key={game.gamePk} game={game} />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border-2 border-grass-deep/12 bg-card p-6 text-sm leading-relaxed text-bark-soft lip">
                <p className="font-display text-lg font-bold text-bark">
                  The park is quiet at the moment.
                </p>
                <p className="mt-1">
                  {failed
                    ? "We couldn't reach the schedule from here — try again in a moment."
                    : "Nothing is in progress. Come back around first pitch, or put on one of the games below."}
                </p>
              </div>
            )}
          </section>

          {/* Every game that has been played, not only the ones somebody chose
              to publish. A finished game is rebuilt from MLB's play-by-play
              when it is opened, so the season needs no library behind it — but
              it does need to look like a season rather than a date picker,
              which is what the last nine games are doing here. */}
          <section className="mt-10">
            <SectionTitle>The rest of the season</SectionTitle>
            <p className="-mt-1 mb-3 text-sm text-bark-soft">
              The last nine games to end, rebuilt pitch by pitch from MLB&apos;s own
              play-by-play the moment you open one.
            </p>

            {recent === null ? (
              <div className="flex items-center justify-center gap-3 rounded-3xl border-2 border-grass-deep/12 bg-card p-10 text-sm text-bark-soft lip">
                <Ball className="h-6 w-6 animate-[bob_1.6s_ease-in-out_infinite]" />
                Rounding up the last nine games…
              </div>
            ) : recent.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((game) => (
                  <GameCard key={game.gamePk} game={game} withDate />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border-2 border-grass-deep/12 bg-card p-6 text-sm leading-relaxed text-bark-soft lip">
                <p className="font-display text-lg font-bold text-bark">
                  Nothing has finished lately.
                </p>
                <p className="mt-1">
                  Pick a date instead — every game since Opening Day is still there.
                </p>
              </div>
            )}

            <Link
              href={`/games/${data?.date ?? easternDate()}`}
              className="group mt-4 flex items-center justify-between gap-4 rounded-3xl border-2 border-grass-deep/12 bg-card p-5 transition-all duration-200 lip hover:-translate-y-1 hover:border-grass/60"
            >
              <span>
                <span className="block font-display text-lg font-bold text-bark">
                  Browse any day of 2026
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-bark-soft">
                  Every game since Opening Day plays in the ballpark — pick a date and
                  watch it back.
                </span>
              </span>
              <span className="shrink-0 text-lg font-bold text-grass transition-transform group-hover:translate-x-1">
                →
              </span>
            </Link>
          </section>

          {rest.length > 0 && (
            <section className="mt-10">
              <SectionTitle>Still to come today</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                {rest.map((game) => (
                  <GameCard key={game.gamePk} game={game} />
                ))}
              </div>
            </section>
          )}

          {/* Feed errors quote the URL, which is long enough to push the page
              sideways on a phone if it is allowed to stay one word. */}
          {failed && (
            <p className="mt-8 break-all rounded-2xl border-2 border-clay/30 bg-clay-soft/25 p-4 text-xs leading-relaxed text-bark">
              {failed}
            </p>
          )}
        </>
      )}
    </div>
  );
}
