"use client";

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/store/gameStore";

/**
 * The between-innings card. On a real broadcast the half-inning ends and the
 * feed goes to commercial - `linescore.inningState` reads "Middle" or "End" -
 * and the field sits empty until play resumes. The director holds the park
 * empty for exactly that window (see `Director.intermission`); this fills it
 * with a word from the person who built the place.
 *
 * Like the callout HUD, it polls the director on a frame loop rather than
 * hanging off a React render, so animation state never has to travel through
 * the store to reach it.
 */
export function Intermission() {
  const director = useGameStore((s) => s.director);
  const snapshot = useGameStore((s) => s.snapshot);
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const wasActive = useRef(false);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = director.intermission;
      if (now !== wasActive.current) {
        wasActive.current = now;
        setActive(now);
        // A fresh break brings the card back even if the last one was dismissed.
        if (now) setDismissed(false);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [director]);

  if (!active || dismissed) return null;

  const inningState = snapshot?.inningState;
  const label =
    inningState === "Middle" || inningState === "End"
      ? `${inningState} of the ${snapshot?.inningOrdinal ?? ""}`.trim()
      : "Between innings";

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
      <div className="pointer-events-auto relative w-full max-w-sm rounded-3xl border-2 border-grass-deep/15 bg-card/95 p-6 text-center lip-float">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border-2 border-grass-deep/12 bg-card text-bark-soft transition-colors hover:border-clay hover:text-clay"
        >
          ×
        </button>

        <div className="text-[11px] font-bold uppercase tracking-wide text-clay">{label}</div>
        <div className="mt-1 font-display text-2xl font-extrabold text-grass-deep">Intermission</div>

        <p className="mt-3 text-sm leading-relaxed text-bark-soft">
          <span className="font-semibold text-bark">Pocket Ballpark</span> was created by{" "}
          <span className="font-semibold text-bark">Wilhelm Willie</span> (
          <a
            href="https://x.com/Wilhelm_Willie"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-grass-deep underline decoration-grass/50 underline-offset-2 hover:text-clay"
          >
            @Wilhelm_Willie
          </a>
          ).
        </p>
        <p className="mt-2 text-sm leading-relaxed text-bark-soft">
          Feel free to reach out with any questions, feedback, or ideas.
        </p>

        <div className="mt-4 text-[11px] font-semibold text-bark-soft/80">Play resumes shortly…</div>
      </div>
    </div>
  );
}
