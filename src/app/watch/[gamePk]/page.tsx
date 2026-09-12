import Link from "next/link";
import { notFound } from "next/navigation";
import { Viewer, type ViewerMode } from "@/components/Viewer";
import { Ball } from "@/components/brand/Ball";
import { fetchScheduleGame } from "@/lib/mlb/client";
import { summarizeGame, type GameSummary } from "@/lib/game/schedule";

/**
 * How this game should be watched, decided from its own status.
 *
 * The mode used to come from `?replay=1`, which was fine when six games were
 * replayable and everything else was live or nothing. Now that any game MLB has
 * finished can be rebuilt from its feed, the URL for a game is just the game:
 * `/watch/<gamePk>` plays whatever there is to play. `?replay=1` still forces
 * replay - every link ever shared carries it - and a schedule we could not
 * reach falls back to live, which is what the page did before any of this.
 */
async function modeFor(gamePk: number, forced: boolean): Promise<ViewerMode | GameSummary> {
  if (forced) return "replay";
  let game: GameSummary | null = null;
  try {
    const entry = await fetchScheduleGame(gamePk);
    game = entry ? summarizeGame(entry) : null;
  } catch {
    return "live";
  }
  if (!game) return "live";
  if (game.state === "final") return "replay";
  if (game.state === "live") return "live";
  // Nothing to watch yet: the feed carries no lineup before first pitch, so a
  // viewer here would sit on an empty field waiting for a game that has not
  // started. Say when it starts instead.
  return game;
}

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ gamePk: string }>;
  searchParams: Promise<{ at?: string; replay?: string }>;
}) {
  const { gamePk } = await params;
  const { at, replay } = await searchParams;

  // Every game is a numeric gamePk now that the simulator is gone; anything
  // else would render a viewer that can never load a feed.
  const id = Number(gamePk);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const decided = await modeFor(id, replay === "1" || replay === "true");
  if (typeof decided !== "string") return <NotYet game={decided} />;

  // ?at=<n> opens a replay on the nth plate appearance, 1-based.
  const openAt = Math.max(0, (Number(at ?? 0) || 0) - 1);

  return (
    <Viewer gamePk={gamePk} mode={decided} startAtBat={decided === "replay" ? openAt : 0} />
  );
}

/** A game that has not been played. Postponed, cancelled, or simply not yet. */
function NotYet({ game }: { game: GameSummary }) {
  const first = game.startTime
    ? new Date(game.startTime).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5">
      <div className="w-full max-w-sm rounded-3xl border-2 border-grass-deep/12 bg-card p-6 text-center lip">
        <Ball className="mx-auto h-10 w-10 animate-[bob_5s_ease-in-out_infinite]" />
        <h1 className="mt-4 font-display text-2xl font-extrabold text-grass-deep">
          {game.away.abbrev} at {game.home.abbrev}
        </h1>
        <p className="mt-1 text-sm text-bark-soft">{game.venue}</p>
        <p className="mt-4 rounded-2xl bg-grass-mist/55 px-3 py-2.5 text-sm font-semibold text-bark">
          {game.statusText}
          {first ? ` · ${first}` : ""}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-bark-soft">
          There is nothing to watch until first pitch. Come back then, or put on a
          game that has already been played.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-full bg-grass px-4 py-2 text-sm font-bold text-card transition-transform hover:-translate-y-0.5"
        >
          Find another game
        </Link>
      </div>
    </main>
  );
}
