"use client";

import { useEffect, useState } from "react";
import type { Intermission as Break } from "@/lib/anim/director";
import type { GameSnapshot } from "@/lib/game/types";
import { useGameStore } from "@/store/gameStore";

/**
 * The card that goes up while the sides change over.
 *
 * Polled off the director on an animation frame for the same reason the
 * callout is: the break belongs to the animation clock, and driving it through
 * React state would put a render in the middle of every animation.
 *
 * It shows the line score rather than repeating what the scorebug already
 * says - the break is the one moment in a game when the interesting number is
 * the game so far and not the count.
 */
export function Intermission({ snapshot }: { snapshot: GameSnapshot }) {
  const director = useGameStore((s) => s.director);
  const [now, setNow] = useState<Break | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastAt = 0;
    const tick = () => {
      const current = director.intermission;
      const at = current?.at ?? 0;
      if (at !== lastAt) {
        lastAt = at;
        setNow(current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [director]);

  if (!now) return null;

  const { teams, score } = snapshot;

  return (
    <div
      key={now.at}
      className="pointer-events-none flex animate-[callout_420ms_cubic-bezier(0.34,1.56,0.64,1)] flex-col items-center gap-2"
    >
      <div className="rounded-3xl border-2 border-grass-deep/15 bg-card/95 px-5 py-3.5 text-center backdrop-blur-[2px] lip-float sm:px-8 sm:py-5">
        <div className="font-display text-lg font-extrabold leading-none text-grass-deep sm:text-2xl">
          {now.title}
        </div>

        <div className="mt-3 flex items-center justify-center gap-3 sm:gap-4">
          <TeamScore
            abbrev={teams.away.abbrev}
            color={teams.away.palette.primary}
            runs={score.away}
          />
          <span className="font-display text-sm font-bold text-bark-soft">at</span>
          <TeamScore
            abbrev={teams.home.abbrev}
            color={teams.home.palette.primary}
            runs={score.home}
          />
        </div>

        <div className="mt-3 border-t-2 border-dashed border-grass-deep/12 pt-2 text-[11px] font-bold text-bark-soft">
          {now.half} · {now.detail}
        </div>
      </div>
    </div>
  );
}

function TeamScore({
  abbrev,
  color,
  runs,
}: {
  abbrev: string;
  color: string;
  runs: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-4 w-4 rounded-full ring-2 ring-card"
        style={{ backgroundColor: color }}
      />
      <span className="font-display text-sm font-extrabold text-bark sm:text-base">{abbrev}</span>
      <span className="font-display text-2xl font-extrabold leading-none text-grass-deep sm:text-3xl">
        {runs}
      </span>
    </div>
  );
}
