"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { summarizeRecording, type GameSummary } from "@/lib/game/schedule";
import { loadRecordingIndex } from "@/lib/replay/source";
import { Ball } from "@/components/brand/Ball";

interface SchedulePayload {
  date: string;
  games: GameSummary[];
  liveCount: number;
  demo: GameSummary;
  error?: string;
}

function timeLabel(iso: string | null): string {
  if (!iso) return "Time TBD";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function StatusPill({ game }: { game: GameSummary }) {
  if (game.state === "live") {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-grass px-2.5 py-1 text-[11px] font-bold text-white">
        <span className="h-1.5 w-1.5 animate-[blink_1.4s_ease-in-out_infinite] rounded-full bg-card" />
        {game.isTopInning ? "Top" : "Bot"} {game.inningOrdinal ?? ""} · {game.outs ?? 0} out
      </span>
    );
  }
  if (game.isReplay) {
    return (
      <span className="rounded-full bg-grass-mist px-2.5 py-1 text-[11px] font-bold text-grass-deep">
        ⏺ Recording
      </span>
    );
  }
  if (game.state === "final") {
    return (
      <span className="rounded-full bg-paper-deep px-2.5 py-1 text-[11px] font-bold text-bark-soft">
        Final
      </span>
    );
  }
  return (
    <span className="rounded-full bg-clay-soft/60 px-2.5 py-1 text-[11px] font-bold text-bark">
      {timeLabel(game.startTime)}
    </span>
  );
}

function TeamLine({
  team,
  score,
  dim,
}: {
  team: GameSummary["home"];
  score: number | null;
  dim: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="inline-block h-7 w-7 shrink-0 rounded-full ring-2 ring-card"
        style={{ backgroundColor: team.palette.primary }}
      />
      <span
        className={`w-12 font-display text-lg font-extrabold leading-none ${
          dim ? "text-bark-soft" : "text-bark"
        }`}
      >
        {team.abbrev}
      </span>
      <span className="flex-1 truncate text-sm text-bark-soft">{team.name}</span>
      <span
        className={`w-8 text-right font-display text-2xl font-extrabold leading-none ${
          dim ? "text-bark-soft/70" : "text-grass-deep"
        }`}
      >
        {score ?? "–"}
      </span>
    </div>
  );
}

function GameCard({ game }: { game: GameSummary }) {
  const isLive = game.state === "live";
  const href = game.isDemo
    ? "/watch/demo"
    : game.isReplay
      ? `/watch/${game.gamePk}?replay=1`
      : `/watch/${game.gamePk}`;
  // There is nothing to watch in a game that has not started or has finished:
  // the feed carries no lineup before first pitch and nothing moves after the
  // last out, so those cards do not open. A recording is the exception - it
  // carries the whole game, so it opens however long ago it was played.
  const watchable = isLive || game.isDemo || game.isReplay;

  const shell =
    "group block rounded-3xl border-2 bg-card p-4 transition-all duration-200 sm:p-5";
  const interactive = watchable
    ? "border-grass-deep/12 lip hover:-translate-y-1 hover:-rotate-[0.4deg] hover:border-grass/60"
    : "cursor-not-allowed border-bark/8 bg-card/60 opacity-70";

  const body = (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <StatusPill game={game} />
        <span className="truncate text-xs text-bark-soft/80">{game.venue}</span>
      </div>

      <div className="space-y-2.5">
        <TeamLine team={game.away} score={game.away.score} dim={!isLive && game.state !== "final"} />
        <TeamLine team={game.home} score={game.home.score} dim={!isLive && game.state !== "final"} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t-2 border-dashed border-grass-deep/12 pt-3 text-xs">
        <span className="truncate text-bark-soft">
          {game.isDemo
            ? "A game we made up, always ready"
            : game.isReplay
              ? `Recorded ${game.statusText}`
              : game.statusText}
        </span>
        <span
          className={`shrink-0 font-bold ${watchable ? "text-grass" : "text-bark-soft/70"}`}
        >
          {watchable ? (
            <>
              Grab a seat{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
            </>
          ) : game.state === "final" ? (
            "That's a wrap"
          ) : (
            "Not yet"
          )}
        </span>
      </div>
    </>
  );

  if (!watchable) {
    return (
      <div className={`${shell} ${interactive}`} aria-disabled>
        {body}
      </div>
    );
  }

  return (
    <Link href={href} className={`${shell} ${interactive}`}>
      {body}
    </Link>
  );
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
                    ? "We couldn't reach the schedule from here — the simulated game below still works."
                    : "Nothing is in progress. Come back around first pitch, or take the game below for a spin."}
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

          {data?.demo && (
            <section className="mt-10">
              <SectionTitle>Always open</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                <GameCard game={{ ...data.demo, isDemo: true }} />
              </div>
            </section>
          )}

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
