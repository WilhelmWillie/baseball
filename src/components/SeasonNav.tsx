"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SEASON_OPENING_DAY } from "@/lib/game/schedule";

/**
 * Walking the season, a day at a time.
 *
 * Two ways through it, because two things get asked. "The game I watched last
 * night" wants a step; "opening day" wants to jump, and the native date picker
 * already knows how to do that better than anything worth hand-rolling. Its
 * bounds are the season's, so there is no way to land on a day with nothing
 * behind it.
 */
export function SeasonNav({
  date,
  today,
  previous,
  next,
}: {
  date: string;
  today: string;
  previous: string | null;
  next: string | null;
}) {
  const router = useRouter();

  const step =
    "rounded-full border-2 border-grass-deep/12 bg-card px-3 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep";
  const spent = "rounded-full border-2 border-bark/8 bg-card/60 px-3 py-1.5 text-xs font-bold text-bark-soft/60";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {previous ? (
        <Link href={`/games/${previous}`} className={step}>
          ← Previous day
        </Link>
      ) : (
        <span className={spent}>← Previous day</span>
      )}

      <input
        type="date"
        value={date}
        min={SEASON_OPENING_DAY}
        max={today}
        onChange={(event) => {
          const picked = event.target.value;
          if (picked) router.push(`/games/${picked}`);
        }}
        aria-label="Jump to a date"
        className="rounded-full border-2 border-grass-deep/12 bg-card px-3 py-1.5 text-xs font-bold text-bark"
      />

      {next ? (
        <Link href={`/games/${next}`} className={step}>
          Next day →
        </Link>
      ) : (
        <span className={spent}>Next day →</span>
      )}

      {date !== today && (
        <Link href={`/games/${today}`} className={step}>
          Today
        </Link>
      )}
    </div>
  );
}
