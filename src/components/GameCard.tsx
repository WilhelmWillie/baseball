"use client";

import Link from "next/link";
import type { GameSummary } from "@/lib/game/schedule";
import { track } from "@/lib/analytics/events";

/**
 * One game, as a card.
 *
 * Shared by the home page and the season browser, which show the same games
 * from different angles - today's slate, or any day that has been played.
 */
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

export function GameCard({ game }: { game: GameSummary }) {
  const isLive = game.state === "live";
  // `?replay=1` only where it earns its place. The watch page decides how to
  // open a game from the game's own status, so an ordinary link is enough - but
  // a published recording plays without the Stats API, and forcing replay here
  // is what keeps the shelf watchable on a day the schedule cannot be reached.
  const href = game.isReplay
    ? `/watch/${game.gamePk}?replay=1`
    : `/watch/${game.gamePk}`;
  // A game that has been played is rebuilt from its feed on demand, so a final
  // card opens like a live one. What stays shut is a game with nothing behind
  // it yet: no lineup is published before first pitch, and a postponed game
  // never gets one at all.
  const watchable = isLive || game.state === "final";

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

      {/* Why this one is on the shelf. The scoreline alone does not carry it:
          an 11-10 game reads as any other slugfest until you know eight of
          those runs were made up in the last two innings. */}
      {game.note && (
        <p className="mt-3.5 rounded-2xl bg-grass-mist/55 px-3 py-2.5 text-xs leading-relaxed text-bark">
          {game.note}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t-2 border-dashed border-grass-deep/12 pt-3 text-xs">
        <span className="truncate text-bark-soft">
          {game.statusText}
        </span>
        <span
          className={`shrink-0 font-bold ${watchable ? "text-grass" : "text-bark-soft/70"}`}
        >
          {watchable ? (
            <>
              {isLive ? "Grab a seat" : "Watch it back"}{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
            </>
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
    <Link
      href={href}
      className={`${shell} ${interactive}`}
      onClick={() =>
        track("game_selected", {
          gamePk: String(game.gamePk),
          // A finished game opens as a replay whether or not it was published.
          mode: game.isReplay || game.state === "final" ? "replay" : "live",
          state: game.state,
        })
      }
    >
      {body}
    </Link>
  );
}
