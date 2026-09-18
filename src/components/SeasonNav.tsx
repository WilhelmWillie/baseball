"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEASON_OPENING_DAY, seasonDate } from "@/lib/game/schedule";

/**
 * Walking the season, a day at a time.
 *
 * Two ways through it, because two things get asked. "The game I watched last
 * night" wants a step; "opening day" wants to jump, and the native date picker
 * already knows how to do that better than anything worth hand-rolling. Its
 * bounds are the season's, so there is no way to land on a day with nothing
 * behind it.
 *
 * The jump waits to be asked for. A date input reports every complete value it
 * passes through, and a browser passes through plenty on the way to the one
 * that was meant: stepping the picker back a month keeps the day and hands us
 * a date, typing a year is a new date per digit. Navigating on any of those
 * loads a day nobody asked for and takes the open picker down with it, which
 * is a long way from June if June was where you were going. So the picked day
 * is held until it is submitted, and the browser's own bounds checking gets to
 * explain a typed date that falls outside the season.
 */

/** Short enough for a button. Fixed to UTC: the string is a calendar day, not a moment. */
function dayLabel(date: string): string | null {
  const ms = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

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
  const [picked, setPicked] = useState(date);
  const [settled, setSettled] = useState(date);

  // Landing on a new day settles the picker on it. The jump that got us here is
  // spent, and one typed on a page we have since left should not outlive it.
  if (settled !== date) {
    setSettled(date);
    setPicked(date);
  }

  // Null while the input is mid-edit - a half-typed date reads as empty - which
  // is also when there is nothing to offer to go to.
  const pickedLabel = dayLabel(picked);

  const jump = (event: React.FormEvent) => {
    event.preventDefault();
    const target = seasonDate(picked, today);
    if (target && target !== date) router.push(`/games/${target}`);
  };

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

      {/* Laid out by the row above, not by itself: the form is here to be
          submitted - by the button, or by Enter from inside the input. */}
      <form onSubmit={jump} className="contents">
        <input
          type="date"
          value={picked}
          min={SEASON_OPENING_DAY}
          max={today}
          required
          onChange={(event) => setPicked(event.target.value)}
          aria-label="Jump to a date"
          className="rounded-full border-2 border-grass-deep/12 bg-card px-3 py-1.5 text-xs font-bold text-bark"
        />

        {pickedLabel && picked !== date && (
          <button type="submit" className={`${step} border-grass/60 text-grass-deep`}>
            Go to {pickedLabel} →
          </button>
        )}
      </form>

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
