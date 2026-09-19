"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SEASON_OPENING_DAY, seasonDate, shiftDay } from "@/lib/game/schedule";
import { CalendarIcon } from "@/components/icons/Calendar";

/**
 * "Take me to a day."
 *
 * The season nav used to wear a bare `<input type="date">`, with a Go-to button
 * that grew out of the row beside it once a date had been picked. Two things
 * were wrong with that. The input is the browser's own control, so it looked
 * like nothing else on the page and said nothing about what it was for; and the
 * step that finished the errand appeared somewhere else, after the fact, which
 * is a strange place to have to go looking for it.
 *
 * So: a button that says what it does, and a panel that holds the whole errand
 * - pick a day, press Confirm, land on it. Nothing navigates before Confirm,
 * which is the reason the old input was held back from the router too: a date
 * control reports every complete value it passes through, and a browser passes
 * through plenty on the way to the one that was meant.
 *
 * The grid is ours rather than the platform's because the season has edges.
 * March 24 and tomorrow are not days with baseball behind them, and a calendar
 * that greys them out says so before the click instead of after it.
 */

/** Sunday first. Two letters: wide enough to read, narrow enough to fit seven. */
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** How far each arrow key walks the grid, in days. */
const WALK: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

const DAY =
  "flex h-9 w-full items-center justify-center rounded-xl text-xs font-bold transition-colors";

const ARROW =
  "flex h-7 w-7 items-center justify-center rounded-full border-2 border-grass-deep/12 text-xs font-bold text-bark transition-colors hover:border-grass/60 hover:text-grass-deep disabled:border-bark/8 disabled:text-bark-soft/40";

/** The month a day falls in. `YYYY-MM` compares as a string, the way `YYYY-MM-DD` does. */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** A month, moved. */
function shiftMonth(month: string, months: number): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index - 1 + months, 1)).toISOString().slice(0, 7);
}

/**
 * A month laid out as a calendar: whole weeks, Sunday first, with the days
 * either side of it left blank rather than borrowed from its neighbours. A grid
 * you can only land inside keeps the arrow keys honest about where a month ends.
 */
function monthGrid(month: string): (string | null)[] {
  const [year, index] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(year, index - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();

  const cells: (string | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= length; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/* All three labels are fixed to UTC: these strings are calendar days, not moments. */

/** "June 2026", for the panel's header. */
function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

/** "Jun 14", short enough to sit beside the Confirm button. */
function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

/** Said in full, for a screen reader reading a grid of bare numbers. */
function fullLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function DatePicker({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(date);
  const [month, setMonth] = useState(() => monthOf(date));
  const [settled, setSettled] = useState(date);
  const wrap = useRef<HTMLDivElement>(null);
  const landing = useRef<HTMLButtonElement>(null);

  // Landing on a new day settles the panel. The jump that got us here is spent,
  // and a day picked on a page we have since left should not outlive it.
  if (settled !== date) {
    setSettled(date);
    setPicked(date);
    setMonth(monthOf(date));
    setOpen(false);
  }

  // A panel that can only be dismissed by finding its trigger again is a trap on
  // a phone, where it covers the thing behind it.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The grid is one tab stop, so focus has to be carried to it: onto the picked
  // day when the panel opens, and along with it as the arrows walk. Paging the
  // months leaves the selection alone, and so does not pull focus off the arrow
  // being pressed.
  useEffect(() => {
    if (open) landing.current?.focus();
  }, [open, picked]);

  const cells = monthGrid(month);
  const playable = cells.filter(
    (day): day is string => day !== null && seasonDate(day, today) !== null,
  );
  // The one day Tab can land on: the selection while it is on show, and
  // otherwise the first day of the month that is. A grid nothing can be tabbed
  // into is a hole in the order.
  const focusable = monthOf(picked) === month ? picked : (playable[0] ?? null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    // Opened where the page already is: a day abandoned last time is not a draft
    // worth keeping.
    setPicked(date);
    setMonth(monthOf(date));
    setOpen(true);
  };

  const walk = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = WALK[event.key];
    if (step === undefined) return;
    // From the day under the cursor rather than from the selection. The two are
    // the same day until the panel has been paged away from the selected month.
    const from = (event.target as HTMLElement).dataset.date;
    if (!from) return;
    const target = seasonDate(shiftDay(from, step), today);
    if (!target) return;
    event.preventDefault();
    setPicked(target);
    setMonth(monthOf(target));
  };

  const confirm = () => {
    setOpen(false);
    const target = seasonDate(picked, today);
    if (target && target !== date) router.push(`/games/${target}`);
  };

  return (
    // Its own full-width line on a phone, where the panel below it then has the
    // whole column to open into rather than hanging off the side of a pill that
    // happens to sit near the right edge.
    <div className="relative order-first w-full sm:order-none sm:w-auto" ref={wrap}>
      {/* The steps beside it are the same pill in plainer ink; this one is the
          errand people come to the row for, so it wears the accent. */}
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex w-full items-center justify-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-xs font-bold text-grass-deep transition-colors sm:w-auto ${
          open ? "border-grass bg-grass-mist" : "border-grass/60 bg-card hover:bg-grass-mist"
        }`}
      >
        <CalendarIcon className="h-3.5 w-3.5" />
        Jump to date
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Jump to a date"
          className="absolute left-0 top-full z-30 mt-2 w-full rounded-3xl border-2 border-grass-deep/12 bg-card/97 p-3 lip-float sm:w-[19.5rem]"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={month <= monthOf(SEASON_OPENING_DAY)}
              aria-label="Previous month"
              className={ARROW}
            >
              ←
            </button>
            <span className="font-display text-sm font-extrabold text-grass-deep">
              {monthLabel(month)}
            </span>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={month >= monthOf(today)}
              aria-label="Next month"
              className={ARROW}
            >
              →
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-bark-soft/70">
            {WEEKDAYS.map((day) => (
              <span key={day} aria-hidden>
                {day}
              </span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1" onKeyDown={walk}>
            {cells.map((day, at) => {
              if (day === null) return <span key={`blank-${at}`} />;
              const within = seasonDate(day, today) !== null;
              return (
                <button
                  key={day}
                  type="button"
                  ref={day === focusable ? landing : undefined}
                  data-date={day}
                  disabled={!within}
                  tabIndex={day === focusable ? 0 : -1}
                  onClick={() => setPicked(day)}
                  aria-label={fullLabel(day)}
                  aria-pressed={day === picked}
                  aria-current={day === today ? "date" : undefined}
                  className={`${DAY} ${
                    day === picked
                      ? "bg-grass text-card"
                      : !within
                        ? "text-bark-soft/30"
                        : day === today
                          ? "text-grass-deep ring-2 ring-inset ring-grass-soft hover:bg-grass-mist"
                          : "text-bark hover:bg-grass-mist hover:text-grass-deep"
                  }`}
                >
                  {Number(day.slice(8))}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t-2 border-dashed border-grass-deep/12 pt-3">
            <span className="font-display text-sm font-bold text-bark">{dayLabel(picked)}</span>
            <button
              type="button"
              onClick={confirm}
              className="rounded-full bg-grass px-4 py-1.5 text-xs font-bold text-card transition-transform lip-sm hover:-translate-y-0.5"
            >
              Confirm →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
