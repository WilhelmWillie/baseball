"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GameSummary } from "@/lib/game/schedule";

interface SchedulePayload {
  date: string;
  games: GameSummary[];
  liveCount: number;
  demo: GameSummary;
  error?: string;
}

function timeLabel(iso: string | null): string {
  if (!iso) return "TBD";
  return new Date(iso)
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
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
        className="inline-block h-6 w-6 border-2 border-black/50"
        style={{ backgroundColor: team.palette.primary }}
      />
      <span className={`w-14 text-sm tracking-widest ${dim ? "text-white/55" : "text-white"}`}>
        {team.abbrev}
      </span>
      <span className="flex-1 truncate text-xs text-white/45">{team.name}</span>
      <span className={`w-8 text-right text-lg ${dim ? "text-white/45" : "text-white"}`}>
        {score ?? "–"}
      </span>
    </div>
  );
}

function GameCard({ game }: { game: GameSummary }) {
  const isLive = game.state === "live";
  const href = game.isDemo ? "/watch/demo" : `/watch/${game.gamePk}`;

  return (
    <Link
      href={href}
      className="group block border-2 border-black/60 bg-slate-950/70 p-4 transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-[5px_5px_0_rgba(0,0,0,0.5)]"
    >
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] tracking-widest">
        <span
          className={
            isLive
              ? "flex items-center gap-1.5 text-emerald-300"
              : game.state === "final"
                ? "text-white/35"
                : "text-amber-300"
          }
        >
          {isLive && <span className="h-2 w-2 animate-pulse bg-emerald-400" />}
          {isLive
            ? `${game.isTopInning ? "TOP" : "BOT"} ${game.inningOrdinal ?? ""} · ${game.outs ?? 0} OUT`
            : game.state === "final"
              ? "FINAL"
              : timeLabel(game.startTime)}
        </span>
        <span className="truncate pl-3 text-white/30">{game.venue}</span>
      </div>

      <div className="space-y-2 font-mono">
        <TeamLine team={game.away} score={game.away.score} dim={!isLive && game.state !== "final"} />
        <TeamLine team={game.home} score={game.home.score} dim={!isLive && game.state !== "final"} />
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[10px] tracking-widest text-white/30 group-hover:text-amber-300">
        <span>{game.isDemo ? "SIMULATED GAME" : game.statusText.toUpperCase()}</span>
        <span>WATCH IN 3D →</span>
      </div>
    </Link>
  );
}

export function GameList() {
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

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
    <div className="mx-auto w-full max-w-5xl px-6 pb-20">
      <header className="py-12">
        <h1 className="font-mono text-3xl tracking-[0.3em] text-white sm:text-4xl">
          MLB<span className="text-amber-300">3D</span>
        </h1>
        <p className="mt-3 max-w-xl font-mono text-xs leading-relaxed tracking-wide text-white/50">
          PICK A LIVE GAME AND WATCH IT UNFOLD IN A LOW-POLY 3D BALLPARK. PITCHES, HITS AND
          BASERUNNERS ARE DRIVEN BY THE REAL MLB STATS API.
        </p>
      </header>

      {loading && (
        <div className="border-2 border-black/60 bg-slate-950/70 p-8 text-center font-mono text-xs tracking-widest text-white/50">
          LOADING TODAY&apos;S SCHEDULE…
        </div>
      )}

      {!loading && (
        <>
          <section>
            <h2 className="mb-3 font-mono text-xs tracking-[0.3em] text-emerald-300">
              LIVE NOW {live.length > 0 && `· ${live.length}`}
            </h2>
            {live.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {live.map((game) => (
                  <GameCard key={game.gamePk} game={game} />
                ))}
              </div>
            ) : (
              <div className="border-2 border-black/60 bg-slate-950/70 p-6 font-mono text-xs leading-relaxed tracking-wide text-white/55">
                <p className="text-white/75">NO MLB GAMES ARE IN PROGRESS RIGHT NOW.</p>
                <p className="mt-2">
                  {failed
                    ? "THE SCHEDULE FEED COULD NOT BE REACHED FROM THIS SERVER."
                    : "CHECK BACK AROUND FIRST PITCH, OR TAKE THE SIMULATED GAME BELOW FOR A SPIN."}
                </p>
              </div>
            )}
          </section>

          {data?.demo && (
            <section className="mt-8">
              <h2 className="mb-3 font-mono text-xs tracking-[0.3em] text-amber-300">
                ALWAYS AVAILABLE
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <GameCard game={{ ...data.demo, isDemo: true }} />
              </div>
            </section>
          )}

          {rest.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 font-mono text-xs tracking-[0.3em] text-white/40">
                REST OF THE SLATE
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {rest.map((game) => (
                  <GameCard key={game.gamePk} game={game} />
                ))}
              </div>
            </section>
          )}

          {failed && (
            <p className="mt-8 border-2 border-red-900 bg-red-950/40 p-4 font-mono text-[11px] leading-relaxed tracking-wide text-red-200">
              {failed}
            </p>
          )}
        </>
      )}
    </div>
  );
}
