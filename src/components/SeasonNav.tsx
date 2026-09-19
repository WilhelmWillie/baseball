import Link from "next/link";
import { DatePicker } from "@/components/DatePicker";

/**
 * Walking the season, a day at a time.
 *
 * Two ways through it, because two things get asked. "The game I watched last
 * night" wants a step, and the steps are these. "Opening day" wants a jump,
 * which is the picker's errand - it opens a calendar of its own rather than
 * leaving a bare date field sitting in the row, so the season's edges are
 * something you can see instead of something you find out about.
 *
 * Nothing here holds state any more: the row is four links and a control that
 * looks after itself, so it renders on the server and ships no JavaScript of
 * its own.
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
  const step =
    "rounded-full border-2 border-grass-deep/12 bg-card px-3 py-1.5 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep";
  const spent =
    "rounded-full border-2 border-bark/8 bg-card/60 px-3 py-1.5 text-xs font-bold text-bark-soft/60";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {previous ? (
        <Link href={`/games/${previous}`} className={step}>
          ← Previous day
        </Link>
      ) : (
        <span className={spent}>← Previous day</span>
      )}

      <DatePicker date={date} today={today} />

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
