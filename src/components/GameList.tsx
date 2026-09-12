"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { summarizeRecording, type GameSummary } from "@/lib/game/schedule";
import { loadRecordingIndex } from "@/lib/replay/source";
import { Ball } from "@/components/brand/Ball";
import { easternDate } from "@/lib/mlb/client";
import { GameCard } from "@/components/GameCard";

interface SchedulePayload {
  date: string;
  games: GameSummary[];
  liveCount: number;
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
  const [recordings, setRecordings] = useState<GameSummary[]>([]);

  // Recordings are static files and never change under us, so they load once
  // and are not polled with the schedule. Having none is normal, not an error.
  useEffect(() => {
    let cancelled = false;
    loadRecordingIndex()
      .then((entries) => {
        if (!cancelled) setRecordings(entries.map(summarizeRecording));
      })
      .catch(() => {
        if (!cancelled) setRecordings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
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
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const live = data?.games.filter((g) => g.state === "live") ?? [];
  const rest = data?.games.filter((g) => g.state !== "live") ?? [];

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
                    ? "We couldn't reach the schedule from here — the recorded games below still play."
                    : "Nothing is in progress. Come back around first pitch, or watch back any game the season has already played."}
                </p>
              </div>
            )}
          </section>

          {recordings.length > 0 && (
            <section className="mt-10">
              <SectionTitle count={recordings.length}>Recorded games</SectionTitle>
              <p className="-mt-1 mb-3 text-sm text-bark-soft">
                Real games, captured pitch by pitch. Skip around them however you
                like.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {recordings.map((game) => (
                  <GameCard key={game.gamePk} game={game} />
                ))}
              </div>
            </section>
          )}

          {/* Every game that has been played, not only the ones on the shelf.
              A finished game is rebuilt from MLB's play-by-play when it is
              opened, so the season needs a way in rather than a library. */}
          <section className="mt-10">
            <SectionTitle>The rest of the season</SectionTitle>
            <Link
              href={`/games/${data?.date ?? easternDate()}`}
              className="group flex items-center justify-between gap-4 rounded-3xl border-2 border-grass-deep/12 bg-card p-5 transition-all duration-200 lip hover:-translate-y-1 hover:border-grass/60"
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
              <SectionTitle>Rest of the slate</SectionTitle>
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
